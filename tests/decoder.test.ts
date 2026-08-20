import { test, expect, describe } from 'bun:test';
import { GobDecoder } from '../src/decoder.ts';
import { GobObject, GobEncoded } from '../src/types.ts';
import { GobDecodeError } from '../src/errors.ts';
import { GobWriter } from '../src/codec.ts';
import { TimeCodec } from '../src/codecs/time.ts';
import { loadTestdata, TESTDATA_NAMES, normalize } from './fixtures.ts';

/** Strip JSON-sidecar metadata fields (gob_type, type, fields, elem_type, key_type)
 *  recursively, leaving only the actual values for comparison. */
function stripMeta(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return (v as unknown[]).map(stripMeta);
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (k === 'gob_type' || k === 'type' || k === 'fields' || k === 'elem_type' || k === 'key_type') continue;
    out[k] = stripMeta(val);
  }
  return out;
}

// Fixtures that produce GobEncoded (codec-dependent) — tested separately.
const GOB_ENCODED_FIXTURES = new Set(['scalar_time', 'scalar_uuid', 'struct_with_uuid']);

// ---------------------------------------------------------------------------
// Parametric: decode every .gob fixture and compare to its .json sidecar
// ---------------------------------------------------------------------------

describe('decode Go fixtures', () => {
  for (const name of TESTDATA_NAMES) {
    if (GOB_ENCODED_FIXTURES.has(name)) continue;

    test(`decodes ${name}`, () => {
      const { gobBytes, expected } = loadTestdata(name);
      const dec = new GobDecoder(gobBytes);

      if (name === 'multi_message') {
        // Two values in one stream.
        const v1 = dec.decode();
        const v2 = dec.decode();
        const items = expected as Array<Record<string, unknown>>;
        expect(normalize(v1)).toEqual(stripMeta(normalize(items[0]!['value'])));
        expect(normalize(v2)).toEqual(stripMeta(normalize(items[1]!['value'])));
        return;
      }

      const result = dec.decode();
      const exp = expected as Record<string, unknown>;
      const expectedVal = exp['value'];

      if (exp['type'] === 'struct') {
        expect(result).toBeInstanceOf(GobObject);
        const obj = result as GobObject;
        const value = expectedVal as Record<string, unknown>;
        for (const [k, v] of Object.entries(value)) {
          if (k === 'gob_type') continue;  // skip metadata
          expect(normalize(obj.get(k))).toEqual(stripMeta(normalize(v)));
        }
      } else if (exp['type'] === 'int' || exp['type'] === 'uint') {
        expect(normalize(result)).toBe(expectedVal);
      } else if (exp['type'] === 'float') {
        const actual = result as number;
        const expF = expectedVal as number;
        if (isNaN(expF)) {
          expect(isNaN(actual)).toBe(true);
        } else {
          expect(actual).toBeCloseTo(expF, 10);
        }
      } else if (exp['type'] === 'bool' || exp['type'] === 'string') {
        expect(result).toBe(expectedVal);
      } else if (exp['type'] === 'bytes') {
        expect(normalize(result)).toBe(expectedVal);
      } else if (exp['type'] === 'complex') {
        const val = expectedVal as { real: number; imag: number };
        const normalized = normalize(result) as { real: number; imag: number };
        expect(normalized.real).toBeCloseTo(val.real, 10);
        expect(normalized.imag).toBeCloseTo(val.imag, 10);
      } else if (exp['type'] === 'slice' || exp['type'] === 'array') {
        expect(normalize(result)).toEqual(stripMeta((expectedVal as unknown[]).map(normalize)));
      } else if (exp['type'] === 'map') {
        expect(normalize(result)).toEqual(stripMeta(normalize(expectedVal)));
      } else {
        expect(normalize(result)).toEqual(stripMeta(normalize(expectedVal)));
      }
    });
  }
});

// ---------------------------------------------------------------------------
// GobEncoded fixtures (no codec registered → returns GobEncoded)
// ---------------------------------------------------------------------------

