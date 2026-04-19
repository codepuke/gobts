import { EndOfStreamError, GobEncodeError } from './errors.ts';
import { Complex } from './types.ts';

// ---------------------------------------------------------------------------
// GobWriter
// ---------------------------------------------------------------------------

const INITIAL_CAPACITY = 256;

export class GobWriter {
  private _buf: Uint8Array;
  private _len: number;
  private readonly _enc: TextEncoder;

  // Reusable scratch buffer for float byte-reversal.
  private readonly _f64buf: Float64Array;
  private readonly _f64bytes: Uint8Array;

  constructor() {
    this._buf = new Uint8Array(INITIAL_CAPACITY);
    this._len = 0;
    this._enc = new TextEncoder();
    this._f64buf = new Float64Array(1);
    this._f64bytes = new Uint8Array(this._f64buf.buffer);
  }

  // Ensure at least `needed` additional bytes fit without reallocating.
  private _grow(needed: number): void {
    const required = this._len + needed;
    if (required <= this._buf.length) return;
    let cap = this._buf.length * 2;
    while (cap < required) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this._buf.subarray(0, this._len));
    this._buf = next;
  }

  private _writeByte(b: number): void {
    this._grow(1);
    this._buf[this._len++] = b;
  }

  writeUInt(value: bigint): void {
    if (value < 0n) {
      throw new GobEncodeError(`writeUInt: negative value ${value}`);
    }
    if (value > 0xffffffffffffffffn) {
      throw new GobEncodeError(`writeUInt: value ${value} exceeds uint64 max`);
    }
    if (value < 128n) {
      this._writeByte(Number(value));
      return;
    }
    // Encode as big-endian minimal bytes, prefix = 256 - byteCount.
    // Max uint64 is 8 bytes.
    const tmp = new Uint8Array(8);
    let v = value;
    let byteCount = 0;
    while (v > 0n) {
      tmp[7 - byteCount] = Number(v & 0xffn);
      v >>= 8n;
      byteCount++;
    }
    this._grow(1 + byteCount);
    this._buf[this._len++] = 256 - byteCount;
    for (let i = 8 - byteCount; i < 8; i++) {
      this._buf[this._len++] = tmp[i]!;
    }
  }

  writeInt(value: bigint): void {
    // Validate int64 range.
    if (value < -(2n ** 63n) || value > 2n ** 63n - 1n) {
      throw new GobEncodeError(`writeInt: value ${value} out of int64 range`);
    }
    // Zigzag encode: negative → (~v << 1) | 1; non-negative → v << 1.
    const u = value < 0n ? (~value << 1n) | 1n : value << 1n;
    this.writeUInt(u);
  }

  writeFloat(value: number): void {
    // Gob float encoding: byte-reverse the IEEE 754 float64 bits, then encode as uint.
    // On a little-endian system, Float64Array stores the float with byte 0 = least-significant.
    // Interpreting _f64bytes[0..7] as a big-endian uint gives the byte-reversed representation
    // that Go's bits.ReverseBytes64(math.Float64bits(f)) produces.
    this._f64buf[0] = value;
    let u = 0n;
    for (let i = 0; i < 8; i++) {
      u = (u << 8n) | BigInt(this._f64bytes[i]!);
    }
    this.writeUInt(u);
  }

  writeComplex(value: Complex): void {
    this.writeFloat(value.re);
    this.writeFloat(value.im);
  }

  writeBool(value: boolean): void {
    this.writeUInt(value ? 1n : 0n);
  }

  writeString(value: string): void {
    const encoded = this._enc.encode(value);
    this.writeUInt(BigInt(encoded.length));
    this.writeRaw(encoded);
  }

  writeBytes(value: Uint8Array): void {
    this.writeUInt(BigInt(value.length));
    this.writeRaw(value);
  }

  writeRaw(bytes: Uint8Array): void {
    this._grow(bytes.length);
    this._buf.set(bytes, this._len);
    this._len += bytes.length;
  }

  /** Return a copy of the accumulated bytes. Does NOT reset. */
  bytes(): Uint8Array {
    return this._buf.slice(0, this._len);
  }

  /** Return length of accumulated bytes. */
  get length(): number {
    return this._len;
  }

  /** Reset the writer, discarding all accumulated bytes. */
  reset(): void {
    this._len = 0;
  }
}

// ---------------------------------------------------------------------------
// GobReader
// ---------------------------------------------------------------------------

export class GobReader {
  private readonly _buf: Uint8Array;
  private _pos: number;
  private readonly _dec: TextDecoder;

  // Reusable scratch buffer for float byte-reversal.
  private readonly _f64buf: Float64Array;
  private readonly _f64bytes: Uint8Array;

  constructor(bytes: Uint8Array, offset = 0) {
    this._buf = bytes;
    this._pos = offset;
    this._dec = new TextDecoder();
    this._f64buf = new Float64Array(1);
    this._f64bytes = new Uint8Array(this._f64buf.buffer);
  }

  private _readByte(): number {
    if (this._pos >= this._buf.length) {
      throw new EndOfStreamError('unexpected end of gob stream reading byte');
    }
    return this._buf[this._pos++]!;
  }

  readUInt(): bigint {
    const first = this._readByte();
    if (first < 128) {
      return BigInt(first);
    }
    // Header byte: 256 - byteCount → byteCount = 256 - first.
    const byteCount = 256 - first;
    if (this._pos + byteCount > this._buf.length) {
      throw new EndOfStreamError('unexpected end of gob stream reading uint');
    }
    let value = 0n;
    for (let i = 0; i < byteCount; i++) {
      value = (value << 8n) | BigInt(this._buf[this._pos++]!);
    }
    return value;
  }

  readInt(): bigint {
    const u = this.readUInt();
    // Zigzag decode: odd → -(u >> 1) - 1; even → u >> 1.
    if (u & 1n) {
      return -(u >> 1n) - 1n;
    }
    return u >> 1n;
  }

  readFloat(): number {
    const u = this.readUInt();
    // u is the byte-reversed IEEE 754 float64 encoded as a big-endian uint.
    // Write u's bytes MSB-first into _f64bytes[0..7]. Because Float64Array is
    // little-endian on x86, byte 0 is the least significant, which maps to u's
    // least significant byte (stored last when u is written big-endian → i=7).
    let v = u;
    for (let i = 7; i >= 0; i--) {
      this._f64bytes[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return this._f64buf[0]!;
  }

  readComplex(): Complex {
    const re = this.readFloat();
    const im = this.readFloat();
    return new Complex(re, im);
  }

  readBool(): boolean {
    return this.readUInt() !== 0n;
  }

  readString(): string {
    const len = Number(this.readUInt());
    const bytes = this.readRaw(len);
    return this._dec.decode(bytes);
  }

  readBytes(): Uint8Array {
    const len = Number(this.readUInt());
    return this.readRaw(len).slice(); // own copy
  }

  readRaw(n: number): Uint8Array {
    if (this._pos + n > this._buf.length) {
      throw new EndOfStreamError(`unexpected end of gob stream: need ${n} bytes, have ${this._buf.length - this._pos}`);
    }
    const view = this._buf.subarray(this._pos, this._pos + n);
    this._pos += n;
    return view;
  }

  get position(): number {
    return this._pos;
  }

  get remaining(): number {
    return this._buf.length - this._pos;
  }

  eof(): boolean {
    return this._pos >= this._buf.length;
  }
}
