import { GobReader, GobWriter } from './codec.ts';
import { EndOfStreamError, GobDecodeError } from './errors.ts';
import { Complex, GobEncoded, GobObject } from './types.ts';
import {
  BOOL, INT, UINT, FLOAT, BYTES, STRING, COMPLEX, INTERFACE,
  WIRE_TYPE, ARRAY_TYPE, COMMON_TYPE, SLICE_TYPE, STRUCT_TYPE,
  FIELD_TYPE, FIELD_TYPE_SLICE, MAP_TYPE,
  type StructWireType, type WireType,
  decodeWireType,
} from './wire.ts';

// ---------------------------------------------------------------------------
// Codec interface (used by decoder; mirrors what Phase 6 will fully define)
// ---------------------------------------------------------------------------

export interface Codec<T> {
  readonly kind: 'gob' | 'binary' | 'text';
  encode(value: T): Uint8Array;
  decode(bytes: Uint8Array): T;
}

export type CodecMap = Record<string, Codec<unknown>>;

export interface DecodeOptions {
  codecs?: CodecMap;
  registry?: Map<string, (fields: Record<string, unknown>) => unknown>;
}

// Bootstrap type IDs that are always in the registry as null.
const BOOTSTRAP_IDS = new Set([
  BOOL, INT, UINT, FLOAT, BYTES, STRING, COMPLEX, INTERFACE,
  WIRE_TYPE, ARRAY_TYPE, COMMON_TYPE, SLICE_TYPE, STRUCT_TYPE,
  FIELD_TYPE, FIELD_TYPE_SLICE, MAP_TYPE,
]);

// ---------------------------------------------------------------------------
// GobDecoder
// ---------------------------------------------------------------------------

export class GobDecoder {
  private _buf: Uint8Array;
  private _pos: number;
  private readonly _typeRegistry: Map<number, WireType | null>;
  private readonly _codecRegistry: Map<string, Codec<unknown>>;
  private readonly _factory: Map<string, (fields: Record<string, unknown>) => unknown>;

  constructor(bytes: Uint8Array = new Uint8Array(0), options?: DecodeOptions) {
    this._buf = bytes;
    this._pos = 0;

    // Pre-populate bootstrap type IDs as null.
    this._typeRegistry = new Map();
    for (const id of BOOTSTRAP_IDS) {
      this._typeRegistry.set(id, null);
    }

    this._codecRegistry = new Map();
    if (options?.codecs) {
      for (const [name, codec] of Object.entries(options.codecs)) {
        this._codecRegistry.set(name, codec);
      }
    }

    this._factory = options?.registry ?? new Map();
  }

  /** Append bytes to the internal buffer. */
  feed(bytes: Uint8Array): void {
    if (this._pos > 0) {
      // Compact: drop already-consumed prefix.
      const remaining = this._buf.subarray(this._pos);
      const combined = new Uint8Array(remaining.length + bytes.length);
      combined.set(remaining);
      combined.set(bytes, remaining.length);
      this._buf = combined;
      this._pos = 0;
    } else {
      const combined = new Uint8Array(this._buf.length + bytes.length);
      combined.set(this._buf);
      combined.set(bytes, this._buf.length);
      this._buf = combined;
    }
  }

  /** Decode the next complete value. Throws EndOfStreamError if exhausted. */
  decode<T = unknown>(): T {
    return this._readUntilValue() as T;
  }

  /** Attempt to decode; returns { ok: false } at end of stream. */
  tryDecode<T = unknown>(): { ok: true; value: T } | { ok: false } {
    if (!this.hasMore()) return { ok: false };
    try {
      return { ok: true, value: this.decode<T>() };
    } catch (e) {
      if (e instanceof EndOfStreamError) return { ok: false };
      throw e;
    }
  }

  /** True if the buffer has unread bytes. */
  hasMore(): boolean {
    return this._pos < this._buf.length;
  }

