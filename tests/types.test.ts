import { test, expect, describe } from 'bun:test';
import {
  Schema,
  GobObject,
  GobEncoded,
  Complex,
  GOB_BOOL,
  GOB_INT,
  GOB_UINT,
  GOB_FLOAT,
  GOB_BYTES,
  GOB_STRING,
  GOB_COMPLEX,
  GOB_INTERFACE,
  GOB_DURATION,
  SliceOf,
  MapOf,
  ArrayOf,
  Marshaler,
  SemanticType,
} from '../src/types.ts';
import type { InferSchema } from '../src/infer.ts';

// ---------------------------------------------------------------------------
// GOB_* constants
// ---------------------------------------------------------------------------

describe('GOB_* constants', () => {
  test('GOB_BOOL has kind primitive and typeId 1', () => {
    expect(GOB_BOOL.kind).toBe('primitive');
    expect(GOB_BOOL.typeId).toBe(1);
  });

  test('GOB_INT has typeId 2', () => {
    expect(GOB_INT.kind).toBe('primitive');
    expect(GOB_INT.typeId).toBe(2);
  });

  test('GOB_UINT has typeId 3', () => {
    expect(GOB_UINT.typeId).toBe(3);
  });

  test('GOB_FLOAT has typeId 4', () => {
    expect(GOB_FLOAT.typeId).toBe(4);
  });

  test('GOB_BYTES has typeId 5', () => {
    expect(GOB_BYTES.typeId).toBe(5);
  });

  test('GOB_STRING has typeId 6', () => {
    expect(GOB_STRING.typeId).toBe(6);
  });

  test('GOB_COMPLEX has typeId 7', () => {
    expect(GOB_COMPLEX.typeId).toBe(7);
  });

  test('GOB_INTERFACE has typeId 8', () => {
    expect(GOB_INTERFACE.typeId).toBe(8);
  });

  test('GOB_DURATION has same wire format as GOB_INT', () => {
    expect(GOB_DURATION.kind).toBe('primitive');
    expect(GOB_DURATION.typeId).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe('Schema', () => {
  test('Schema.name and fields are set in constructor', () => {
    const s = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    expect(s.name).toBe('Point');
    expect(s.fields.length).toBe(2);
    expect(s.fields[0]![0]).toBe('X');
    expect(s.fields[1]![0]).toBe('Y');
  });

  test('Schema.from() is equivalent to new Schema()', () => {
    const s = Schema.from('Foo', { A: GOB_STRING });
    expect(s.name).toBe('Foo');
    expect(s.fields[0]![0]).toBe('A');
  });

  test('Schema has kind "struct"', () => {
    const s = new Schema('X', { n: GOB_INT });
    expect(s.kind).toBe('struct');
  });

  test('Schema.schema returns itself (StructField compatibility)', () => {
    const s = new Schema('X', { n: GOB_INT });
    expect(s.schema).toBe(s);
  });

  test('Schema can be used directly as GobFieldType (nested struct)', () => {
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const LineSchema = new Schema('Line', {
      Start: PointSchema,
      End: PointSchema,
    });
    expect(lineSchema_getElemKind(LineSchema, 'Start')).toBe('struct');
    expect(lineSchema_getElemKind(LineSchema, 'End')).toBe('struct');
  });

  test('Schema accepts explicit StructField notation too', () => {
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const LineSchema = new Schema('Line', {
      Start: { kind: 'struct' as const, schema: PointSchema },
    });
    expect(lineSchema_getElemKind(LineSchema, 'Start')).toBe('struct');
  });
});

function lineSchema_getElemKind(schema: Schema, fieldName: string): string {
  const entry = schema.fields.find(([name]) => name === fieldName);
  return entry ? entry[1].kind : 'not found';
}

// ---------------------------------------------------------------------------
// Composite factories
// ---------------------------------------------------------------------------

describe('SliceOf', () => {
  test('returns slice field with elem', () => {
    const f = SliceOf(GOB_INT);
    expect(f.kind).toBe('slice');
    expect(f.elem).toBe(GOB_INT);
  });

  test('SliceOf(SliceOf(GOB_INT)) nests correctly', () => {
    const f = SliceOf(SliceOf(GOB_INT));
    expect(f.kind).toBe('slice');
    expect(f.elem.kind).toBe('slice');
  });
});

describe('MapOf', () => {
  test('returns map field with key and elem', () => {
    const f = MapOf(GOB_STRING, GOB_INT);
    expect(f.kind).toBe('map');
    expect(f.key).toBe(GOB_STRING);
    expect(f.elem).toBe(GOB_INT);
  });
});

describe('ArrayOf', () => {
  test('returns array field with elem and length', () => {
    const f = ArrayOf(GOB_INT, 3);
    expect(f.kind).toBe('array');
    expect(f.elem).toBe(GOB_INT);
    expect(f.length).toBe(3);
  });
});

describe('Marshaler', () => {
  test('returns marshaler field for gob kind', () => {
    const f = Marshaler('Time', 'gob');
    expect(f.kind).toBe('marshaler');
    expect(f.typeName).toBe('Time');
    expect(f.marshalerKind).toBe('gob');
  });

  test('returns marshaler field for binary kind', () => {
    const f = Marshaler('UUID', 'binary');
    expect(f.marshalerKind).toBe('binary');
  });

  test('returns marshaler field for text kind', () => {
    const f = Marshaler('MyType', 'text');
    expect(f.marshalerKind).toBe('text');
  });
});

describe('SemanticType', () => {
  test('wraps a wire type with encode/decode/zero', () => {
    const StatusField = SemanticType<string>({
      wire: GOB_INT,
      encode: (v: string) => BigInt(['active', 'inactive'].indexOf(v)),
      decode: (w: unknown) => ['active', 'inactive'][Number(w as bigint)] ?? 'active',
      zero: 'active',
    });
    expect(StatusField.kind).toBe('semantic');
    expect(StatusField.wire).toBe(GOB_INT);
    expect(StatusField.zero).toBe('active');
    expect(StatusField.encode('inactive')).toBe(1n);
    expect(StatusField.decode(0n)).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Complex.toString
// ---------------------------------------------------------------------------

describe('Complex.toString', () => {
  test('positive imaginary includes + sign', () => {
    expect(new Complex(1, 2).toString()).toBe('1+2i');
  });

  test('negative imaginary has no + prefix', () => {
    expect(new Complex(1, -2).toString()).toBe('1-2i');
  });

  test('zero imaginary includes + sign', () => {
    expect(new Complex(3, 0).toString()).toBe('3+0i');
  });

  test('negative zero imaginary omits + prefix (template formats -0 as "0")', () => {
    // Object.is(im, -0) suppresses the '+', but `${-0}` renders as "0" in JS.
    expect(new Complex(0, -0).toString()).toBe('00i');
  });
});

// ---------------------------------------------------------------------------
// GobObject
// ---------------------------------------------------------------------------

describe('GobObject', () => {
  test('stores type, fields; schema is optional', () => {
    const obj = new GobObject('Point', { X: 1n, Y: 2n });
    expect(obj.type).toBe('Point');
    expect(obj.schema).toBeUndefined();
    expect(obj.get('X')).toBe(1n);
  });

  test('stores schema when provided', () => {
    const s = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const obj = new GobObject('Point', { X: 1n, Y: 2n }, s);
    expect(obj.schema).toBe(s);
  });

  test('has(), keys(), values(), entries(), Symbol.iterator work', () => {
    const obj = new GobObject('P', { A: 'hello', B: 42n });
    expect(obj.has('A')).toBe(true);
    expect(obj.has('C')).toBe(false);
    expect(obj.keys()).toEqual(['A', 'B']);
    expect(obj.values()).toEqual(['hello', 42n]);
    expect(obj.entries()).toEqual([['A', 'hello'], ['B', 42n]]);
    const fromIter = [...obj];
    expect(fromIter).toEqual([['A', 'hello'], ['B', 42n]]);
  });
});

// ---------------------------------------------------------------------------
// GobEncoded
// ---------------------------------------------------------------------------

describe('GobEncoded', () => {
  test('stores typeName and data', () => {
    const data = new Uint8Array([1, 2, 3]);
    const ge = new GobEncoded('Time', data);
    expect(ge.typeName).toBe('Time');
    expect([...ge.data]).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// InferSchema — compile-time assertions (no runtime assertions needed,
// these errors manifest as type errors at build time).
// ---------------------------------------------------------------------------

describe('InferSchema type assertions (compile-time)', () => {
  test('no type errors from InferSchema assertions', () => {
    // All assertions below are purely compile-time; they just need to not
    // cause tsc errors. We wrap in a type alias to trigger checking.

    const PointSchema = new Schema('Point', {
      X: GOB_INT,
      Y: GOB_INT,
    });
    // type Point = InferSchema<typeof PointSchema>
    // Expected: { X: bigint; Y: bigint }
    type Point = InferSchema<typeof PointSchema>;
    // Check that a valid Point assignment compiles:
    const _p: Point = { X: 1n, Y: 2n };
    void _p;

    const PersonSchema = new Schema('Person', {
      Name: GOB_STRING,
      Age: GOB_INT,
      Active: GOB_BOOL,
    });
    type Person = InferSchema<typeof PersonSchema>;
    const _person: Person = { Name: 'Alice', Age: 30n, Active: true };
    void _person;

    const TagsSchema = new Schema('Tags', {
      Labels: SliceOf(GOB_STRING),
    });
    type Tags = InferSchema<typeof TagsSchema>;
    const _tags: Tags = { Labels: ['a', 'b'] };
    void _tags;

    // Ensure the assertions compile without error.
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// encode/decode convenience functions via index.ts
// ---------------------------------------------------------------------------

describe('encode/decode convenience functions', () => {
  test('encode + decode round-trips a bigint', async () => {
    const { encode, decode } = await import('../src/index.ts');
    const bytes = encode(42n);
    const result = decode<bigint>(bytes);
    expect(result).toBe(42n);
  });

  test('encode + decode round-trips a string', async () => {
    const { encode, decode } = await import('../src/index.ts');
    const bytes = encode('hello');
    const result = decode<string>(bytes);
    expect(result).toBe('hello');
  });

  test('encode + decode round-trips a struct', async () => {
    const { encode, decode, Schema, GOB_INT } = await import('../src/index.ts');
    const PointSchema = new Schema('Point2', { X: GOB_INT, Y: GOB_INT });
    const bytes = encode({ X: 10n, Y: 20n }, { schema: PointSchema });
    const result = decode(bytes) as { get: (k: string) => unknown };
    expect(result.get('X')).toBe(10n);
    expect(result.get('Y')).toBe(20n);
  });
});
