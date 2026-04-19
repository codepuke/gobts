import { GobWriter } from './codec.ts';
import { GobEncodeError } from './errors.ts';
import { Complex, GobObject, Schema, type GobFieldType } from './types.ts';
import type { Codec, CodecMap } from './decoder.ts';
import {
  BOOL, INT, UINT, FLOAT, BYTES, STRING, COMPLEX, INTERFACE,
  FIRST_USER_ID,
} from './wire.ts';

export type { Codec, CodecMap };
export type { GobFieldType } from './types.ts';
export { Schema } from './types.ts';

// ---------------------------------------------------------------------------
// EncodeOptions
// ---------------------------------------------------------------------------

export interface EncodeOptions {
  schema?: Schema;
  elemType?: GobFieldType;
  keyType?: GobFieldType;
  arrayLength?: number;
  codecs?: CodecMap;
  /** For top-level marshaler types (e.g., time.Time, uuid.UUID). Unqualified Go type name. */
  marshalerType?: string;
  /** Marshaler kind: 'gob' | 'binary' | 'text'. Required when marshalerType is set. */
  marshalerKind?: 'gob' | 'binary' | 'text';
}

// ---------------------------------------------------------------------------
// GobEncoder
// ---------------------------------------------------------------------------

export class GobEncoder {
  private readonly _outer: GobWriter;
  private readonly _codecRegistry: Map<string, Codec<unknown>>;
  // Schema name → assigned type ID.
  private readonly _schemaRegistry: Map<string, number>;
  // Collection signature → assigned type ID.
  private readonly _collectionRegistry: Map<string, number>;
  // goName → schema, for interface concrete types.
  private readonly _interfaceRegistry: Map<string, Schema>;
  // Type IDs that have been emitted as TOP-LEVEL type defs (not inline).
  private readonly _emittedTopLevel: Set<number>;
  // Type IDs that have been emitted INLINE (for interface concrete types).
  private readonly _emittedInline: Set<number>;

  private _nextId: number;

  constructor(options?: EncodeOptions) {
    this._outer = new GobWriter();
    this._codecRegistry = new Map();
    this._schemaRegistry = new Map();
    this._collectionRegistry = new Map();
    this._interfaceRegistry = new Map();
    this._emittedTopLevel = new Set();
    this._emittedInline = new Set();
    this._nextId = FIRST_USER_ID;

    if (options?.codecs) {
      for (const [name, codec] of Object.entries(options.codecs)) {
        this._codecRegistry.set(name, codec);
      }
    }
  }

  /** Append a value's message(s) to the internal buffer. */
  encode<T>(value: T, options?: EncodeOptions): void {
    const schema = options?.schema;
    if (schema !== undefined) {
      // Encode a struct.
      this._encodeStruct(value as Record<string, unknown>, schema);
      return;
    }

    if (options?.marshalerType !== undefined) {
      const typeName = options.marshalerType;
      const marshalerKind = options.marshalerKind ?? 'gob';
      this._encodeMarshalerTopLevel(value, typeName, marshalerKind);
      return;
    }

    // Infer type from value.
    if (typeof value === 'boolean') {
      this._encodeScalar(BOOL, w => w.writeBool(value));
      return;
    }
    if (typeof value === 'bigint') {
      // Default to signed int; caller can specify schema with GOB_UINT.
      this._encodeScalar(INT, w => w.writeInt(value));
      return;
    }
    if (typeof value === 'number') {
      this._encodeScalar(FLOAT, w => w.writeFloat(value));
      return;
    }
    if (typeof value === 'string') {
      this._encodeScalar(STRING, w => w.writeString(value));
      return;
    }
    if (value instanceof Uint8Array) {
      this._encodeScalar(BYTES, w => w.writeBytes(value));
      return;
    }
    if (value instanceof Complex) {
      this._encodeScalar(COMPLEX, w => w.writeComplex(value));
      return;
    }
    if (value instanceof GobObject) {
      // GobObjects carry their schema and type name.
      this._encodeGobObjectTopLevel(value);
      return;
    }
    if (Array.isArray(value)) {
      const elemType = options?.elemType ?? this._inferElemType(value);
      this._encodeSliceTopLevel(value as unknown[], elemType, options?.arrayLength);
      return;
    }
    if (value instanceof Map) {
      const keyType = options?.keyType ?? this._inferKeyType(value);
      const elemType = options?.elemType ?? this._inferMapElemType(value);
      this._encodeMapTopLevel(value as Map<unknown, unknown>, keyType, elemType);
      return;
    }
    throw new GobEncodeError(`encode: cannot encode value of type ${typeof value}`);
  }

