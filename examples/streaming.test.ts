// Doc examples for gobts — multi-message streams.
// The marked regions below are extracted by the codepuke sync (see CLAUDE.md
// → "Documentation snippets") and published on the docs site. Keep them free
// of test scaffolding: imports and assertions stay outside the markers so the
// extracted snippet is clean top-level code.
import { test, expect } from 'bun:test';
import {
  GobDecoder,
  GobEncoder,
  EndOfStreamError,
  Schema,
  GOB_INT,
  type GobObject,
} from '../src/index.ts';

const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });

function samplePointStream(): Uint8Array {
  const enc = new GobEncoder();
  enc.encode({ X: 3n, Y: 4n }, { schema: PointSchema });
  enc.encode({ X: 5n, Y: 6n }, { schema: PointSchema });
  return enc.bytes();
}

test('stream-multiple-values: one encoder sends the type definition once', () => {
  // snippet:start stream-multiple-values
  const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });

  // Reusing one encoder keeps the type state: the Point type definition is
  // written once, before the first value, and never repeated.
  const enc = new GobEncoder();
  enc.encode({ X: 3n, Y: 4n }, { schema: PointSchema });
  enc.encode({ X: 5n, Y: 6n }, { schema: PointSchema });

  // bytes() drains the accumulated buffer but keeps the type state.
  const stream = enc.bytes();

  const dec = new GobDecoder(stream);
  const points: GobObject[] = [];
  for (const value of dec) {
    points.push(value as GobObject);
  }
  // points holds Point{3, 4} and Point{5, 6}
  // snippet:end

  expect(points).toHaveLength(2);
  expect(points[0]?.get('X')).toBe(3n);
  expect(points[0]?.get('Y')).toBe(4n);
  expect(points[1]?.get('X')).toBe(5n);
  expect(points[1]?.get('Y')).toBe(6n);
  expect(enc.bytes().length).toBe(0);
});

test('end-of-stream: tryDecode reports exhaustion, decode throws', () => {
  const stream = samplePointStream();

  // snippet:start end-of-stream
  const dec = new GobDecoder(stream);

  // tryDecode() never throws at end of stream — it reports it.
  const seen: unknown[] = [];
  while (dec.hasMore()) {
    const result = dec.tryDecode();
    if (!result.ok) break;
    seen.push(result.value);
  }
  // seen holds Point{3, 4} and Point{5, 6}

  // decode() throws instead. Feed more bytes and retry when the stream is live.
  let exhausted = false;
  try {
    dec.decode();
  } catch (err) {
    if (err instanceof EndOfStreamError) {
      exhausted = true;
    }
  }
  // snippet:end

  expect(seen).toHaveLength(2);
  expect((seen[0] as GobObject).get('X')).toBe(3n);
  expect((seen[1] as GobObject).get('Y')).toBe(6n);
  expect(exhausted).toBe(true);
});
