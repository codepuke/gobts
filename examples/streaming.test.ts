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
  SliceOf,
  GOB_INT,
  GOB_STRING,
  type GobObject,
} from '../src/index.ts';

const PersonSchema = new Schema('Person', {
  Name: GOB_STRING,
  Age: GOB_INT,
  Tags: SliceOf(GOB_STRING),
});

function samplePeopleStream(): Uint8Array {
  const enc = new GobEncoder();
  enc.encode({ Name: 'Ada', Age: 36n, Tags: ['math', 'code'] }, { schema: PersonSchema });
  enc.encode({ Name: 'Grace', Age: 45n, Tags: ['navy'] }, { schema: PersonSchema });
  return enc.bytes();
}

test('stream-encode: one encoder sends each type definition once', () => {
  // snippet:start stream-encode
  const PersonSchema = new Schema('Person', {
    Name: GOB_STRING,
    Age: GOB_INT,
    Tags: SliceOf(GOB_STRING),
  });

  // Reusing one encoder keeps the type state: the Person type definition is
  // written before the first value and never repeated.
  const enc = new GobEncoder();
  enc.encode({ Name: 'Ada', Age: 36n, Tags: ['math', 'code'] }, { schema: PersonSchema });
  enc.encode({ Name: 'Grace', Age: 45n, Tags: ['navy'] }, { schema: PersonSchema });

  // bytes() drains the buffer but keeps the type state. Call reset() to start
  // a fresh stream, e.g. for a new connection.
  const stream = enc.bytes();
  // snippet:end

  expect(stream.length).toBeGreaterThan(0);
  expect(enc.bytes().length).toBe(0);
});

test('stream-decode: iterate every value in a stream', () => {
  const stream = samplePeopleStream();

  // snippet:start stream-decode
  const dec = new GobDecoder(stream);

  const names: string[] = [];
  for (const value of dec) {
    names.push((value as GobObject).get('Name') as string);
  }
  // names === ["Ada", "Grace"]
  // snippet:end

  expect(names).toEqual(['Ada', 'Grace']);
});

test('end-of-stream: tryDecode reports exhaustion, decode throws', () => {
  const stream = samplePeopleStream();

  // snippet:start end-of-stream
  const dec = new GobDecoder(stream);

  // tryDecode() never throws at end of stream — it reports it.
  const seen: unknown[] = [];
  while (dec.hasMore()) {
    const result = dec.tryDecode();
    if (!result.ok) break;
    seen.push(result.value);
  }

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
  expect(exhausted).toBe(true);
});