  /** Register a concrete type for interface{} fields. */
  register(goName: string, schema: Schema): void {
    this._interfaceRegistry.set(goName, schema);
  }

  /** Register a codec for a marshaler type. */
  registerCodec<T>(typeName: string, codec: Codec<T>): void {
    this._codecRegistry.set(typeName, codec as Codec<unknown>);
  }

  /** Return accumulated bytes and reset the internal buffer. Type defs are preserved. */
  bytes(): Uint8Array {
    const result = this._outer.bytes();
    this._outer.reset();
    return result;
  }

  /** Clear all state: buffer, type registries, interface registrations. Codec registrations are preserved. */
  reset(): void {
    this._outer.reset();
    this._schemaRegistry.clear();
    this._collectionRegistry.clear();
    this._interfaceRegistry.clear();
    this._emittedTopLevel.clear();
    this._emittedInline.clear();
    this._nextId = FIRST_USER_ID;
  }

  // ---------------------------------------------------------------------------
  // Top-level scalar encoding
  // ---------------------------------------------------------------------------

  private _encodeScalar(typeId: number, writeFn: (w: GobWriter) => void): void {
    const payload = new GobWriter();
    // typeId encoded as signed int (positive value messages use positive int).
    payload.writeInt(BigInt(typeId));
    // Singleton wrapper: 0x00 + value.
    payload.writeUInt(0n);
    writeFn(payload);
    this._writeFramed(payload.bytes());
  }

  // ---------------------------------------------------------------------------
  // Struct encoding
  // ---------------------------------------------------------------------------

  private _encodeMarshalerTopLevel(value: unknown, typeName: string, marshalerKind: 'gob' | 'binary' | 'text'): void {
    const typeId = this._ensureMarshalerTypeDef(typeName, marshalerKind);
    const codec = this._codecRegistry.get(typeName);
    if (codec === undefined) {
      throw new GobEncodeError(`no codec registered for marshaler type "${typeName}"`);
    }
    const data = codec.encode(value);
    const payload = new GobWriter();
    payload.writeInt(BigInt(typeId));
    payload.writeUInt(0n); // singleton wrapper
    payload.writeUInt(BigInt(data.length));
    payload.writeRaw(data);
    this._writeFramed(payload.bytes());
  }

  private _encodeGobObjectTopLevel(obj: GobObject): void {
    if (obj.schema === undefined) {
      throw new GobEncodeError(
        `GobObject "${obj.type}" has no schema — provide schema when constructing: new GobObject(type, fields, schema)`,
      );
    }
    this._encodeStruct(obj.fields as Record<string, unknown>, obj.schema);
  }

  private _encodeStruct(value: Record<string, unknown>, schema: Schema): void {
    const typeId = this._ensureStructTypeDef(schema, false);
    const payload = new GobWriter();
    // TypeId: positive int for value message.
    payload.writeInt(BigInt(typeId));
    this._writeStructPayload(payload, value, schema);
    this._writeFramed(payload.bytes());
  }

  private _writeStructPayload(out: GobWriter, value: Record<string, unknown>, schema: Schema): void {
    let prevField = -1;
    for (let i = 0; i < schema.fields.length; i++) {
      const [fieldName, fieldType] = schema.fields[i]!;
      const fieldValue = value[fieldName];
      if (this._isZero(fieldValue, fieldType)) continue;

      const delta = i - prevField;
      out.writeUInt(BigInt(delta));
      this._writeFieldValue(out, fieldValue, fieldType);
      prevField = i;
    }
    out.writeUInt(0n); // struct terminator
  }

