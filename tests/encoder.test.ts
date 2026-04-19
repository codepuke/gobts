import { test, expect, describe } from 'bun:test';
import { GobEncoder, Schema } from '../src/encoder.ts';
import { GobDecoder } from '../src/decoder.ts';
import { Complex, GobObject } from '../src/types.ts';
import { GobEncodeError } from '../src/errors.ts';
import { TimeCodec } from '../src/codecs/time.ts';
import { loadTestdata } from './fixtures.ts';

// GobFieldType factory helpers — these match Phase 5 public API names.
const GOB_BOOL = { kind: 'primitive' as const, typeId: 1 };
const GOB_INT = { kind: 'primitive' as const, typeId: 2 };
const GOB_UINT = { kind: 'primitive' as const, typeId: 3 };
const GOB_FLOAT = { kind: 'primitive' as const, typeId: 4 };
const GOB_BYTES = { kind: 'primitive' as const, typeId: 5 };
const GOB_STRING = { kind: 'primitive' as const, typeId: 6 };
const GOB_COMPLEX = { kind: 'primitive' as const, typeId: 7 };
const GOB_INTERFACE = { kind: 'primitive' as const, typeId: 8 };

function SliceOf(elem: typeof GOB_INT) { return { kind: 'slice' as const, elem }; }
function MapOf(key: typeof GOB_STRING, elem: typeof GOB_INT) { return { kind: 'map' as const, key, elem }; }
function ArrayOf(elem: typeof GOB_INT, length: number) { return { kind: 'array' as const, elem, length }; }

// Helpers
function encodeDecodeRoundtrip<T>(value: T, schema?: Schema): T {
  const enc = new GobEncoder();
  enc.encode(value, schema !== undefined ? { schema } : undefined);
  const bytes = enc.bytes();
  const dec = new GobDecoder(bytes);
  return dec.decode<T>();
}

// ---------------------------------------------------------------------------
// Scalar encoding — byte-level comparison with Go fixtures
// ---------------------------------------------------------------------------

describe('scalar encoding byte parity with Go fixtures', () => {
  test('scalar_int_positive: encodes 42', () => {
    const { gobBytes } = loadTestdata('scalar_int_positive');
    const enc = new GobEncoder();
    enc.encode(42n);
    expect([...enc.bytes()]).toEqual([...gobBytes]);
  });

  test('scalar_int_zero: encodes 0', () => {
    const { gobBytes } = loadTestdata('scalar_int_zero');
    const enc = new GobEncoder();
    enc.encode(0n);
    expect([...enc.bytes()]).toEqual([...gobBytes]);
  });

  test('scalar_bool_true: encodes true', () => {
    const { gobBytes } = loadTestdata('scalar_bool_true');
    const enc = new GobEncoder();
    enc.encode(true);
    expect([...enc.bytes()]).toEqual([...gobBytes]);
  });

  test('scalar_bool_false: encodes false', () => {
    const { gobBytes } = loadTestdata('scalar_bool_false');
    const enc = new GobEncoder();
    enc.encode(false);
    expect([...enc.bytes()]).toEqual([...gobBytes]);
  });

  test('scalar_float_zero: encodes 0.0', () => {
    const { gobBytes } = loadTestdata('scalar_float_zero');
    const enc = new GobEncoder();
    enc.encode(0.0);
    expect([...enc.bytes()]).toEqual([...gobBytes]);
  });

  test('scalar_string_empty: encodes ""', () => {
    const { gobBytes } = loadTestdata('scalar_string_empty');
    const enc = new GobEncoder();
    enc.encode('');
    expect([...enc.bytes()]).toEqual([...gobBytes]);
  });
});

// ---------------------------------------------------------------------------
// Type-def idempotency
// ---------------------------------------------------------------------------

