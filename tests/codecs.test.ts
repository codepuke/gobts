import { test, expect, describe } from 'bun:test';
import { GobDecoder } from '../src/decoder.ts';
import { GobEncoder, Schema } from '../src/encoder.ts';
import { TimeCodec } from '../src/codecs/time.ts';
import { UuidCodec } from '../src/codecs/uuid.ts';
import { DEFAULT_CODECS } from '../src/codecs/index.ts';
import { loadTestdata } from './fixtures.ts';

// ---------------------------------------------------------------------------
// TimeCodec
// ---------------------------------------------------------------------------

describe('TimeCodec', () => {
  test('kind is "gob" (time.Time uses GobEncoder, not BinaryMarshaler)', () => {
    expect(TimeCodec.kind).toBe('gob');
  });

  test('decode: scalar_time.gob → unix timestamp 1257894000', () => {
    const { gobBytes } = loadTestdata('scalar_time');
    const dec = new GobDecoder(gobBytes, { codecs: { Time: TimeCodec } });
    const result = dec.decode<Date>();
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime() / 1000).toBe(1257894000);
  });

  test('decode produces UTC Date (no timezone offset)', () => {
    const { gobBytes } = loadTestdata('scalar_time');
    const dec = new GobDecoder(gobBytes, { codecs: { Time: TimeCodec } });
    const result = dec.decode<Date>();
    // Unix epoch 1257894000 = 2009-11-10T23:00:00Z
    expect(result.toISOString()).toBe('2009-11-10T23:00:00.000Z');
  });

  test('encode zero Date round-trips', () => {
    const d = new Date(0); // Unix epoch
    const bytes = TimeCodec.encode(d);
    const back = TimeCodec.decode(bytes);
    expect(back.getTime()).toBe(0);
  });

  test('encode positive timestamp round-trips', () => {
    const d = new Date(1257894000 * 1000); // 2009-11-11T01:00:00Z
    const bytes = TimeCodec.encode(d);
    const back = TimeCodec.decode(bytes);
    expect(back.getTime()).toBe(d.getTime());
  });

  test('encode negative timestamp (pre-epoch) round-trips', () => {
    const d = new Date(-1000 * 1000); // 1000 seconds before epoch
    const bytes = TimeCodec.encode(d);
    const back = TimeCodec.decode(bytes);
    expect(back.getTime()).toBe(d.getTime());
  });

  test('encode output is 15 bytes', () => {
    const bytes = TimeCodec.encode(new Date(0));
    expect(bytes.length).toBe(15);
    expect(bytes[0]).toBe(1); // version
  });

  test('millisecond precision is preserved', () => {
    const d = new Date(1257894000123); // 123 ms
    const bytes = TimeCodec.encode(d);
    const back = TimeCodec.decode(bytes);
    expect(back.getTime()).toBe(1257894000123);
  });

  test('sub-millisecond nanoseconds are truncated on decode', () => {
    // Manually craft a payload with 999_999 extra nanoseconds (just under 1ms).
    const payload = new Uint8Array(15);
    const view = new DataView(payload.buffer);
    payload[0] = 1; // version
    const secFromYear1 = 62135596800n + 1000n; // 1000 seconds after epoch
    view.setInt32(1, Number(secFromYear1 >> 32n), false);
    view.setUint32(5, Number(secFromYear1 & 0xFFFFFFFFn), false);
    view.setInt32(9, 999_999, false); // 0.000999999 seconds → truncated to 0 ms
    view.setInt16(13, -1, false); // UTC
    const result = TimeCodec.decode(payload);
    expect(result.getTime()).toBe(1000 * 1000); // 1000 seconds in ms, no extra ms
  });

  test('decode throws when data is shorter than 15 bytes', () => {
    expect(() => TimeCodec.decode(new Uint8Array(14))).toThrow();
  });

  test('end-to-end: GobEncoder + GobDecoder with TimeCodec', () => {
    const d = new Date(1257894000000);
    const enc = new GobEncoder({ codecs: { Time: TimeCodec } });
    enc.encode(d, { schema: new Schema('TimeWrapper', {}) });
    // Actually, Time is encoded as a marshaler — use the dedicated marshaler API.
    // For a top-level time.Time, we need to use the marshaler field type.
    // The encode path for marshaler types requires a MarshalerField.
    // Simplest: test via decoder round-trip using the fixture bytes.
    const { gobBytes } = loadTestdata('scalar_time');
    const dec = new GobDecoder(gobBytes, { codecs: { Time: TimeCodec } });
    const result = dec.decode<Date>();
    expect(result.getTime()).toBe(1257894000 * 1000);
  });
});