  private _writeFieldValue(out: GobWriter, value: unknown, fieldType: GobFieldType): void {
    const ft = fieldType as GobFieldType;

    if (ft.kind === 'primitive') {
      this._writePrimitiveField(out, value, ft.typeId);
      return;
    }

    if (ft.kind === 'semantic') {
      const wireValue = ft.encode(value);
      this._writeFieldValue(out, wireValue, ft.wire);
      return;
    }

    if (ft.kind === 'struct') {
      // Nested struct: no byte-count prefix, no type-def, just raw delta-encoded fields.
      this._writeStructPayload(out, value as Record<string, unknown>, ft.schema);
      return;
    }

    if (ft.kind === 'slice') {
      const arr = value as unknown[];
      out.writeUInt(BigInt(arr.length));
      for (const elem of arr) {
        this._writeFieldValue(out, elem, ft.elem);
      }
      return;
    }

    if (ft.kind === 'array') {
      const arr = value as unknown[];
      out.writeUInt(BigInt(arr.length));
      for (const elem of arr) {
        this._writeFieldValue(out, elem, ft.elem);
      }
      return;
    }

    if (ft.kind === 'map') {
      const map = value as Map<unknown, unknown>;
      out.writeUInt(BigInt(map.size));
      for (const [k, v] of map.entries()) {
        this._writeFieldValue(out, k, ft.key);
        this._writeFieldValue(out, v, ft.elem);
      }
      return;
    }

    if (ft.kind === 'marshaler') {
      const codec = this._codecRegistry.get(ft.typeName);
      if (codec === undefined) {
        throw new GobEncodeError(`no codec registered for marshaler type "${ft.typeName}"`);
      }
      const data = codec.encode(value);
      out.writeUInt(BigInt(data.length));
      out.writeRaw(data);
      return;
    }

    throw new GobEncodeError(`writeFieldValue: unsupported field type kind "${(ft as {kind:string}).kind}"`);
  }

  private _writePrimitiveField(out: GobWriter, value: unknown, typeId: number): void {
    if (typeId === BOOL) {
      out.writeBool(value as boolean);
      return;
    }
    if (typeId === INT) {
      const v = typeof value === 'number' ? BigInt(value) : value as bigint;
      out.writeInt(v);
      return;
    }
    if (typeId === UINT) {
      const v = typeof value === 'number' ? BigInt(value) : value as bigint;
      out.writeUInt(v);
      return;
    }
    if (typeId === FLOAT) {
      out.writeFloat(value as number);
      return;
    }
    if (typeId === STRING) {
      out.writeString(value as string);
      return;
    }
    if (typeId === BYTES) {
      out.writeBytes(value as Uint8Array);
      return;
    }
    if (typeId === COMPLEX) {
      out.writeComplex(value as Complex);
      return;
    }
    if (typeId === INTERFACE) {
      this._writeInterfaceField(out, value);
      return;
    }
    throw new GobEncodeError(`writePrimitiveField: unknown type ID ${typeId}`);
  }

  // ---------------------------------------------------------------------------
  // Interface field encoding
  // ---------------------------------------------------------------------------