describe('type-def idempotency', () => {
  test('same schema emits type def only once', () => {
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const enc = new GobEncoder();
    enc.encode({ X: 1n, Y: 2n }, { schema: PointSchema });
    enc.encode({ X: 3n, Y: 4n }, { schema: PointSchema });
    const bytes = enc.bytes();

    // Decode both values — type def should appear only once.
    const dec = new GobDecoder(bytes);
    const v1 = dec.decode() as { get: (k: string) => unknown };
    const v2 = dec.decode() as { get: (k: string) => unknown };
    expect(v1.get('X')).toBe(1n);
    expect(v2.get('X')).toBe(3n);
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests
// ---------------------------------------------------------------------------

describe('round-trip: scalars', () => {
  test('round-trips boolean true', () => {
    expect(encodeDecodeRoundtrip(true)).toBe(true);
  });

  test('round-trips boolean false', () => {
    expect(encodeDecodeRoundtrip(false)).toBe(false);
  });

  test('round-trips bigint 42n', () => {
    expect(encodeDecodeRoundtrip(42n)).toBe(42n);
  });

  test('round-trips bigint max int64', () => {
    const v = 2n ** 63n - 1n;
    expect(encodeDecodeRoundtrip(v)).toBe(v);
  });

  test('round-trips bigint min int64', () => {
    const v = -(2n ** 63n);
    expect(encodeDecodeRoundtrip(v)).toBe(v);
  });

  test('round-trips float 3.14', () => {
    expect(encodeDecodeRoundtrip(3.14)).toBeCloseTo(3.14, 10);
  });

  test('round-trips float 0.0', () => {
    expect(encodeDecodeRoundtrip(0.0)).toBe(0);
  });

  test('round-trips Infinity', () => {
    expect(encodeDecodeRoundtrip(Infinity)).toBe(Infinity);
  });

  test('round-trips NaN', () => {
    expect(isNaN(encodeDecodeRoundtrip(NaN) as number)).toBe(true);
  });

  test('round-trips string', () => {
    expect(encodeDecodeRoundtrip('hello, world')).toBe('hello, world');
  });

  test('round-trips empty string', () => {
    expect(encodeDecodeRoundtrip('')).toBe('');
  });

  test('round-trips multibyte UTF-8 string', () => {
    const s = '日本語 🎉';
    expect(encodeDecodeRoundtrip(s)).toBe(s);
  });

  test('round-trips bytes', () => {
    const b = new Uint8Array([1, 2, 3, 4, 5]);
    const result = encodeDecodeRoundtrip(b) as Uint8Array;
    expect([...result]).toEqual([...b]);
  });

  test('round-trips Complex', () => {
    const c = new Complex(1.5, -2.5);
    const result = encodeDecodeRoundtrip(c) as Complex;
    expect(result.equals(c)).toBe(true);
  });
});

describe('round-trip: structs', () => {
  test('round-trips simple struct', () => {
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const enc = new GobEncoder();
    enc.encode({ X: 22n, Y: 33n }, { schema: PointSchema });
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as { get: (k: string) => unknown };
    expect(v.get('X')).toBe(22n);
    expect(v.get('Y')).toBe(33n);
  });

  test('round-trips struct with zero-value fields omitted', () => {
    const PersonSchema = new Schema('Person', {
      Name: GOB_STRING,
      Age: GOB_INT,
      Active: GOB_BOOL,
    });
    const enc = new GobEncoder();
    enc.encode({ Name: 'Alice', Age: 30n, Active: false }, { schema: PersonSchema });
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as { get: (k: string) => unknown };
    expect(v.get('Name')).toBe('Alice');
    expect(v.get('Age')).toBe(30n);
    expect(v.get('Active')).toBe(false); // zero value, pre-populated by decoder
  });

  test('round-trips nested struct', () => {
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const LineSchema = new Schema('Line', {
      Start: { kind: 'struct' as const, schema: PointSchema },
      End: { kind: 'struct' as const, schema: PointSchema },
    });
    const enc = new GobEncoder();
    enc.encode(
      { Start: { X: 0n, Y: 0n }, End: { X: 10n, Y: 20n } },
      { schema: LineSchema }
    );
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as { get: (k: string) => { get: (k: string) => unknown } };
    expect(v.get('End').get('X')).toBe(10n);
    expect(v.get('End').get('Y')).toBe(20n);
  });
});

describe('round-trip: collections', () => {
  test('round-trips slice of ints', () => {
    const enc = new GobEncoder();
    enc.encode([1n, 2n, 3n], { elemType: GOB_INT });
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as bigint[];
    expect(v.map(Number)).toEqual([1, 2, 3]);
  });

  test('round-trips empty slice', () => {
    const enc = new GobEncoder();
    enc.encode([], { elemType: GOB_INT });
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as unknown[];
    expect(v).toHaveLength(0);
  });

  test('round-trips map string→int', () => {
    const enc = new GobEncoder();
    const m = new Map([['a', 1n], ['b', 2n]]);
    enc.encode(m, { keyType: GOB_STRING, elemType: GOB_INT });
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as Map<string, bigint>;
    expect(v.get('a')).toBe(1n);
    expect(v.get('b')).toBe(2n);
  });

  test('round-trips empty map', () => {
    const enc = new GobEncoder();
    enc.encode(new Map(), { keyType: GOB_STRING, elemType: GOB_INT });
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as Map<unknown, unknown>;
    expect(v.size).toBe(0);
  });

  test('round-trips struct in slice field', () => {
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const ContainerSchema = new Schema('Container', {
      Points: { kind: 'slice' as const, elem: { kind: 'struct' as const, schema: PointSchema } },
    });
    const enc = new GobEncoder();
    enc.encode(
      { Points: [{ X: 1n, Y: 2n }, { X: 3n, Y: 4n }] },
      { schema: ContainerSchema }
    );
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as { get: (k: string) => unknown };
    const pts = v.get('Points') as Array<{ get: (k: string) => unknown }>;
    expect(pts[0]!.get('X')).toBe(1n);
    expect(pts[1]!.get('Y')).toBe(4n);
  });
});

describe('round-trip: struct parity with Go fixtures', () => {
  // These test that our TS-encoded struct, when decoded, matches the Go fixture.
  test('struct_simple encodes same value as Go fixture', () => {
    const { gobBytes } = loadTestdata('struct_simple');
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const enc = new GobEncoder();
    enc.encode({ X: 22n, Y: 33n }, { schema: PointSchema });
    const tsBytes = enc.bytes();

    // Decode Go bytes and TS bytes — must produce same values.
    const decGo = new GobDecoder(gobBytes);
    const decTs = new GobDecoder(tsBytes);
    const goVal = decGo.decode() as { get: (k: string) => unknown };
    const tsVal = decTs.decode() as { get: (k: string) => unknown };
    expect(goVal.get('X')).toBe(tsVal.get('X'));
    expect(goVal.get('Y')).toBe(tsVal.get('Y'));
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('GobEncoder.reset()', () => {
  test('clears accumulated bytes so next bytes() call starts fresh', () => {
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const enc = new GobEncoder();
    enc.encode({ X: 1n, Y: 2n }, { schema: PointSchema });
    const firstBytes = enc.bytes(); // consumes buffer

    // Second encode without reset: no type-def (already emitted).
    enc.encode({ X: 3n, Y: 4n }, { schema: PointSchema });
    const secondBytes = enc.bytes();

    // After reset: type-def must be re-emitted, so output is at least as large.
    enc.reset();
    enc.encode({ X: 5n, Y: 6n }, { schema: PointSchema });
    const afterResetBytes = enc.bytes();

    expect(afterResetBytes.length).toBeGreaterThanOrEqual(firstBytes.length);
    expect(afterResetBytes.length).toBeGreaterThan(secondBytes.length);
  });

  test('after reset, decoded value is correct', () => {
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const enc = new GobEncoder();
    enc.encode({ X: 1n, Y: 2n }, { schema: PointSchema });
    enc.bytes(); // discard
    enc.reset();
    enc.encode({ X: 99n, Y: 77n }, { schema: PointSchema });
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as { get: (k: string) => unknown };
    expect(v.get('X')).toBe(99n);
    expect(v.get('Y')).toBe(77n);
  });
});

// ---------------------------------------------------------------------------
// register() and registerCodec()
// ---------------------------------------------------------------------------

describe('GobEncoder.register() / registerCodec()', () => {
  test('register() stores a schema for interface fields', () => {
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const ContainerSchema = new Schema('Container', { Value: GOB_INTERFACE });
    const enc = new GobEncoder();
    enc.register('main.Point', PointSchema);
    const point = new GobObject('main.Point', { X: 3n, Y: 4n });
    enc.encode({ Value: point }, { schema: ContainerSchema });
    const dec = new GobDecoder(enc.bytes());
    const result = dec.decode() as GobObject;
    const inner = result.get('Value') as GobObject;
    expect(inner).toBeInstanceOf(GobObject);
    expect(inner.get('X')).toBe(3n);
    expect(inner.get('Y')).toBe(4n);
  });

  test('registerCodec() stores a codec for marshaler fields', () => {
    const d = new Date(1257894000000);
    const enc = new GobEncoder();
    enc.registerCodec('Time', TimeCodec);
    enc.encode(d, { marshalerType: 'Time', marshalerKind: 'gob' });
    const dec = new GobDecoder(enc.bytes());
    dec.registerCodec('Time', TimeCodec);
    const result = dec.decode<Date>();
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(d.getTime());
  });
});

// ---------------------------------------------------------------------------
// GobObject at top level with schema
// ---------------------------------------------------------------------------

describe('GobObject encoding at top level', () => {
  test('encodes GobObject with schema and round-trips correctly', () => {
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const enc = new GobEncoder();
    const obj = new GobObject('Point', { X: 5n, Y: 6n }, PointSchema);
    enc.encode(obj);
    const dec = new GobDecoder(enc.bytes());
    const result = dec.decode() as GobObject;
    expect(result.get('X')).toBe(5n);
    expect(result.get('Y')).toBe(6n);
  });

  test('throws GobEncodeError when GobObject has no schema', () => {
    const enc = new GobEncoder();
    const obj = new GobObject('Point', { X: 1n, Y: 2n }); // no schema
    expect(() => enc.encode(obj)).toThrow(GobEncodeError);
  });
});

// ---------------------------------------------------------------------------
// Interface field encoding
// ---------------------------------------------------------------------------

describe('interface field encoding', () => {
  const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
  const ContainerSchema = new Schema('Container', { Name: GOB_STRING, Value: GOB_INTERFACE });

  test('round-trips a struct in an interface field', () => {
    const enc = new GobEncoder();
    enc.register('main.Point', PointSchema);
    const point = new GobObject('main.Point', { X: 10n, Y: 20n });
    enc.encode({ Name: 'test', Value: point }, { schema: ContainerSchema });
    const dec = new GobDecoder(enc.bytes());
    const result = dec.decode() as GobObject;
    expect(result.get('Name')).toBe('test');
    const inner = result.get('Value') as GobObject;
    expect(inner).toBeInstanceOf(GobObject);
    expect(inner.get('X')).toBe(10n);
    expect(inner.get('Y')).toBe(20n);
  });

  test('encodes nil interface (null value)', () => {
    const enc = new GobEncoder();
    enc.encode({ Name: 'nil-test', Value: null }, { schema: ContainerSchema });
    const dec = new GobDecoder(enc.bytes());
    const result = dec.decode() as GobObject;
    expect(result.get('Value')).toBeNull();
  });

  test('throws when interface value is a plain object (not GobObject)', () => {
    const enc = new GobEncoder();
    enc.register('main.Point', PointSchema);
    expect(() =>
      enc.encode({ Name: 'x', Value: { X: 1n, Y: 2n } }, { schema: ContainerSchema })
    ).toThrow(GobEncodeError);
  });

  test('throws when interface GobObject type is not registered', () => {
    const enc = new GobEncoder();
    // Do NOT call enc.register() for 'Unregistered'
    const unknown = new GobObject('Unregistered', { X: 1n });
    expect(() =>
      enc.encode({ Name: 'x', Value: unknown }, { schema: ContainerSchema })
    ).toThrow(GobEncodeError);
  });

  test('throws when interface value is a primitive', () => {
    const enc = new GobEncoder();
    expect(() =>
      enc.encode({ Name: 'x', Value: 42n }, { schema: ContainerSchema })
    ).toThrow(GobEncodeError);
  });
});

// ---------------------------------------------------------------------------
// Type inference for slices and maps
// ---------------------------------------------------------------------------

describe('type inference', () => {
  test('infers elem type from non-empty slice', () => {
    const enc = new GobEncoder();
    enc.encode([1n, 2n, 3n]);
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as bigint[];
    expect(v.map(Number)).toEqual([1, 2, 3]);
  });

  test('infers key and value types from non-empty map', () => {
    const enc = new GobEncoder();
    enc.encode(new Map([['a', 1n], ['b', 2n]]));
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as Map<string, bigint>;
    expect(v.get('a')).toBe(1n);
  });

  test('throws GobEncodeError when inferring elem type of empty slice', () => {
    const enc = new GobEncoder();
    expect(() => enc.encode([])).toThrow(GobEncodeError);
  });

  test('throws GobEncodeError when inferring key/value type of empty map', () => {
    const enc = new GobEncoder();
    expect(() => enc.encode(new Map())).toThrow(GobEncodeError);
  });

  test('infers boolean element type', () => {
    const enc = new GobEncoder();
    enc.encode([true, false]);
    const dec = new GobDecoder(enc.bytes());
    expect(dec.decode()).toEqual([true, false]);
  });

  test('infers float element type', () => {
    const enc = new GobEncoder();
    enc.encode([1.5, 2.5]);
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as number[];
    expect(v[0]).toBeCloseTo(1.5, 10);
  });

  test('infers string element type', () => {
    const enc = new GobEncoder();
    enc.encode(['hello', 'world']);
    const dec = new GobDecoder(enc.bytes());
    expect(dec.decode()).toEqual(['hello', 'world']);
  });

  test('infers bytes element type', () => {
    const enc = new GobEncoder();
    const b = new Uint8Array([1, 2, 3]);
    enc.encode([b]);
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as Uint8Array[];
    expect([...v[0]!]).toEqual([1, 2, 3]);
  });

  test('infers Complex element type', () => {
    const enc = new GobEncoder();
    enc.encode([new Complex(1, 2)]);
    const dec = new GobDecoder(enc.bytes());
    const v = dec.decode() as Complex[];
    expect(v[0]!.re).toBeCloseTo(1, 10);
    expect(v[0]!.im).toBeCloseTo(2, 10);
  });

  test('throws GobEncodeError for unrecognized element type in inference', () => {
    const enc = new GobEncoder();
    // Object is not a supported primitive — inference should fail.
    expect(() => enc.encode([{ x: 1 }])).toThrow(GobEncodeError);
  });

  test('throws GobEncodeError for unsupported top-level type', () => {
    const enc = new GobEncoder();
    expect(() => enc.encode(null as unknown as bigint)).toThrow(GobEncodeError);
  });
});