  /** Register a factory for a Go struct type name. */
  register<T>(goTypeName: string, factory: (fields: Record<string, unknown>) => T): void {
    this._factory.set(goTypeName, factory as (f: Record<string, unknown>) => unknown);
  }

  /** Register a codec for a marshaler type. */
  registerCodec<T>(typeName: string, codec: Codec<T>): void {
    this._codecRegistry.set(typeName, codec as Codec<unknown>);
  }

  [Symbol.iterator](): IterableIterator<unknown> {
    const decoder = this;
    return {
      next(): IteratorResult<unknown> {
        const result = decoder.tryDecode();
        if (!result.ok) return { done: true, value: undefined };
        return { done: false, value: result.value };
      },
      [Symbol.iterator]() { return this; },
    };
  }

  // ---------------------------------------------------------------------------
  // Private: message framing
  // ---------------------------------------------------------------------------

  /** Read the next value, skipping type-definition messages. */
  private _readUntilValue(): unknown {
    for (;;) {
      const { typeId, payload } = this._readMessage();
      if (typeId < 0) {
        // Type definition: register the WireType.
        const actualId = -typeId;
        const r = new GobReader(payload);
        const wt = decodeWireType(r);
        this._typeRegistry.set(actualId, wt);
      } else {
        return this._decodeValue(typeId, payload);
      }
    }
  }

  /** Read one framed message from the buffer. Returns { typeId, payload }. */
  private _readMessage(): { typeId: number; payload: Uint8Array } {
    if (this._pos >= this._buf.length) {
      throw new EndOfStreamError();
    }

    // Save position so we can restore on partial read.
    const savedPos = this._pos;

    const outerReader = new GobReader(this._buf, this._pos);
    let msgLen: number;
    try {
      msgLen = Number(outerReader.readUInt());
    } catch (e) {
      this._pos = savedPos;
      throw e instanceof EndOfStreamError ? e : new GobDecodeError(`failed to read message length: ${e}`);
    }

    const newPos = outerReader.position + msgLen;
    if (newPos > this._buf.length) {
      this._pos = savedPos;
      throw new EndOfStreamError('truncated message: not enough bytes');
    }

    const msgBytes = this._buf.subarray(outerReader.position, newPos);
    this._pos = newPos;

    const msgReader = new GobReader(msgBytes);
    const typeId = Number(msgReader.readInt());
    const payload = msgBytes.subarray(msgReader.position);

    return { typeId, payload };
  }

  // ---------------------------------------------------------------------------
  // Private: value dispatch
  // ---------------------------------------------------------------------------

  private _decodeValue(typeId: number, payload: Uint8Array): unknown {
    // Bootstrap scalar types: stripped of 0x00 singleton wrapper.
    if (typeId === BOOL) return this._unwrapScalar(payload, r => r.readBool());
    if (typeId === INT)  return this._unwrapScalar(payload, r => r.readInt());
    if (typeId === UINT) return this._unwrapScalar(payload, r => r.readUInt());
    if (typeId === FLOAT) return this._unwrapScalar(payload, r => r.readFloat());
    if (typeId === BYTES) return this._unwrapScalar(payload, r => r.readBytes());
    if (typeId === STRING) return this._unwrapScalar(payload, r => r.readString());
    if (typeId === COMPLEX) return this._unwrapScalar(payload, r => r.readComplex());

    const wt = this._typeRegistry.get(typeId);
    if (wt === undefined) {
      throw new GobDecodeError(`unknown type ID ${typeId}`);
    }
    if (wt === null) {
      throw new GobDecodeError(`bootstrap type ID ${typeId} used in unexpected context`);
    }

    if (wt.struct !== undefined) {
      const r = new GobReader(payload);
      return this._decodeStruct(wt.struct, r);
    }

    // Collections and marshalers: strip 0x00 singleton wrapper.
    if (payload.length === 0 || payload[0] !== 0x00) {
      throw new GobDecodeError(`type ${typeId}: missing 0x00 singleton wrapper`);
    }
    const r = new GobReader(payload.subarray(1));

    if (wt.slice !== undefined) return this._decodeList(wt.slice.elem, r);
    if (wt.array !== undefined) return this._decodeList(wt.array.elem, r);
    if (wt.map !== undefined)   return this._decodeMap(wt.map.key, wt.map.elem, r);
    if (wt.gobEncoder !== undefined || wt.binaryMarshaler !== undefined || wt.textMarshaler !== undefined) {
      const typeName = this._marshalerName(wt);
      const len = Number(r.readUInt());
      const data = r.readRaw(len).slice();
      return this._applyCodec(typeName, data);
    }

    throw new GobDecodeError(`type ${typeId}: unsupported wire type variant`);
  }