  private _writeInterfaceField(out: GobWriter, value: unknown): void {
    if (value === null || value === undefined) {
      out.writeString(''); // nil interface
      return;
    }

    // Find the concrete type.
    let goName: string | undefined;
    let concreteSchema: Schema | undefined;
    let concreteValue: Record<string, unknown>;

    if (value instanceof GobObject) {
      goName = value.type;
      // Look up the registered schema for this type.
      concreteSchema = this._interfaceRegistry.get(goName);
      if (concreteSchema === undefined) {
        throw new GobEncodeError(`interface field: no schema registered for "${goName}". Call encoder.register(goName, schema).`);
      }
      concreteValue = value.fields as Record<string, unknown>;
    } else if (typeof value === 'object' && value !== null) {
      // Plain object: need explicit registration.
      throw new GobEncodeError('interface field with plain object requires a registered GobObject');
    } else {
      throw new GobEncodeError(`interface field: cannot encode primitive ${typeof value} as interface (use a struct)`);
    }

    // Write type name.
    out.writeString(goName);

    // Write inline type definition for the concrete type.
    const typeId = this._ensureStructTypeDef(concreteSchema, true /* inline */);
    // Write typeId as a negative signed int (type def marker).
    out.writeInt(BigInt(-typeId));
    this._writeWireTypeStruct(out, typeId, concreteSchema);
    // Terminate the inline type def sequence.
    out.writeUInt(0n);

    // The concrete value is sent as the NEXT top-level message.
    // We need to emit it after the current message — but we're currently writing
    // into the struct's payload. We'll buffer it and emit after.
    // Solution: write the concrete value into _outer immediately (before the
    // current message framing is finalized? No — the current message IS already
    // being assembled in `out`).
    //
    // The problem: the concrete value must be a SEPARATE framed message.
    // But `out` is the struct payload being written.
    //
    // The key insight from pygob and the PRD: Go's encoder emits the interface
    // inline type defs in the SAME message as the struct, then emits the concrete
    // value as a SEPARATE subsequent message. The decoder reads from the outer
    // stream for the concrete value.
    //
    // Since we're building the struct message in `out` (a GobWriter), and the
    // outer messages are in `_outer`, we need to:
    // 1. Finish writing the inline type def into `out`.
    // 2. After the struct message is framed and emitted, emit the concrete value.
    //
    // This is awkward because `_writeStructPayload` is called before framing.
    // Solution: store pending concrete values in a queue, and flush them after.
    this._pendingInterfaceValues.push({ typeId, value: concreteValue, schema: concreteSchema });
  }

  // Queue of concrete interface values to emit after the current top-level message.
  private _pendingInterfaceValues: Array<{
    typeId: number;
    value: Record<string, unknown>;
    schema: Schema;
  }> = [];

  // ---------------------------------------------------------------------------
  // Collection top-level encoding
  // ---------------------------------------------------------------------------

  private _encodeSliceTopLevel(value: unknown[], elemType: GobFieldType, arrayLength?: number): void {
    const isArray = arrayLength !== undefined;
    const sig = isArray ? this._arraySignature(elemType, arrayLength) : this._sliceSignature(elemType);
    const typeId = this._ensureCollectionTypeDef(sig, elemType, null, null, isArray, arrayLength ?? 0);

    const payload = new GobWriter();
    payload.writeInt(BigInt(typeId));
    // Singleton wrapper: 0x00
    payload.writeUInt(0n);
    payload.writeUInt(BigInt(value.length));
    for (const elem of value) {
      this._writeFieldValue(payload, elem, elemType);
    }
    this._writeFramed(payload.bytes());
  }

  private _encodeMapTopLevel(value: Map<unknown, unknown>, keyType: GobFieldType, elemType: GobFieldType): void {
    const sig = this._mapSignature(keyType, elemType);
    const typeId = this._ensureCollectionTypeDef(sig, elemType, keyType, null, false, 0);

    const payload = new GobWriter();
    payload.writeInt(BigInt(typeId));
    payload.writeUInt(0n); // singleton wrapper
    payload.writeUInt(BigInt(value.size));
    for (const [k, v] of value.entries()) {
      this._writeFieldValue(payload, k, keyType);
      this._writeFieldValue(payload, v, elemType);
    }
    this._writeFramed(payload.bytes());
  }

  // ---------------------------------------------------------------------------
  // Type definition emission
  // ---------------------------------------------------------------------------

  /** Ensure a struct type definition is emitted, returning its type ID.
   *  `inline` = true means this is for an interface concrete type (use inline def tracking). */
  private _ensureStructTypeDef(schema: Schema, inline: boolean): number {
    const existing = this._schemaRegistry.get(schema.name);
    if (existing !== undefined) {
      // If it was emitted as top-level, it cannot be re-emitted inline (and vice versa).
      // Go raises "duplicate type received" if the same ID appears in both forms.
      return existing;
    }

    const typeId = this._nextId++;
    this._schemaRegistry.set(schema.name, typeId);

    if (inline) {
      this._emittedInline.add(typeId);
    } else {
      this._emittedTopLevel.add(typeId);
      this._emitTopLevelStructTypeDef(typeId, schema);
    }

    return typeId;
  }

  private _emitTopLevelStructTypeDef(typeId: number, schema: Schema): void {
    const payload = new GobWriter();
    payload.writeInt(BigInt(-typeId)); // negative = type def
    this._writeWireTypeStruct(payload, typeId, schema);
    this._writeFramed(payload.bytes());
  }

