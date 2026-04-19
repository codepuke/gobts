/**
 * Benchmarks: gobts encode/decode vs JSON.stringify/parse.
 * Target: within 2× of JSON for scalars, collections, and mixed payloads.
 * Run: bun bench/index.bench.ts
 */
import { bench, run } from 'mitata';
import { GobEncoder, Schema } from '../src/encoder.ts';
import { GobDecoder } from '../src/decoder.ts';
import { GOB_INT, GOB_STRING, GOB_FLOAT, GOB_BOOL, SliceOf } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
const pointValue = { X: 42n, Y: -17n };
const pointJSON = JSON.stringify({ X: 42, Y: -17 });

const PersonSchema = new Schema('Person', {
  Name: GOB_STRING,
  Age: GOB_INT,
  Score: GOB_FLOAT,
  Active: GOB_BOOL,
});
const personValue = { Name: 'Alice', Age: 30n, Score: 98.6, Active: true };
const personJSON = JSON.stringify({ Name: 'Alice', Age: 30, Score: 98.6, Active: true });

// Slice of 1000 ints.
const intSlice = Array.from({ length: 1000 }, (_, i) => BigInt(i));
const intSliceJSON = JSON.stringify(Array.from({ length: 1000 }, (_, i) => i));

// Slice of 1000 structs.
const PointsSchema = new Schema('PointsContainer', {
  Points: SliceOf({ kind: 'struct' as const, schema: PointSchema }),
});
const points = Array.from({ length: 1000 }, (_, i) => ({ X: BigInt(i), Y: BigInt(i * 2) }));
const pointsJSON = JSON.stringify({ Points: points.map(p => ({ X: Number(p.X), Y: Number(p.Y) })) });

// Pre-encoded bytes for decode benchmarks.
function preEncode<T>(value: T, encFn: (enc: GobEncoder, v: T) => void): Uint8Array {
  const enc = new GobEncoder();
  encFn(enc, value);
  return enc.bytes();
}

const scalarIntBytes = preEncode(42n, (enc, v) => enc.encode(v));
const scalarStringBytes = preEncode('hello, world!', (enc, v) => enc.encode(v));
const pointBytes = preEncode(pointValue, (enc, v) => enc.encode(v, { schema: PointSchema }));
const personBytes = preEncode(personValue, (enc, v) => enc.encode(v, { schema: PersonSchema }));
const intSliceBytes = preEncode(intSlice, (enc, v) => enc.encode(v, { elemType: GOB_INT }));
const pointsBytes = preEncode({ Points: points }, (enc, v) => enc.encode(v, { schema: PointsSchema }));

// ---------------------------------------------------------------------------
// Scalar benchmarks
// ---------------------------------------------------------------------------

bench('gob encode bigint 42n', () => {
  const enc = new GobEncoder();
  enc.encode(42n);
  return enc.bytes();
});

bench('JSON stringify number 42', () => {
  return JSON.stringify(42);
});

bench('gob encode string "hello, world!"', () => {
  const enc = new GobEncoder();
  enc.encode('hello, world!');
  return enc.bytes();
});

bench('JSON stringify string "hello, world!"', () => {
  return JSON.stringify('hello, world!');
});

bench('gob decode bigint', () => {
  return new GobDecoder(scalarIntBytes).decode();
});

bench('JSON parse number', () => {
  return JSON.parse('42');
});

bench('gob decode string', () => {
  return new GobDecoder(scalarStringBytes).decode();
});

bench('JSON parse string', () => {
  return JSON.parse('"hello, world!"');
});

// ---------------------------------------------------------------------------
// Small struct benchmarks
// ---------------------------------------------------------------------------

bench('gob encode Point{X:42, Y:-17}', () => {
  const enc = new GobEncoder();
  enc.encode(pointValue, { schema: PointSchema });
  return enc.bytes();
});

bench('JSON stringify Point (numbers)', () => {
  return JSON.stringify({ X: 42, Y: -17 });
});