  /** Decode a value within a struct field (no singleton wrapper). */
  private _decodeField(typeId: number, r: GobReader): unknown {
    if (typeId === BOOL)    return r.readBool();
    if (typeId === INT)     return r.readInt();
    if (typeId === UINT)    return r.readUInt();
    if (typeId === FLOAT)   return r.readFloat();
    if (typeId === BYTES)   return r.readBytes();
    if (typeId === STRING)  return r.readString();
    if (typeId === COMPLEX) return r.readComplex();
    if (typeId === INTERFACE) return this._decodeInterface(r);

    const wt = this._typeRegistry.get(typeId);
    if (wt === undefined) {
      throw new GobDecodeError(`unknown field type ID ${typeId}`);
    }
    if (wt === null) {
      throw new GobDecodeError(`bootstrap type ID ${typeId} not valid as field type`);
    }

    if (wt.struct !== undefined)  return this._decodeStruct(wt.struct, r);
    if (wt.slice !== undefined)   return this._decodeList(wt.slice.elem, r);
    if (wt.array !== undefined)   return this._decodeList(wt.array.elem, r);
    if (wt.map !== undefined)     return this._decodeMap(wt.map.key, wt.map.elem, r);
    if (wt.gobEncoder !== undefined || wt.binaryMarshaler !== undefined || wt.textMarshaler !== undefined) {
      const typeName = this._marshalerName(wt);
      const len = Number(r.readUInt());
      const data = r.readRaw(len).slice();
      return this._applyCodec(typeName, data);
    }

    throw new GobDecodeError(`field type ${typeId}: unsupported wire type variant`);
  }

  // ---------------------------------------------------------------------------
  // Private: struct decoding
  // ---------------------------------------------------------------------------

  private _decodeStruct(structT: StructWireType, r: GobReader): GobObject | unknown {
    // Pre-populate all fields with their zero values.
    const fields: Record<string, unknown> = {};
    for (const f of structT.fields) {
      fields[f.name] = this._zeroValue(f.id);
    }

    let fieldNum = -1;
    for (;;) {
      let delta: number;
      try {
        delta = Number(r.readUInt());
      } catch (e) {
        if (e instanceof EndOfStreamError) break;
        throw e;
      }
      if (delta === 0) break;
      fieldNum += delta;
      if (fieldNum >= structT.fields.length) {
        throw new GobDecodeError(
          `field index ${fieldNum} out of range for struct "${structT.common.name}" (${structT.fields.length} fields)`
        );
      }
      const fieldDef = structT.fields[fieldNum]!;
      fields[fieldDef.name] = this._decodeField(fieldDef.id, r);
    }

    const typeName = structT.common.name;
    const factory = this._factory.get(typeName);
    if (factory !== undefined) {
      return factory(fields);
    }
    return new GobObject(typeName, fields);
  }

  // ---------------------------------------------------------------------------
  // Private: collection decoding
  // ---------------------------------------------------------------------------

  private _decodeList(elemTypeId: number, r: GobReader): unknown[] {
    const count = Number(r.readUInt());
    const result: unknown[] = new Array(count);
    for (let i = 0; i < count; i++) {
      result[i] = this._decodeField(elemTypeId, r);
    }
    return result;
  }

