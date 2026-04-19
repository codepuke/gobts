import { test, expect, describe } from 'bun:test';
import { GobEncoder, Schema } from '../src/encoder.ts';
import { Marshaler } from '../src/types.ts';
import { TimeCodec } from '../src/codecs/time.ts';
import { UuidCodec } from '../src/codecs/uuid.ts';
import { goVerifyAvailable, runGoVerify } from './fixtures.ts';

const skip = !goVerifyAvailable();
const maybeTest = skip ? test.skip : test;

const GOB_INT = { kind: 'primitive' as const, typeId: 2 };
const GOB_UINT = { kind: 'primitive' as const, typeId: 3 };
const GOB_FLOAT = { kind: 'primitive' as const, typeId: 4 };
const GOB_BOOL = { kind: 'primitive' as const, typeId: 1 };
const GOB_STRING = { kind: 'primitive' as const, typeId: 6 };
const GOB_BYTES = { kind: 'primitive' as const, typeId: 5 };

function encodeWith(fn: (enc: GobEncoder) => void): Uint8Array {
  const enc = new GobEncoder();
  fn(enc);
  return enc.bytes();
}

describe('go_verify: scalar types', () => {
  maybeTest('scalar_int_positive: TS → Go', async () => {
    const bytes = encodeWith(enc => enc.encode(42n));
    const result = await runGoVerify('scalar_int_positive', bytes) as number;
    expect(result).toBe(42);
  });

  maybeTest('scalar_int_zero: TS → Go', async () => {
    const bytes = encodeWith(enc => enc.encode(0n));
    const result = await runGoVerify('scalar_int_zero', bytes) as number;
    expect(result).toBe(0);
  });

  maybeTest('scalar_int_negative: TS → Go', async () => {
    const bytes = encodeWith(enc => enc.encode(-42n));
    const result = await runGoVerify('scalar_int_negative', bytes) as number;
    expect(result).toBe(-42);
  });

  maybeTest('scalar_bool_true: TS → Go', async () => {
    const bytes = encodeWith(enc => enc.encode(true));
    const result = await runGoVerify('scalar_bool_true', bytes) as boolean;
    expect(result).toBe(true);
  });

  maybeTest('scalar_bool_false: TS → Go', async () => {
    const bytes = encodeWith(enc => enc.encode(false));
    const result = await runGoVerify('scalar_bool_false', bytes) as boolean;
    expect(result).toBe(false);
  });

  maybeTest('scalar_float_zero: TS → Go', async () => {
    const bytes = encodeWith(enc => enc.encode(0.0));
    const result = await runGoVerify('scalar_float_zero', bytes) as number;
    expect(result).toBe(0);
  });

  maybeTest('scalar_string_empty: TS → Go', async () => {
    const bytes = encodeWith(enc => enc.encode(''));
    const result = await runGoVerify('scalar_string_empty', bytes) as string;
    expect(result).toBe('');
  });

  maybeTest('scalar_string: TS → Go', async () => {
    const { gobBytes } = await import('./fixtures.ts').then(m => m.loadTestdata('scalar_string'));
    // First decode to get the value, then re-encode and verify.
    const { GobDecoder } = await import('../src/decoder.ts');
    const v = new GobDecoder(gobBytes).decode<string>();
    const bytes = encodeWith(enc => enc.encode(v));
    const result = await runGoVerify('scalar_string', bytes) as string;
    expect(result).toBe(v);
  });
});

describe('go_verify: struct types', () => {
  maybeTest('struct_simple: Point{X:22, Y:33} TS → Go', async () => {
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const bytes = encodeWith(enc => enc.encode({ X: 22n, Y: 33n }, { schema: PointSchema }));
    const result = await runGoVerify('struct_simple', bytes) as { X: number; Y: number };
    expect(result.X).toBe(22);
    expect(result.Y).toBe(33);
  });

  maybeTest('struct_zero_fields: zero fields omitted TS → Go', async () => {
    const PartialSchema = new Schema('PartialStruct', {
      Name: GOB_STRING,
      Value: GOB_INT,
      Extra: GOB_FLOAT,
    });
    const bytes = encodeWith(enc => enc.encode({ Name: 'test', Value: 0n, Extra: 0 }, { schema: PartialSchema }));
    const result = await runGoVerify('struct_zero_fields', bytes) as { Name: string; Value: number; Extra: number };
    expect(result.Name).toBe('test');
    expect(result.Value).toBe(0);
  });

  maybeTest('struct_nested: nested struct TS → Go', async () => {
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const NestedSchema = new Schema('NestedStruct', {
      Label: GOB_STRING,
      Origin: { kind: 'struct' as const, schema: PointSchema },
    });
    const bytes = encodeWith(enc =>
      enc.encode({ Label: 'origin', Origin: { X: 0n, Y: 0n } }, { schema: NestedSchema })
    );
    const result = await runGoVerify('struct_nested', bytes) as { Label: string; Origin: { X: number; Y: number } };
    expect(result.Label).toBe('origin');
    expect(result.Origin.X).toBe(0);
  });
});

describe('go_verify: collections', () => {
  maybeTest('slice_int: TS → Go', async () => {
    const bytes = encodeWith(enc => enc.encode([1n, 2n, 3n], { elemType: GOB_INT }));
    const result = await runGoVerify('slice_int', bytes) as number[];
    expect(result).toEqual([1, 2, 3]);
  });

  maybeTest('slice_empty: TS → Go', async () => {
    const bytes = encodeWith(enc => enc.encode([], { elemType: GOB_INT }));
    const result = await runGoVerify('slice_empty', bytes) as number[];
    expect(result).toEqual([]);
  });

  maybeTest('map_string_int: TS → Go', async () => {
    const m = new Map([['a', 1n], ['b', 2n]]);
    const bytes = encodeWith(enc => enc.encode(m, { keyType: GOB_STRING, elemType: GOB_INT }));
    const result = await runGoVerify('map_string_int', bytes) as Record<string, number>;
    expect(result['a']).toBe(1);
    expect(result['b']).toBe(2);
  });

  maybeTest('multi_message: two Point values TS → Go', async () => {
    const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
    const enc = new GobEncoder();
    enc.encode({ X: 1n, Y: 2n }, { schema: PointSchema });
    enc.encode({ X: 3n, Y: 4n }, { schema: PointSchema });
    const bytes = enc.bytes();
    const result = await runGoVerify('multi_message', bytes) as Array<{ X: number; Y: number }>;
    expect(result[0]!.X).toBe(1);
    expect(result[0]!.Y).toBe(2);
    expect(result[1]!.X).toBe(3);
    expect(result[1]!.Y).toBe(4);
  });
});

describe('go_verify: codecs', () => {
  maybeTest('scalar_time: TS Date → Go time.Time', async () => {
    // 2009-11-10T23:00:00Z = unix 1257894000
    const d = new Date(1257894000 * 1000);
    const enc = new GobEncoder({ codecs: { Time: TimeCodec } });
    enc.encode(d, { marshalerType: 'Time', marshalerKind: 'gob' });
    const bytes = enc.bytes();
    const result = await runGoVerify('scalar_time', bytes) as { unix: number; utc: string };
    expect(result.unix).toBe(1257894000);
  });

  maybeTest('scalar_uuid: TS UUID string → Go uuid.UUID', async () => {
    const uuid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const enc = new GobEncoder({ codecs: { UUID: UuidCodec } });
    enc.encode(uuid, { marshalerType: 'UUID', marshalerKind: 'binary' });
    const bytes = enc.bytes();
    const result = await runGoVerify('scalar_uuid', bytes) as string;
    expect(result).toBe(uuid);
  });
});