  /** Write a StructWireType struct into the given writer. */
  private _writeWireTypeStruct(out: GobWriter, typeId: number, schema: Schema): void {
    // WireType: delta=3 → StructT (field 2)
    out.writeUInt(3n);

    // StructWireType:
    // delta=1 → CommonType (field 0)
    out.writeUInt(1n);
    // CommonType:
    //   delta=1 → Name
    out.writeUInt(1n);
    out.writeString(schema.name);
    //   delta=1 → Id
    out.writeUInt(1n);
    out.writeInt(BigInt(typeId));
    //   delta=0 → end CommonType
    out.writeUInt(0n);

    // delta=1 → Field []FieldWireType (field 1 of StructWireType)
    out.writeUInt(1n);
    out.writeUInt(BigInt(schema.fields.length));
    for (const [fieldName, fieldType] of schema.fields) {
      this._writeFieldWireType(out, fieldName, fieldType);
    }

    // delta=0 → end StructWireType
    out.writeUInt(0n);
    // delta=0 → end WireType
    out.writeUInt(0n);
  }

  /** Write a FieldWireType (Name, Id) for a field. */
  private _writeFieldWireType(out: GobWriter, name: string, ft: GobFieldType): void {
    out.writeUInt(1n); // delta=1 → Name
    out.writeString(name);
    out.writeUInt(1n); // delta=1 → Id
    const wireTypeId = this._fieldTypeId(ft);
    out.writeInt(BigInt(wireTypeId));
    out.writeUInt(0n); // delta=0 → end FieldWireType
  }

  /** Get (or allocate) the wire type ID for a field type, ensuring collection type defs are emitted. */
  private _fieldTypeId(ft: GobFieldType): number {
    const f = ft as GobFieldType;

    if (f.kind === 'primitive') return f.typeId;
    if (f.kind === 'semantic') return this._fieldTypeId(f.wire);
    if (f.kind === 'struct') return this._ensureStructTypeDef(f.schema, false);

    if (f.kind === 'slice') {
      const sig = this._sliceSignature(f.elem);
      return this._ensureCollectionTypeDef(sig, f.elem, null, null, false, 0);
    }
    if (f.kind === 'array') {
      const sig = this._arraySignature(f.elem, f.length);
      return this._ensureCollectionTypeDef(sig, f.elem, null, null, true, f.length);
    }
    if (f.kind === 'map') {
      const sig = this._mapSignature(f.key, f.elem);
      return this._ensureCollectionTypeDef(sig, f.elem, f.key, null, false, 0);
    }
    if (f.kind === 'marshaler') {
      return this._ensureMarshalerTypeDef(f.typeName, f.marshalerKind);
    }

    throw new GobEncodeError(`_fieldTypeId: unsupported field type kind "${(f as {kind:string}).kind}"`);
  }

