// Doc examples for gobts — encoding and decoding structs.
// The marked regions below are extracted by the codepuke sync (see CLAUDE.md
// → "Documentation snippets") and published on the docs site. Keep them free
// of test scaffolding: imports and assertions stay outside the markers so the
// extracted snippet is clean top-level code.
import { test, expect } from 'bun:test';
import { Schema, GOB_INT, encode, decode, type GobObject } from '../src/index.ts';

const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });

test('encode-struct: a struct value becomes gob bytes', () => {
  // snippet:start encode-struct
  // Go: type Point struct { X, Y int }
  const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });

  // Go's `int` is 64-bit, so integer fields are bigint on the TypeScript side.
  const bytes = encode({ X: 3n, Y: 4n }, { schema: PointSchema });
  // snippet:end

  expect(bytes.length).toBeGreaterThan(0);
});

test('decode-struct: gob bytes become a struct value', () => {
  const bytes = encode({ X: 3n, Y: 4n }, { schema: PointSchema });

  // snippet:start decode-struct
  const point = decode<GobObject>(bytes);

  point.get('X'); // 3n
  point.get('Y'); // 4n
  // snippet:end

  expect(point.get('X')).toBe(3n);
  expect(point.get('Y')).toBe(4n);
});

test('nested-struct: struct fields nest without extra framing', () => {
  // snippet:start nested-struct
  // Go: type Line struct { From, To Point }
  const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });

  // A Schema is itself a field type, so it nests directly.
  const LineSchema = new Schema('Line', {
    From: PointSchema,
    To: PointSchema,
  });

  const bytes = encode(
    { From: { X: 1n, Y: 2n }, To: { X: 3n, Y: 4n } },
    { schema: LineSchema },
  );

  const line = decode<GobObject>(bytes);
  const to = line.get('To') as GobObject;
  to.get('X'); // 3n
  // snippet:end

  expect(to.get('X')).toBe(3n);
  expect(to.get('Y')).toBe(4n);
});

test('zero-fields-omitted: zero-valued fields are absent on the wire', () => {
  // snippet:start zero-fields-omitted
  const full = encode({ X: 3n, Y: 4n }, { schema: PointSchema });
  const partial = encode({ X: 3n, Y: 0n }, { schema: PointSchema });

  // Y is zero in the second value, so it is omitted from the wire entirely.
  partial.length < full.length; // true

  // The decoder restores every omitted field to its zero value.
  const point = decode<GobObject>(partial);
  point.get('X'); // 3n
  point.get('Y'); // 0n
  // snippet:end

  expect(partial.length).toBeLessThan(full.length);
  expect(point.get('X')).toBe(3n);
  expect(point.get('Y')).toBe(0n);
});

test('dynamic-field-access: read a struct with no registered type', () => {
  const bytes = encode({ X: 3n, Y: 4n }, { schema: PointSchema });

  // snippet:start dynamic-field-access
  // A struct with no registered factory decodes to a GobObject, which exposes
  // the wire's field names without a compile-time type.
  const point = decode<GobObject>(bytes);

  point.type;      // "Point"
  point.has('X');  // true
  point.keys();    // ["X", "Y"]
  point.values();  // [3n, 4n]

  const names: string[] = [];
  for (const [name] of point) {
    names.push(name);
  }
  // snippet:end

  expect(point.type).toBe('Point');
  expect(names).toEqual(['X', 'Y']);
});