describe('decode GobEncoded fixtures', () => {
  test('scalar_time decodes to GobEncoded("Time", ...)', () => {
    const { gobBytes } = loadTestdata('scalar_time');
    const dec = new GobDecoder(gobBytes);
    const result = dec.decode();
    expect(result).toBeInstanceOf(GobEncoded);
    const ge = result as GobEncoded;
    expect(ge.typeName).toBe('Time');
    expect(ge.data.length).toBeGreaterThan(0);
  });

  test('scalar_uuid decodes to GobEncoded("UUID", ...)', () => {
    const { gobBytes } = loadTestdata('scalar_uuid');
    const dec = new GobDecoder(gobBytes);
    const result = dec.decode();
    expect(result).toBeInstanceOf(GobEncoded);
    const ge = result as GobEncoded;
    expect(ge.typeName).toBe('UUID');
    expect(ge.data.length).toBe(16);
  });

  test('struct_with_uuid decodes struct fields including UUID', () => {
    const { gobBytes } = loadTestdata('struct_with_uuid');
    const dec = new GobDecoder(gobBytes);
    const result = dec.decode();
    expect(result).toBeInstanceOf(GobObject);
    const obj = result as GobObject;
    const id = obj.get('ID');
    expect(id).toBeInstanceOf(GobEncoded);
    expect((id as GobEncoded).typeName).toBe('UUID');
    expect((id as GobEncoded).data.length).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Specific decoding assertions
// ---------------------------------------------------------------------------

describe('scalar decoding', () => {
  test('scalar_bool_true → true', () => {
    const { gobBytes } = loadTestdata('scalar_bool_true');
    expect(new GobDecoder(gobBytes).decode<boolean>()).toBe(true);
  });

  test('scalar_bool_false → false', () => {
    const { gobBytes } = loadTestdata('scalar_bool_false');
    expect(new GobDecoder(gobBytes).decode<boolean>()).toBe(false);
  });

  test('scalar_int_positive → 42n', () => {
    const { gobBytes } = loadTestdata('scalar_int_positive');
    expect(new GobDecoder(gobBytes).decode<bigint>()).toBe(42n);
  });

  test('scalar_int_zero → 0n', () => {
    const { gobBytes } = loadTestdata('scalar_int_zero');
    expect(new GobDecoder(gobBytes).decode<bigint>()).toBe(0n);
  });

  test('scalar_int_negative → negative bigint', () => {
    const { gobBytes } = loadTestdata('scalar_int_negative');
    const v = new GobDecoder(gobBytes).decode() as bigint;
    expect(v < 0n).toBe(true);
  });

  test('scalar_int_large → large bigint', () => {
    const { gobBytes } = loadTestdata('scalar_int_large');
    const v = new GobDecoder(gobBytes).decode() as bigint;
    expect(v).toBeGreaterThan(0n);
  });

  test('scalar_uint → bigint', () => {
    const { gobBytes } = loadTestdata('scalar_uint');
    const v = new GobDecoder(gobBytes).decode();
    expect(typeof v).toBe('bigint');
    expect(v as bigint >= 0n).toBe(true);
  });

  test('scalar_float → number', () => {
    const { gobBytes } = loadTestdata('scalar_float');
    const v = new GobDecoder(gobBytes).decode() as number;
    expect(v).toBeCloseTo(3.14159, 5);
  });

  test('scalar_float_zero → 0', () => {
    const { gobBytes } = loadTestdata('scalar_float_zero');
    expect(new GobDecoder(gobBytes).decode<number>()).toBe(0);
  });

  test('scalar_string → "hello, world"', () => {
    const { gobBytes } = loadTestdata('scalar_string');
    const v = new GobDecoder(gobBytes).decode() as string;
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });

  test('scalar_string_empty → ""', () => {
    const { gobBytes } = loadTestdata('scalar_string_empty');
    expect(new GobDecoder(gobBytes).decode<string>()).toBe('');
  });

  test('scalar_bytes → Uint8Array', () => {
    const { gobBytes } = loadTestdata('scalar_bytes');
    const v = new GobDecoder(gobBytes).decode();
    expect(v).toBeInstanceOf(Uint8Array);
  });
});

describe('struct decoding', () => {
  test('struct_simple decodes Point{X:22, Y:33}', () => {
    const { gobBytes } = loadTestdata('struct_simple');
    const v = new GobDecoder(gobBytes).decode() as GobObject;
    expect(v).toBeInstanceOf(GobObject);
    expect(v.type).toBe('Point');
    expect(v.get('X')).toBe(22n);
    expect(v.get('Y')).toBe(33n);
  });

  test('struct_zero_fields: missing fields get zero values', () => {
    const { gobBytes } = loadTestdata('struct_zero_fields');
    const v = new GobDecoder(gobBytes).decode() as GobObject;
    expect(v).toBeInstanceOf(GobObject);
    // At least one field should be present; missing ones are zero.
    expect(typeof v.get('Name')).toBe('string');
    expect(v.get('Value')).toBe(0n);  // zero int
  });

  test('struct_nested has nested GobObject', () => {
    const { gobBytes } = loadTestdata('struct_nested');
    const v = new GobDecoder(gobBytes).decode() as GobObject;
    expect(v).toBeInstanceOf(GobObject);
    const origin = v.get('Origin');
    expect(origin).toBeInstanceOf(GobObject);
    expect((origin as GobObject).type).toBe('Point');
  });
});

describe('collection decoding', () => {
  test('slice_int → bigint[]', () => {
    const { gobBytes } = loadTestdata('slice_int');
    const v = new GobDecoder(gobBytes).decode() as bigint[];
    expect(Array.isArray(v)).toBe(true);
    expect(v.map(Number)).toEqual([1, 2, 3]);
  });

  test('slice_empty → []', () => {
    const { gobBytes } = loadTestdata('slice_empty');
    const v = new GobDecoder(gobBytes).decode();
    expect(Array.isArray(v)).toBe(true);
    expect((v as unknown[]).length).toBe(0);
  });

  test('array_int → bigint[] of length 3', () => {
    const { gobBytes } = loadTestdata('array_int');
    const v = new GobDecoder(gobBytes).decode() as bigint[];
    expect(Array.isArray(v)).toBe(true);
    expect(v.length).toBe(3);
  });

  test('map_string_int → Map<string, bigint>', () => {
    const { gobBytes } = loadTestdata('map_string_int');
    const v = new GobDecoder(gobBytes).decode() as Map<string, bigint>;
    expect(v).toBeInstanceOf(Map);
    for (const val of v.values()) {
      expect(typeof val).toBe('bigint');
    }
  });

  test('map_empty → empty Map', () => {
    const { gobBytes } = loadTestdata('map_empty');
    const v = new GobDecoder(gobBytes).decode() as Map<unknown, unknown>;
    expect(v).toBeInstanceOf(Map);
    expect(v.size).toBe(0);
  });

  test('map_int_string → Map<bigint, string>', () => {
    const { gobBytes } = loadTestdata('map_int_string');
    const v = new GobDecoder(gobBytes).decode() as Map<bigint, string>;
    expect(v).toBeInstanceOf(Map);
    for (const key of v.keys()) {
      expect(typeof key).toBe('bigint');
    }
  });
});

describe('interface decoding', () => {
  test('interface_value: Container with Point as Value', () => {
    const { gobBytes } = loadTestdata('interface_value');
    const v = new GobDecoder(gobBytes).decode() as GobObject;
    expect(v).toBeInstanceOf(GobObject);
    expect(v.type).toBe('Container');
    expect(v.get('Name')).toBe('test');
    const iface = v.get('Value');
    expect(iface).toBeInstanceOf(GobObject);
    expect((iface as GobObject).type).toBe('Point');
    expect((iface as GobObject).get('X')).toBe(1n);
    expect((iface as GobObject).get('Y')).toBe(2n);
  });

  // An interface value carries TWO names: the package-qualified name from
  // gob.Register in the interface header ("main.Point"), and the unqualified
  // CommonType.Name in the inline type definition ("Point"). Both must resolve
  // a registered factory. Regression: the qualified name used to be read off
  // the wire and discarded, so register('main.Point', ...) silently did nothing.
  test('registered factory fires for the qualified interface name', () => {
    const { gobBytes } = loadTestdata('interface_value');
    const dec = new GobDecoder(gobBytes);
    dec.register('main.Point', (fields) => ({
      px: Number(fields['X'] as bigint),
      py: Number(fields['Y'] as bigint),
    }));
    const v = dec.decode() as GobObject;
    expect(v.get('Value')).toEqual({ px: 1, py: 2 });
  });

  test('registered factory fires for the unqualified struct name', () => {
    const { gobBytes } = loadTestdata('interface_value');
    const dec = new GobDecoder(gobBytes);
    dec.register('Point', (fields) => ({
      px: Number(fields['X'] as bigint),
      py: Number(fields['Y'] as bigint),
    }));
    const v = dec.decode() as GobObject;
    expect(v.get('Value')).toEqual({ px: 1, py: 2 });
  });

  test('qualified name wins when both are registered', () => {
    const { gobBytes } = loadTestdata('interface_value');
    const dec = new GobDecoder(gobBytes);
    dec.register('Point', () => 'unqualified');
    dec.register('main.Point', () => 'qualified');
    const v = dec.decode() as GobObject;
    expect(v.get('Value')).toBe('qualified');
  });

  test('an unrelated qualified registration does not fire', () => {
    const { gobBytes } = loadTestdata('interface_value');
    const dec = new GobDecoder(gobBytes);
    dec.register('other.Point', () => 'wrong');
    const v = dec.decode() as GobObject;
    expect(v.get('Value')).toBeInstanceOf(GobObject);
    expect((v.get('Value') as GobObject).type).toBe('Point');
  });
});

describe('multi-message stream', () => {
  test('multi_message: two Point values in one stream', () => {
    const { gobBytes } = loadTestdata('multi_message');
    const dec = new GobDecoder(gobBytes);
    const v1 = dec.decode() as GobObject;
    const v2 = dec.decode() as GobObject;
    expect(v1.get('X')).toBe(1n);
    expect(v1.get('Y')).toBe(2n);
    expect(v2.get('X')).toBe(3n);
    expect(v2.get('Y')).toBe(4n);
  });

  test('hasMore() is false after consuming all messages', () => {
    const { gobBytes } = loadTestdata('scalar_int_positive');
    const dec = new GobDecoder(gobBytes);
    dec.decode();
    expect(dec.hasMore()).toBe(false);
  });

  test('tryDecode() returns { ok: false } at EOS', () => {
    const { gobBytes } = loadTestdata('scalar_int_positive');
    const dec = new GobDecoder(gobBytes);
    dec.decode();
    const result = dec.tryDecode();
    expect(result.ok).toBe(false);
  });

  test('decode() throws EndOfStreamError on empty buffer', () => {
    const dec = new GobDecoder(new Uint8Array(0));
    const { EndOfStreamError } = require('../src/errors.ts') as typeof import('../src/errors.ts');
    expect(() => dec.decode()).toThrow(EndOfStreamError);
  });

  test('[Symbol.iterator] iterates over all values', () => {
    const { gobBytes } = loadTestdata('multi_message');
    const dec = new GobDecoder(gobBytes);
    const values = [...dec];
    expect(values).toHaveLength(2);
  });

  test('feed() appends bytes to the buffer', () => {
    const { gobBytes } = loadTestdata('scalar_int_positive');
    const dec = new GobDecoder();
    dec.feed(gobBytes);
    const v = dec.decode() as bigint;
    expect(v).toBe(42n);
  });

  test('registered factory is called for struct type', () => {
    const { gobBytes } = loadTestdata('struct_simple');
    const dec = new GobDecoder(gobBytes, {
      registry: new Map([
        ['Point', (fields) => ({ x: fields['X'], y: fields['Y'] })],
      ]),
    });
    const v = dec.decode() as { x: bigint; y: bigint };
    expect(v.x).toBe(22n);
    expect(v.y).toBe(33n);
  });
});

// ---------------------------------------------------------------------------
// register() and registerCodec() instance methods
// ---------------------------------------------------------------------------

describe('GobDecoder.register()', () => {
  test('registers factory after construction', () => {
    const { gobBytes } = loadTestdata('struct_simple');
    const dec = new GobDecoder(gobBytes);
    dec.register('Point', (fields) => ({ px: fields['X'], py: fields['Y'] }));
    const v = dec.decode() as { px: bigint; py: bigint };
    expect(v.px).toBe(22n);
    expect(v.py).toBe(33n);
  });
});

describe('GobDecoder.registerCodec()', () => {
  test('registers codec after construction for marshaler type', () => {
    const { gobBytes } = loadTestdata('scalar_time');
    const dec = new GobDecoder(gobBytes);
    dec.registerCodec('Time', TimeCodec);
    const result = dec.decode<Date>();
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(1257894000 * 1000);
  });
});

// ---------------------------------------------------------------------------
// GobDecodeError
// ---------------------------------------------------------------------------

describe('GobDecodeError', () => {
  test('is an instance of GobDecodeError and has correct name', () => {
    const err = new GobDecodeError('test error');
    expect(err).toBeInstanceOf(GobDecodeError);
    expect(err.name).toBe('GobDecodeError');
    expect(err.message).toBe('test error');
  });

  test('decoder throws GobDecodeError on unknown type ID in value message', () => {
    // Build a framed message with an unknown positive type ID (100).
    const msg = new GobWriter();
    msg.writeInt(100n); // unknown type ID
    msg.writeUInt(0n);  // singleton wrapper
    msg.writeInt(42n);  // payload
    const msgBytes = msg.bytes();
    const outer = new GobWriter();
    outer.writeUInt(BigInt(msgBytes.length));
    outer.writeRaw(msgBytes);

    const dec = new GobDecoder(outer.bytes());
    expect(() => dec.decode()).toThrow(GobDecodeError);
  });
});