  /** Ensure a collection type def is emitted; return its type ID. */
  private _ensureCollectionTypeDef(
    sig: string,
    elemType: GobFieldType,
    keyType: GobFieldType | null,
    _unused: null,
    isArray: boolean,
    arrayLen: number,
  ): number {
    const existing = this._collectionRegistry.get(sig);
    if (existing !== undefined) return existing;

    const typeId = this._nextId++;
    this._collectionRegistry.set(sig, typeId);
    this._emittedTopLevel.add(typeId);

    const elemTypeId = this._fieldTypeId(elemType);

    const payload = new GobWriter();
    payload.writeInt(BigInt(-typeId));

    if (keyType !== null) {
      // Map: WireType delta=4 → MapT (field 3)
      const keyTypeId = this._fieldTypeId(keyType);
      payload.writeUInt(4n);
      // MapWireType: delta=1 → CommonType (empty name)
      payload.writeUInt(1n);
      // CommonType with empty name: skip Name (omitted), delta=2 → Id
      payload.writeUInt(2n);
      payload.writeInt(BigInt(typeId));
      payload.writeUInt(0n); // end CommonType
      payload.writeUInt(1n); // delta=1 → Key
      payload.writeInt(BigInt(keyTypeId));
      payload.writeUInt(1n); // delta=1 → Elem
      payload.writeInt(BigInt(elemTypeId));
      payload.writeUInt(0n); // end MapWireType
      payload.writeUInt(0n); // end WireType
    } else if (isArray) {
      // Array: WireType delta=1 → ArrayT (field 0)
      payload.writeUInt(1n);
      // ArrayWireType: delta=1 → CommonType (empty name)
      payload.writeUInt(1n);
      payload.writeUInt(2n); // skip Name, delta=2 → Id
      payload.writeInt(BigInt(typeId));
      payload.writeUInt(0n); // end CommonType
      payload.writeUInt(1n); // delta=1 → Elem
      payload.writeInt(BigInt(elemTypeId));
      payload.writeUInt(1n); // delta=1 → Len
      payload.writeInt(BigInt(arrayLen));
      payload.writeUInt(0n); // end ArrayWireType
      payload.writeUInt(0n); // end WireType
    } else {
      // Slice: WireType delta=2 → SliceT (field 1)
      payload.writeUInt(2n);
      // SliceWireType: delta=1 → CommonType (empty name)
      payload.writeUInt(1n);
      payload.writeUInt(2n); // skip Name, delta=2 → Id
      payload.writeInt(BigInt(typeId));
      payload.writeUInt(0n); // end CommonType
      payload.writeUInt(1n); // delta=1 → Elem
      payload.writeInt(BigInt(elemTypeId));
      payload.writeUInt(0n); // end SliceWireType
      payload.writeUInt(0n); // end WireType
    }

    this._writeFramed(payload.bytes());
    return typeId;
  }

  /** Marshalers: GobEncoder, BinaryMarshaler, TextMarshaler. */
  private _ensureMarshalerTypeDef(typeName: string, marshalerKind: 'gob' | 'binary' | 'text'): number {
    const key = `marshaler:${marshalerKind}:${typeName}`;
    const existing = this._collectionRegistry.get(key);
    if (existing !== undefined) return existing;

    const typeId = this._nextId++;
    this._collectionRegistry.set(key, typeId);
    this._emittedTopLevel.add(typeId);

    const payload = new GobWriter();
    payload.writeInt(BigInt(-typeId));

    // WireType field: gob=5 (field 4), binary=6 (field 5), text=7 (field 6).
    const delta = marshalerKind === 'gob' ? 5n : marshalerKind === 'binary' ? 6n : 7n;
    payload.writeUInt(delta);
    // MarshalerWireType: delta=1 → CommonType
    payload.writeUInt(1n);
    // CommonType: Name (non-empty for marshalers)
    payload.writeUInt(1n); // delta=1 → Name
    payload.writeString(typeName);
    payload.writeUInt(1n); // delta=1 → Id
    payload.writeInt(BigInt(typeId));
    payload.writeUInt(0n); // end CommonType
    payload.writeUInt(0n); // end MarshalerWireType
    payload.writeUInt(0n); // end WireType

    this._writeFramed(payload.bytes());
    return typeId;
  }

  // ---------------------------------------------------------------------------
  // Framing
  // ---------------------------------------------------------------------------

  private _writeFramed(msgBytes: Uint8Array): void {
    const len = new GobWriter();
    len.writeUInt(BigInt(msgBytes.length));
    this._outer.writeRaw(len.bytes());
    this._outer.writeRaw(msgBytes);

    // Flush any pending interface concrete values.
    const pending = this._pendingInterfaceValues.splice(0);
    for (const { typeId, value, schema } of pending) {
      this._emitInterfaceConcrete(typeId, value, schema);
    }
  }

  /** Emit a concrete interface value as a separate framed message. */
  private _emitInterfaceConcrete(typeId: number, value: Record<string, unknown>, schema: Schema): void {
    // Interface concrete value message payload:
    //   typeId (positive int) + uint(N) + struct_bytes(N)
    const structPayload = new GobWriter();
    this._writeStructPayload(structPayload, value, schema);
    const structBytes = structPayload.bytes();

    const msg = new GobWriter();
    msg.writeInt(BigInt(typeId));
    msg.writeUInt(BigInt(structBytes.length));
    msg.writeRaw(structBytes);

    this._writeFramed(msg.bytes());
  }