bench('gob decode Point', () => {
  return new GobDecoder(pointBytes).decode();
});

bench('JSON parse Point', () => {
  return JSON.parse(pointJSON);
});

// ---------------------------------------------------------------------------
// Mixed struct benchmarks
// ---------------------------------------------------------------------------

bench('gob encode Person{Name, Age, Score, Active}', () => {
  const enc = new GobEncoder();
  enc.encode(personValue, { schema: PersonSchema });
  return enc.bytes();
});

bench('JSON stringify Person (numbers)', () => {
  return JSON.stringify({ Name: 'Alice', Age: 30, Score: 98.6, Active: true });
});

bench('gob decode Person', () => {
  return new GobDecoder(personBytes).decode();
});

bench('JSON parse Person', () => {
  return JSON.parse(personJSON);
});

// ---------------------------------------------------------------------------
// Collection benchmarks
// ---------------------------------------------------------------------------

bench('gob encode []int (1000 elements)', () => {
  const enc = new GobEncoder();
  enc.encode(intSlice, { elemType: GOB_INT });
  return enc.bytes();
});

bench('JSON stringify []number (1000 elements)', () => {
  return JSON.stringify(Array.from({ length: 1000 }, (_, i) => i));
});

bench('gob decode []int (1000 elements)', () => {
  return new GobDecoder(intSliceBytes).decode();
});

bench('JSON parse []number (1000 elements)', () => {
  return JSON.parse(intSliceJSON);
});

// ---------------------------------------------------------------------------
// Slice of structs
// ---------------------------------------------------------------------------

bench('gob encode 1000 Points (struct slice)', () => {
  const enc = new GobEncoder();
  enc.encode({ Points: points }, { schema: PointsSchema });
  return enc.bytes();
});

const pointsNumeric = points.map(p => ({ X: Number(p.X), Y: Number(p.Y) }));
bench('JSON stringify 1000 Points (numbers)', () => {
  return JSON.stringify({ Points: pointsNumeric });
});

bench('gob decode 1000 Points', () => {
  return new GobDecoder(pointsBytes).decode();
});

bench('JSON parse 1000 Points', () => {
  return JSON.parse(pointsJSON);
});

// ---------------------------------------------------------------------------
// Mixed round-trip
// ---------------------------------------------------------------------------

bench('gob round-trip Person (encode+decode)', () => {
  const enc = new GobEncoder();
  enc.encode(personValue, { schema: PersonSchema });
  return new GobDecoder(enc.bytes()).decode();
});

bench('JSON round-trip Person (stringify+parse, numbers)', () => {
  return JSON.parse(JSON.stringify({ Name: 'Alice', Age: 30, Score: 98.6, Active: true }));
});

// ---------------------------------------------------------------------------
// Warm encoder benchmarks (amortized cost — type defs emitted once).
// In production streaming use, a single GobEncoder is reused across many calls.
// ---------------------------------------------------------------------------

const warmPointEnc = new GobEncoder();
// Pre-emit the type def by encoding once.
warmPointEnc.encode(pointValue, { schema: PointSchema });
warmPointEnc.bytes(); // consume the type def + first message

bench('gob encode Point (warm encoder, no type def)', () => {
  warmPointEnc.encode(pointValue, { schema: PointSchema });
  return warmPointEnc.bytes();
});

bench('JSON stringify Point (warm, numbers)', () => {
  return JSON.stringify({ X: 42, Y: -17 });
});

const warmPersonEnc = new GobEncoder();
warmPersonEnc.encode(personValue, { schema: PersonSchema });
warmPersonEnc.bytes();

bench('gob encode Person (warm encoder, no type def)', () => {
  warmPersonEnc.encode(personValue, { schema: PersonSchema });
  return warmPersonEnc.bytes();
});

bench('JSON stringify Person (warm, numbers)', () => {
  return JSON.stringify({ Name: 'Alice', Age: 30, Score: 98.6, Active: true });
});

await run();
