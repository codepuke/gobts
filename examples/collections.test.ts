// Doc examples for gobts — slices and maps.
// The marked regions below are extracted by the codepuke sync (see CLAUDE.md
// → "Documentation snippets") and published on the docs site. Keep them free
// of test scaffolding: imports and assertions stay outside the markers so the
// extracted snippet is clean top-level code.
import { test, expect } from 'bun:test';
import { GOB_INT, GOB_STRING, encode, decode } from '../src/index.ts';

test('encode-slice: a slice round-trips with an explicit element type', () => {
  // snippet:start encode-slice
  // Go: []int{1, 2, 3}
  // A top-level slice carries no struct schema, so name the element type.
  const bytes = encode([1n, 2n, 3n], { elemType: GOB_INT });

  const numbers = decode<bigint[]>(bytes); // [1n, 2n, 3n]
  // snippet:end

  expect(numbers).toEqual([1n, 2n, 3n]);
});

test('encode-map: a map round-trips with explicit key and element types', () => {
  // snippet:start encode-map
  // Go: map[string]int{"one": 1, "two": 2}
  // Maps are Map instances, not plain objects — gob keys are not always strings.
  const source = new Map<string, bigint>([
    ['one', 1n],
    ['two', 2n],
  ]);
  const bytes = encode(source, { keyType: GOB_STRING, elemType: GOB_INT });

  const counts = decode<Map<string, bigint>>(bytes);
  counts.get('one'); // 1n

  // Go's map iteration order is not deterministic, so the byte order of the
  // entries varies between runs. Compare decoded values, never raw bytes.
  // snippet:end

  expect(counts.get('one')).toBe(1n);
  expect(counts.get('two')).toBe(2n);
  expect(counts.size).toBe(2);
});