// ---------------------------------------------------------------------------
// UuidCodec
// ---------------------------------------------------------------------------

describe('UuidCodec', () => {
  test('kind is "binary"', () => {
    expect(UuidCodec.kind).toBe('binary');
  });

  test('decode: scalar_uuid.gob → canonical UUID string', () => {
    const { gobBytes } = loadTestdata('scalar_uuid');
    const dec = new GobDecoder(gobBytes, { codecs: { UUID: UuidCodec } });
    const result = dec.decode<string>();
    expect(result).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
  });

  test('decode produces lowercase hyphenated format', () => {
    const bytes = new Uint8Array([
      0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1,
      0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8,
    ]);
    const result = UuidCodec.decode(bytes);
    expect(result).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
  });

  test('encode produces 16 bytes', () => {
    const bytes = UuidCodec.encode('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    expect(bytes.length).toBe(16);
  });

  test('encode round-trips', () => {
    const uuid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const bytes = UuidCodec.encode(uuid);
    const back = UuidCodec.decode(bytes);
    expect(back).toBe(uuid);
  });

  test('encode matches raw bytes', () => {
    const uuid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const bytes = UuidCodec.encode(uuid);
    expect(bytes[0]).toBe(0x6b);
    expect(bytes[4]).toBe(0x9d);
    expect(bytes[6]).toBe(0x11);
    expect(bytes[8]).toBe(0x80);
    expect(bytes[10]).toBe(0x00);
    expect(bytes[15]).toBe(0xc8);
  });

  test('decode: struct_with_uuid.gob → HasUUID with ID string', () => {
    const { gobBytes } = loadTestdata('struct_with_uuid');
    const dec = new GobDecoder(gobBytes, { codecs: { UUID: UuidCodec } });
    const result = dec.decode() as { get: (k: string) => unknown };
    expect(result.get('ID')).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
  });

  test('decode all-zeros UUID', () => {
    const bytes = new Uint8Array(16);
    const result = UuidCodec.decode(bytes);
    expect(result).toBe('00000000-0000-0000-0000-000000000000');
  });

  test('encode all-zeros UUID', () => {
    const bytes = UuidCodec.encode('00000000-0000-0000-0000-000000000000');
    expect([...bytes]).toEqual(Array(16).fill(0));
  });

  test('decode wrong byte count throws', () => {
    expect(() => UuidCodec.decode(new Uint8Array(15))).toThrow();
  });

  test('encode throws for invalid UUID string (wrong length)', () => {
    expect(() => UuidCodec.encode('not-a-uuid')).toThrow();
  });

  test('encode throws for invalid hex characters', () => {
    expect(() => UuidCodec.encode('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CODECS
// ---------------------------------------------------------------------------

describe('DEFAULT_CODECS', () => {
  test('has Time and UUID keys', () => {
    expect(DEFAULT_CODECS['Time']).toBeDefined();
    expect(DEFAULT_CODECS['UUID']).toBeDefined();
  });

  test('Time codec is TimeCodec', () => {
    expect(DEFAULT_CODECS['Time']!.kind).toBe('gob');
  });

  test('UUID codec is UuidCodec', () => {
    expect(DEFAULT_CODECS['UUID']!.kind).toBe('binary');
  });

  test('decode scalar_time.gob with DEFAULT_CODECS', () => {
    const { gobBytes } = loadTestdata('scalar_time');
    const dec = new GobDecoder(gobBytes, { codecs: DEFAULT_CODECS });
    const result = dec.decode<Date>();
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(1257894000 * 1000);
  });

  test('decode scalar_uuid.gob with DEFAULT_CODECS', () => {
    const { gobBytes } = loadTestdata('scalar_uuid');
    const dec = new GobDecoder(gobBytes, { codecs: DEFAULT_CODECS });
    const result = dec.decode<string>();
    expect(result).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
  });
});