  private _decodeMap(keyTypeId: number, elemTypeId: number, r: GobReader): Map<unknown, unknown> {
    const count = Number(r.readUInt());
    const result = new Map<unknown, unknown>();
    for (let i = 0; i < count; i++) {
      const key = this._decodeField(keyTypeId, r);
      const val = this._decodeField(elemTypeId, r);
      result.set(key, val);
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private: interface decoding
  // ---------------------------------------------------------------------------

  private _decodeInterface(r: GobReader): unknown {
    const typeName = r.readString();
    if (typeName === '') return null;

    // Consume inline type definitions until EOF of this reader.
    // Each def: negative signed int (typeId) + wireType bytes.
    // Terminates on raw_id === 0 OR EOF.
    for (;;) {
      let rawId: bigint;
      try {
        rawId = r.readInt();
      } catch (e) {
        if (e instanceof EndOfStreamError) break;
        throw e;
      }
      if (rawId === 0n) break;
      if (rawId < 0n) {
        const actualId = Number(-rawId);
        const wt = decodeWireType(r);
        this._typeRegistry.set(actualId, wt);
      }
    }

    // The concrete value arrives as the next value message in the outer stream.
    for (;;) {
      const { typeId, payload } = this._readMessage();
      if (typeId < 0) {
        const r2 = new GobReader(payload);
        const wt = decodeWireType(r2);
        this._typeRegistry.set(-typeId, wt);
      } else {
        return this._decodeInterfaceConcrete(typeId, payload);
      }
    }
  }

  /** Decode an interface concrete value payload. It has an inner byte-count wrapper. */
  private _decodeInterfaceConcrete(typeId: number, payload: Uint8Array): unknown {
    const wt = this._typeRegistry.get(typeId);
    if (wt === undefined) {
      throw new GobDecodeError(`unknown type ID ${typeId} for interface concrete value`);
    }
    if (wt !== null && wt.struct !== undefined) {
      const r = new GobReader(payload);
      const byteCount = Number(r.readUInt());
      const structBytes = r.readRaw(byteCount);
      return this._decodeStruct(wt.struct, new GobReader(structBytes));
    }
    // Non-struct: fall back to standard value decoding.
    return this._decodeValue(typeId, payload);
  }

  // ---------------------------------------------------------------------------
  // Private: helpers
  // ---------------------------------------------------------------------------

  private _unwrapScalar<T>(payload: Uint8Array, fn: (r: GobReader) => T): T {
    if (payload.length === 0 || payload[0] !== 0x00) {
      throw new GobDecodeError('scalar value missing 0x00 singleton wrapper');
    }
    return fn(new GobReader(payload.subarray(1)));
  }

  private _zeroValue(typeId: number): unknown {
    if (typeId === BOOL) return false;
    if (typeId === INT || typeId === UINT) return 0n;
    if (typeId === FLOAT) return 0;
    if (typeId === STRING) return '';
    if (typeId === BYTES) return new Uint8Array(0);
    if (typeId === COMPLEX) return Complex.ZERO;
    if (typeId === INTERFACE) return null;

    const wt = this._typeRegistry.get(typeId);
    if (wt !== undefined && wt !== null) {
      if (wt.slice !== undefined || wt.array !== undefined) return [];
      if (wt.map !== undefined) return new Map();
    }
    return null;
  }

  private _marshalerName(wt: WireType): string {
    if (wt.gobEncoder) return wt.gobEncoder.common.name;
    if (wt.binaryMarshaler) return wt.binaryMarshaler.common.name;
    if (wt.textMarshaler) return wt.textMarshaler.common.name;
    return '';
  }

  private _applyCodec(typeName: string, data: Uint8Array): unknown {
    const codec = this._codecRegistry.get(typeName);
    if (codec !== undefined) {
      return codec.decode(data);
    }
    return new GobEncoded(typeName, data);
  }
}
