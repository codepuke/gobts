// ---------------------------------------------------------------------------
// Complex number for gob complex128 values.
// ---------------------------------------------------------------------------

export class Complex {
  readonly re: number;
  readonly im: number;

  constructor(re: number, im: number) {
    this.re = re;
    this.im = im;
  }

  static readonly ZERO: Complex = new Complex(0, 0);

  equals(other: Complex): boolean {
    const reEq = this.re === other.re || (isNaN(this.re) && isNaN(other.re));
    const imEq = this.im === other.im || (isNaN(this.im) && isNaN(other.im));
    return reEq && imEq;
  }

  toString(): string {
    const sign = this.im < 0 || Object.is(this.im, -0) ? '' : '+';
    return `${this.re}${sign}${this.im}i`;
  }
}

// ---------------------------------------------------------------------------
// GobEncoded — opaque bytes for a marshaler type without a registered codec
// ---------------------------------------------------------------------------

export class GobEncoded {
  readonly typeName: string;
  readonly data: Uint8Array;

  constructor(typeName: string, data: Uint8Array) {
    this.typeName = typeName;
    this.data = data;
  }
}

// ---------------------------------------------------------------------------
// GobFieldType — discriminated union for field type descriptors
// ---------------------------------------------------------------------------

export interface PrimitiveField {
  readonly kind: 'primitive';
  readonly typeId: number;
}

export interface SliceField {
  readonly kind: 'slice';
  readonly elem: GobFieldType;
}

export interface MapField {
  readonly kind: 'map';
  readonly key: GobFieldType;
  readonly elem: GobFieldType;
}

export interface ArrayField {
  readonly kind: 'array';
  readonly elem: GobFieldType;
  readonly length: number;
}

export interface StructField {
  readonly kind: 'struct';
  readonly schema: Schema;
}

export interface MarshalerField {
  readonly kind: 'marshaler';
  readonly typeName: string;
  readonly marshalerKind: 'gob' | 'binary' | 'text';
}

export interface SemanticField<T = unknown> {
  readonly kind: 'semantic';
  readonly wire: GobFieldType;
  // Method syntax, not a readonly property: TS checks property-typed function
  // parameters contravariantly, which would make SemanticField<Status>
  // unassignable to SemanticField<unknown> and so unusable inside a Schema.
  // Method parameters are checked bivariantly, which is what a field
  // descriptor needs. Type-level only — no runtime difference.
  encode(value: T): unknown;
  decode(wire: unknown): T;
  readonly zero: T;
}

export type FieldMap = Record<string, GobFieldType>;

export type GobFieldType =
  | PrimitiveField
  | SliceField
  | MapField
  | ArrayField
  | StructField
  | MarshalerField
  | SemanticField<unknown>;

// ---------------------------------------------------------------------------
// Schema — named struct definition. Implements StructField so it can be used
// directly as a GobFieldType (nested struct shorthand).
// ---------------------------------------------------------------------------

export class Schema<out F extends FieldMap = FieldMap> {
  readonly kind = 'struct' as const;
  readonly name: string;
  readonly fields: ReadonlyArray<readonly [string, GobFieldType]>;

  // Phantom field for InferSchema — not emitted at runtime.
  declare readonly _fields: F;

  // Self-reference enables Schema to satisfy StructField.
  get schema(): Schema<F> { return this; }

  constructor(name: string, fields: F) {
    this.name = name;
    this.fields = Object.entries(fields) as ReadonlyArray<readonly [string, GobFieldType]>;
  }

  static from<F extends FieldMap>(name: string, fields: F): Schema<F> {
    return new Schema(name, fields);
  }
}

// ---------------------------------------------------------------------------
// GobObject — decoded struct with no registered TS type
// ---------------------------------------------------------------------------

export class GobObject {
  readonly type: string;
  readonly schema: Schema | undefined;
  readonly fields: Readonly<Record<string, unknown>>;

  constructor(type: string, fields: Record<string, unknown>, schema?: Schema) {
    this.type = type;
    this.fields = fields;
    this.schema = schema;
  }

  get(key: string): unknown {
    return this.fields[key];
  }

  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.fields, key);
  }

  keys(): string[] {
    return Object.keys(this.fields);
  }

  values(): unknown[] {
    return Object.values(this.fields);
  }

  entries(): Array<[string, unknown]> {
    return Object.entries(this.fields);
  }

  [Symbol.iterator](): IterableIterator<[string, unknown]> {
    return Object.entries(this.fields)[Symbol.iterator]();
  }
}

// ---------------------------------------------------------------------------
// Primitive constants — use `as const` to preserve literal typeId types for
// InferSchema<S> type inference.
// ---------------------------------------------------------------------------

export const GOB_BOOL = { kind: 'primitive' as const, typeId: 1 as const };
export const GOB_INT = { kind: 'primitive' as const, typeId: 2 as const };
export const GOB_UINT = { kind: 'primitive' as const, typeId: 3 as const };
export const GOB_FLOAT = { kind: 'primitive' as const, typeId: 4 as const };
export const GOB_BYTES = { kind: 'primitive' as const, typeId: 5 as const };
export const GOB_STRING = { kind: 'primitive' as const, typeId: 6 as const };
export const GOB_COMPLEX = { kind: 'primitive' as const, typeId: 7 as const };
export const GOB_INTERFACE = { kind: 'primitive' as const, typeId: 8 as const };

// time.Duration: bigint nanoseconds on the wire — same wire format as GOB_INT.
export const GOB_DURATION = { kind: 'primitive' as const, typeId: 2 as const };

// ---------------------------------------------------------------------------
// Composite factories
// ---------------------------------------------------------------------------

export function SliceOf(elem: GobFieldType): SliceField {
  return { kind: 'slice', elem };
}

export function MapOf(key: GobFieldType, elem: GobFieldType): MapField {
  return { kind: 'map', key, elem };
}

export function ArrayOf(elem: GobFieldType, length: number): ArrayField {
  return { kind: 'array', elem, length };
}

export function Marshaler(typeName: string, marshalerKind: 'gob' | 'binary' | 'text'): MarshalerField {
  return { kind: 'marshaler', typeName, marshalerKind };
}

export function SemanticType<T>(opts: {
  wire: GobFieldType;
  encode: (value: T) => unknown;
  decode: (wire: unknown) => T;
  zero: T;
}): SemanticField<T> {
  return { kind: 'semantic', ...opts };
}
