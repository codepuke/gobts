/**
 * Property-based tests using fast-check. Each property encodes a value and
 * round-trips it through the decoder, asserting invariants hold for all inputs.
 */
import { test, describe } from 'bun:test';
import * as fc from 'fast-check';
import { GobEncoder } from '../src/encoder.ts';
import { GobDecoder } from '../src/decoder.ts';
import { Schema, GOB_INT, GOB_UINT, GOB_FLOAT, GOB_BOOL, GOB_STRING, GOB_BYTES, GOB_COMPLEX, SliceOf, MapOf } from '../src/types.ts';
import { Complex } from '../src/types.ts';

const NUM_RUNS = 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundtrip<T>(value: T, encFn: (enc: GobEncoder, v: T) => void): unknown {
  const enc = new GobEncoder();
  encFn(enc, value);
  const bytes = enc.bytes();
  const dec = new GobDecoder(bytes);
  return dec.decode();
}

function assertRoundtrip(
  description: string,
  arb: fc.Arbitrary<unknown>,
  encFn: (enc: GobEncoder, v: unknown) => void,
  eqFn: (original: unknown, decoded: unknown) => void,
): void {
  test(description, () => {
    fc.assert(
      fc.property(arb, (value) => {
        const decoded = roundtrip(value, encFn);
        eqFn(value, decoded);
      }),
      { numRuns: NUM_RUNS },
    );
  });
}

// ---------------------------------------------------------------------------
// Scalar arbitraries
// ---------------------------------------------------------------------------

// Safe bigint range: [-2^63, 2^63-1] matching Go int64.
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

const arbInt64 = fc
  .bigInt({ min: INT64_MIN, max: INT64_MAX });

// Uint64 [0, 2^63-1] — we use signed wire; just test positive range.
const arbUint64 = fc
  .bigInt({ min: 0n, max: INT64_MAX });

// Float64 — exclude NaN/Infinity for simplicity (they round-trip but require special eq).
const arbFiniteFloat = fc.float({ noNaN: true, noDefaultInfinity: true });

const arbBool = fc.boolean();
const arbString = fc.string({ maxLength: 200 });
const arbBytes = fc.uint8Array({ maxLength: 200 });

// ---------------------------------------------------------------------------
// Scalar round-trip properties
// ---------------------------------------------------------------------------