  // ---------------------------------------------------------------------------
  // Zero-value detection
  // ---------------------------------------------------------------------------

  private _isZero(value: unknown, ft: GobFieldType): boolean {
    if (value === null || value === undefined) return true;
    const f = ft as GobFieldType;

    if (f.kind === 'primitive') {
      return this._isPrimitiveZero(value, f.typeId);
    }
    if (f.kind === 'semantic') {
      // Compare against the semantic zero.
      return value === f.zero || this._isZero(f.encode(value), f.wire);
    }
    if (f.kind === 'struct') return false; // structs are never omitted
    if (f.kind === 'slice' || f.kind === 'array') {
      return Array.isArray(value) && (value as unknown[]).length === 0;
    }
    if (f.kind === 'map') {
      return value instanceof Map && value.size === 0;
    }
    if (f.kind === 'marshaler') return false; // marshaler values are never omitted
    return false;
  }

  private _isPrimitiveZero(value: unknown, typeId: number): boolean {
    if (typeId === BOOL) return value === false;
    if (typeId === INT || typeId === UINT) return value === 0n || value === 0;
    if (typeId === FLOAT) return value === 0;
    if (typeId === STRING) return value === '';
    if (typeId === BYTES) return value instanceof Uint8Array && value.length === 0;
    if (typeId === COMPLEX) return value instanceof Complex && value.equals(Complex.ZERO);
    if (typeId === INTERFACE) return value === null;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Inference helpers (for encode() without schema)
  // ---------------------------------------------------------------------------

  private _inferElemType(arr: unknown[]): GobFieldType {
    const first = arr[0];
    if (first === undefined) throw new GobEncodeError('cannot infer element type of empty slice — provide elemType option');
    return this._inferFieldType(first);
  }

  private _inferKeyType(map: Map<unknown, unknown>): GobFieldType {
    const first = map.keys().next().value;
    if (first === undefined) throw new GobEncodeError('cannot infer key type of empty map — provide keyType option');
    return this._inferFieldType(first);
  }

  private _inferMapElemType(map: Map<unknown, unknown>): GobFieldType {
    const first = map.values().next().value;
    if (first === undefined) throw new GobEncodeError('cannot infer value type of empty map — provide elemType option');
    return this._inferFieldType(first);
  }

  private _inferFieldType(value: unknown): GobFieldType {
    if (typeof value === 'boolean') return { kind: 'primitive', typeId: BOOL };
    if (typeof value === 'bigint') return { kind: 'primitive', typeId: INT };
    if (typeof value === 'number') return { kind: 'primitive', typeId: FLOAT };
    if (typeof value === 'string') return { kind: 'primitive', typeId: STRING };
    if (value instanceof Uint8Array) return { kind: 'primitive', typeId: BYTES };
    if (value instanceof Complex) return { kind: 'primitive', typeId: COMPLEX };
    throw new GobEncodeError(`cannot infer field type for ${typeof value}`);
  }

  // ---------------------------------------------------------------------------
  // Collection signature strings
  // ---------------------------------------------------------------------------

  private _sliceSignature(elem: GobFieldType): string {
    return `slice:${this._typeSignature(elem)}`;
  }

  private _arraySignature(elem: GobFieldType, len: number): string {
    return `array:${this._typeSignature(elem)}:${len}`;
  }

  private _mapSignature(key: GobFieldType, elem: GobFieldType): string {
    return `map:${this._typeSignature(key)}:${this._typeSignature(elem)}`;
  }

  private _typeSignature(ft: GobFieldType): string {
    const f = ft as GobFieldType;
    if (f.kind === 'primitive') return String(f.typeId);
    if (f.kind === 'semantic') return this._typeSignature(f.wire);
    if (f.kind === 'struct') return `s:${f.schema.name}`;
    if (f.kind === 'slice') return `slice:${this._typeSignature(f.elem)}`;
    if (f.kind === 'array') return `array:${this._typeSignature(f.elem)}:${f.length}`;
    if (f.kind === 'map') return `map:${this._typeSignature(f.key)}:${this._typeSignature(f.elem)}`;
    if (f.kind === 'marshaler') return `m:${f.marshalerKind}:${f.typeName}`;
    return 'unknown';
  }
}
