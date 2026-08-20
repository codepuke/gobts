// Doc examples for gobts — codecs for Go marshaler types.
// The marked regions below are extracted by the codepuke sync (see CLAUDE.md
// → "Documentation snippets") and published on the docs site. Keep them free
// of test scaffolding: imports and assertions stay outside the markers so the
// extracted snippet is clean top-level code.
import { test, expect } from 'bun:test';
import { GobDecoder, GobEncoder, decode, type Codec } from '../src/index.ts';
import { DEFAULT_CODECS } from '../src/codecs/index.ts';

test('time-values: Go time.Time round-trips as a Date', () => {
  // snippet:start time-values
  // Go's time.Time implements GobEncoder (not BinaryMarshaler) and arrives on
  // the wire under the unqualified type name "Time".
  const enc = new GobEncoder({ codecs: DEFAULT_CODECS });
  enc.encode(new Date('2009-11-10T23:00:00.000Z'), {
    marshalerType: 'Time',
    marshalerKind: 'gob',
  });

  const when = decode<Date>(enc.bytes(), { codecs: DEFAULT_CODECS });
  when.toISOString(); // "2009-11-10T23:00:00.000Z"

  // Date holds milliseconds; Go holds nanoseconds. Sub-millisecond precision,
  // the zone offset, and the zone name are all lost in the conversion.
  // snippet:end

  expect(when.toISOString()).toBe('2009-11-10T23:00:00.000Z');
});

test('uuid-values: Go uuid.UUID round-trips as a canonical string', () => {
  // snippet:start uuid-values
  // uuid.UUID is a BinaryMarshaler, wire type name "UUID".
  const enc = new GobEncoder({ codecs: DEFAULT_CODECS });
  enc.encode('6ba7b810-9dad-11d1-80b4-00c04fd430c8', {
    marshalerType: 'UUID',
    marshalerKind: 'binary',
  });

  // Decodes to the canonical hyphenated lowercase form, matching the output of
  // crypto.randomUUID().
  const id = decode<string>(enc.bytes(), { codecs: DEFAULT_CODECS });
  // snippet:end

  expect(id).toBe('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
});

test('custom-marshaler: teach gobts a marshaler type of your own', () => {
  // snippet:start custom-marshaler
  // Go: type Celsius float64, with MarshalBinary / UnmarshalBinary writing
  // eight big-endian IEEE-754 bytes.
  const CelsiusCodec: Codec<number> = {
    kind: 'binary',
    encode(value) {
      const out = new Uint8Array(8);
      new DataView(out.buffer).setFloat64(0, value, false);
      return out;
    },
    decode(bytes) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return view.getFloat64(0, false);
    },
  };

  // Register under the unqualified Go type name, on both sides.
  const enc = new GobEncoder();
  enc.registerCodec('Celsius', CelsiusCodec);
  enc.encode(21.5, { marshalerType: 'Celsius', marshalerKind: 'binary' });

  const dec = new GobDecoder(enc.bytes());
  dec.registerCodec('Celsius', CelsiusCodec);
  const temperature = dec.decode<number>(); // 21.5
  // snippet:end

  expect(temperature).toBe(21.5);
});