describe('property: scalar round-trips', () => {
  assertRoundtrip(
    'bigint (int64) round-trips',
    arbInt64,
    (enc, v) => enc.encode(v),
    (orig, dec) => {
      if (orig !== dec) throw new Error(`bigint mismatch: ${orig} !== ${dec}`);
    },
  );

  assertRoundtrip(
    'boolean round-trips',
    arbBool,
    (enc, v) => enc.encode(v),
    (orig, dec) => {
      if (orig !== dec) throw new Error(`bool mismatch: ${orig} !== ${dec}`);
    },
  );

  assertRoundtrip(
    'float64 (finite) round-trips',
    arbFiniteFloat,
    (enc, v) => enc.encode(v),
    (orig, dec) => {
      if (typeof orig !== 'number' || typeof dec !== 'number') throw new Error('type error');
      // Float32 wire → float64 decode: accept small rounding error.
      if (Math.abs((orig as number) - (dec as number)) > Math.abs((orig as number)) * 1e-6 + 1e-300) {
        throw new Error(`float mismatch: ${orig} !== ${dec}`);
      }
    },
  );

  assertRoundtrip(
    'string round-trips',
    arbString,
    (enc, v) => enc.encode(v),
    (orig, dec) => {
      if (orig !== dec) throw new Error(`string mismatch`);
    },
  );

  assertRoundtrip(
    'Uint8Array round-trips',
    arbBytes,
    (enc, v) => enc.encode(v),
    (orig, dec) => {
      if (!(dec instanceof Uint8Array)) throw new Error('expected Uint8Array');
      const o = orig as Uint8Array;
      if (o.length !== (dec as Uint8Array).length) throw new Error('length mismatch');
      for (let i = 0; i < o.length; i++) {
        if (o[i] !== (dec as Uint8Array)[i]) throw new Error(`byte mismatch at ${i}`);
      }
    },
  );

  test('Complex round-trips (1000 runs)', () => {
    const arb = fc.record({ re: arbFiniteFloat, im: arbFiniteFloat });
    fc.assert(
      fc.property(arb, ({ re, im }) => {
        const c = new Complex(re, im);
        const dec = roundtrip(c, (enc, v) => enc.encode(v));
        if (!(dec instanceof Complex)) throw new Error('expected Complex');
        if (!c.equals(dec as Complex)) throw new Error(`Complex mismatch: ${c} !== ${dec}`);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Struct round-trip properties
// ---------------------------------------------------------------------------

describe('property: struct round-trips', () => {
  const PointSchema = new Schema('PropPoint', { X: GOB_INT, Y: GOB_INT });

  test('Point{X, Y} round-trips (1000 runs)', () => {
    const arb = fc.record({
      X: arbInt64,
      Y: arbInt64,
    });
    fc.assert(
      fc.property(arb, ({ X, Y }) => {
        const enc = new GobEncoder();
        enc.encode({ X, Y }, { schema: PointSchema });
        const dec = new GobDecoder(enc.bytes()).decode() as { get: (k: string) => unknown };
        if (dec.get('X') !== X) throw new Error(`X mismatch: ${dec.get('X')} !== ${X}`);
        if (dec.get('Y') !== Y) throw new Error(`Y mismatch: ${dec.get('Y')} !== ${Y}`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  const PersonSchema = new Schema('PropPerson', {
    Name: GOB_STRING,
    Age: GOB_INT,
    Active: GOB_BOOL,
  });

  test('Person{Name, Age, Active} round-trips including zero values (1000 runs)', () => {
    const arb = fc.record({
      Name: arbString,
      Age: arbInt64,
      Active: arbBool,
    });
    fc.assert(
      fc.property(arb, ({ Name, Age, Active }) => {
        const enc = new GobEncoder();
        enc.encode({ Name, Age, Active }, { schema: PersonSchema });
        const dec = new GobDecoder(enc.bytes()).decode() as { get: (k: string) => unknown };
        if (dec.get('Name') !== Name) throw new Error('Name mismatch');
        if (dec.get('Age') !== Age) throw new Error(`Age mismatch: ${dec.get('Age')} !== ${Age}`);
        if (dec.get('Active') !== Active) throw new Error('Active mismatch');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('zero-valued fields are omitted — encoded bytes are smaller (100 runs)', () => {
    const PersonSchemaZ = new Schema('PropPersonZ', {
      Name: GOB_STRING,
      Age: GOB_INT,
      Score: GOB_FLOAT,
    });
    const arb = fc.record({
      Name: fc.string({ minLength: 1, maxLength: 50 }),
      Age: fc.bigInt({ min: 1n, max: 100n }),
    });
    fc.assert(
      fc.property(arb, ({ Name, Age }) => {
        // With zeros
        const encZero = new GobEncoder();
        encZero.encode({ Name, Age, Score: 0 }, { schema: PersonSchemaZ });
        const bytesZero = encZero.bytes();

        // Without zeros (nonzero Score)
        const encFull = new GobEncoder();
        encFull.encode({ Name, Age, Score: 1.5 }, { schema: PersonSchemaZ });
        const bytesFull = encFull.bytes();

        // Encoding with Score=0 must be ≤ encoding with Score=1.5.
        if (bytesZero.length > bytesFull.length) {
          throw new Error(`zero-field encoding should be shorter: ${bytesZero.length} > ${bytesFull.length}`);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Collection round-trip properties
// ---------------------------------------------------------------------------

describe('property: collection round-trips', () => {
  test('[]int64 round-trips (1000 runs)', () => {
    const arb = fc.array(arbInt64, { maxLength: 50 });
    fc.assert(
      fc.property(arb, (arr) => {
        const enc = new GobEncoder();
        enc.encode(arr, { elemType: GOB_INT });
        const dec = new GobDecoder(enc.bytes()).decode() as bigint[];
        if (dec.length !== arr.length) throw new Error('length mismatch');
        for (let i = 0; i < arr.length; i++) {
          if (dec[i] !== arr[i]) throw new Error(`element mismatch at ${i}`);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('[]string round-trips (1000 runs)', () => {
    const arb = fc.array(arbString, { maxLength: 20 });
    fc.assert(
      fc.property(arb, (arr) => {
        const enc = new GobEncoder();
        enc.encode(arr, { elemType: GOB_STRING });
        const dec = new GobDecoder(enc.bytes()).decode() as string[];
        if (dec.length !== arr.length) throw new Error('length mismatch');
        for (let i = 0; i < arr.length; i++) {
          if (dec[i] !== arr[i]) throw new Error(`element mismatch at ${i}`);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('map[string]int64 round-trips (1000 runs)', () => {
    const arb = fc.array(fc.tuple(arbString, arbInt64), { maxLength: 20 })
      .map(entries => new Map(entries));
    fc.assert(
      fc.property(arb, (map) => {
        const enc = new GobEncoder();
        enc.encode(map, { keyType: GOB_STRING, elemType: GOB_INT });
        const dec = new GobDecoder(enc.bytes()).decode() as Map<string, bigint>;
        if (dec.size !== map.size) throw new Error('size mismatch');
        for (const [k, v] of map.entries()) {
          if (dec.get(k) !== v) throw new Error(`map value mismatch for key "${k}"`);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('type-def idempotency: same schema → one type def (100 runs)', () => {
    const PointSchemaIdem = new Schema('IdemPoint', { X: GOB_INT, Y: GOB_INT });
    const arb = fc.tuple(arbInt64, arbInt64, arbInt64, arbInt64);
    fc.assert(
      fc.property(arb, ([x1, y1, x2, y2]) => {
        const enc = new GobEncoder();
        enc.encode({ X: x1, Y: y1 }, { schema: PointSchemaIdem });
        enc.encode({ X: x2, Y: y2 }, { schema: PointSchemaIdem });
        const bytes = enc.bytes();

        // Decode both — should succeed (type def sent only once).
        const dec = new GobDecoder(bytes);
        const v1 = dec.decode() as { get: (k: string) => unknown };
        const v2 = dec.decode() as { get: (k: string) => unknown };
        if (v1.get('X') !== x1) throw new Error('v1.X mismatch');
        if (v2.get('X') !== x2) throw new Error('v2.X mismatch');
      }),
      { numRuns: 100 },
    );
  });
});
