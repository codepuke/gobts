# gobts

TypeScript port of Go's [`encoding/gob`](https://pkg.go.dev/encoding/gob) binary serialization format. Sister library to `pygob` (Python) and `gobdotnet` (C#).

Full wire-format compatibility: byte streams produced by Go's encoder decode correctly in TypeScript, and byte streams produced by gobts decode correctly in Go.

**Runtimes:** Node.js 20+, Bun 1.1+, modern browsers (no Node-specific APIs used). Zero runtime dependencies.

## Table of Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Type mapping](#type-mapping)
- [Schemas](#schemas)
- [Type inference](#type-inference)
- [Encoding](#encoding)
- [Decoding](#decoding)
- [Working with GobObject](#working-with-gobobject)
- [Registering concrete types for interface{} fields](#registering-concrete-types-for-interface-fields)
- [Codecs: time.Time and uuid.UUID](#codecs-timetime-and-uuiduuid)
- [Custom codecs](#custom-codecs)
- [Errors](#errors)
- [SemanticType](#semantictype)
- [Schema evolution](#schema-evolution)
- [Go–TypeScript interchange examples](#gotypeScript-interchange-examples)
- [Wire format compatibility notes](#wire-format-compatibility-notes)
- [Limitations](#limitations)
- [Performance](#performance)
- [Development](#development)
- [Sister libraries](#sister-libraries)

---

## Installation

```sh
bun add gobts          # Bun
npm install gobts       # npm
pnpm add gobts          # pnpm
```

---

## Quick start

```ts
import { encode, decode, Schema, GOB_INT, GOB_STRING } from 'gobts';

// Define a schema that matches your Go struct:
//   type Point struct { X, Y int }
const PointSchema = new Schema('Point', {
  X: GOB_INT,
  Y: GOB_INT,
});

// Encode
const bytes = encode({ X: 3n, Y: -7n }, { schema: PointSchema });

// Decode
const obj = decode(bytes);     // returns GobObject
obj.get('X');                  // 3n (bigint)
obj.get('Y');                  // -7n
```

> **Note on integers:** Go's `int` is 64-bit. gobts decodes all gob integers as `bigint` to avoid silent precision loss above `Number.MAX_SAFE_INTEGER`. Convert with `Number(x)` when you know the value is safe.

---

## Type mapping

| Go type | TypeScript type | Notes |
|---------|-----------------|-------|
| `int` / `int64` | `bigint` | All integer sizes decode to `bigint` |
| `uint` / `uint64` | `bigint` | Sign tracked by schema, not value type |
| `bool` | `boolean` | |
| `float64` | `number` | |
| `float32` | `number` | Encoded as float64 on the wire |
| `complex128` | `Complex` | `{ re: number, im: number }` |
| `string` | `string` | UTF-8 |
| `[]byte` | `Uint8Array` | |
| `[]T` | `T[]` | |
| `[N]T` | `T[]` | Fixed-length info is lost on decode |
| `map[K]V` | `Map<K, V>` | Preserves non-string key types |
| `struct` | `GobObject` | Or typed plain object with a registered factory |
| `interface{}` | `unknown` | Concrete value embedded in stream |
| `time.Time` | `Date` | With `DEFAULT_CODECS`; ms precision, UTC only |
| `uuid.UUID` | `string` | Canonical hyphenated lowercase |
| `time.Duration` | `bigint` | Nanoseconds, via `GOB_DURATION` |

---

## Schemas

Schemas describe the structure of Go types to the encoder. They are not needed for decoding (gob is self-describing), but are required when encoding structs.

```ts
import { Schema, GOB_INT, GOB_STRING, GOB_FLOAT, GOB_BOOL, SliceOf, MapOf } from 'gobts';

// Matches: type Point struct { X, Y int }
const PointSchema = new Schema('Point', {
  X: GOB_INT,
  Y: GOB_INT,
});

// Nested struct — Schema is itself a valid field type
const PersonSchema = new Schema('Person', {
  Name:   GOB_STRING,
  Age:    GOB_INT,
  Score:  GOB_FLOAT,
  Active: GOB_BOOL,
  Home:   PointSchema,
});

// Collections
const TagsSchema = new Schema('TagsContainer', {
  Tags:   SliceOf(GOB_STRING),
  Scores: MapOf(GOB_STRING, GOB_INT),
});
```

### Field type constants and factories

```ts
// Primitives
GOB_BOOL        // bool
GOB_INT         // int / int64 → bigint
GOB_UINT        // uint / uint64 → bigint
GOB_FLOAT       // float64 → number
GOB_BYTES       // []byte → Uint8Array
GOB_STRING      // string
GOB_COMPLEX     // complex128 → Complex
GOB_INTERFACE   // interface{} → unknown
GOB_DURATION    // time.Duration → bigint (nanoseconds)

// Composite factories
SliceOf(elem)               // []T
ArrayOf(elem, length)       // [N]T
MapOf(key, elem)            // map[K]V
Marshaler(typeName, kind)   // GobEncoder / BinaryMarshaler / TextMarshaler field
```

---

## Type inference

`InferSchema<S>` derives the TypeScript type from a `Schema` at compile time — no decorators, no code generation, no build step.

```ts
import { Schema, GOB_INT, GOB_STRING, SliceOf, type InferSchema } from 'gobts';

const PersonSchema = new Schema('Person', {
  Name: GOB_STRING,
  Age:  GOB_INT,
  Tags: SliceOf(GOB_STRING),
});

type Person = InferSchema<typeof PersonSchema>;
// { Name: string; Age: bigint; Tags: string[] }
```

---

## Encoding

### One-shot

```ts
import { encode, Schema, GOB_INT, GOB_STRING } from 'gobts';

const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });

// Struct
const bytes = encode({ X: 1n, Y: 2n }, { schema: PointSchema });

// Scalar
const intBytes = encode(42n);

// Slice
const sliceBytes = encode([1n, 2n, 3n], { elemType: GOB_INT });

// Map
const mapBytes = encode(new Map([['a', 1n], ['b', 2n]]), {
  keyType: GOB_STRING,
  elemType: GOB_INT,
});

// Empty collections require explicit types
const emptySlice = encode([], { elemType: GOB_INT });
const emptyMap   = encode(new Map(), { keyType: GOB_STRING, elemType: GOB_INT });
```

### Streaming (reuse encoder across messages)

```ts
import { GobEncoder, Schema, GOB_INT } from 'gobts';

const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
const enc = new GobEncoder();

// First call emits type def + value; subsequent calls emit value only.
enc.encode({ X: 1n, Y: 2n }, { schema: PointSchema });
const chunk1 = enc.bytes();   // type def + first message

enc.encode({ X: 3n, Y: 4n }, { schema: PointSchema });
const chunk2 = enc.bytes();   // value message only (type def already sent)

// Reset type state to start a fresh stream (e.g., new connection)
enc.reset();
```

`bytes()` returns accumulated bytes and clears the internal buffer. Type-definition state is preserved across calls — the same schema is never emitted twice in a session.

---

## Decoding

### One-shot

```ts
import { decode } from 'gobts';

const obj = decode(bytes);           // returns GobObject for unknown structs
obj.get('X');                        // unknown → cast or check
obj.has('Y');
for (const [key, val] of obj) { ... }
```

### Streaming

```ts
import { GobDecoder } from 'gobts';

const dec = new GobDecoder(initialBytes);
dec.feed(moreBytes);                     // append more bytes at any time

while (true) {
  const result = dec.tryDecode();
  if (!result.ok) break;
  console.log(result.value);
}

// Or with for...of (same behaviour)
for (const value of dec) {
  console.log(value);
}
```

`decode()` throws `EndOfStreamError` at end of stream. `tryDecode()` returns `{ ok: false }` instead.

---

## Working with GobObject

Decoded structs without a registered factory are returned as `GobObject` instances.

```ts
const obj = decode(bytes) as GobObject;

obj.type          // Go type name, e.g. "Point"
obj.schema        // Schema inferred from wire type
obj.get('X')      // unknown
obj.has('Y')      // boolean
obj.keys()        // string[]
obj.values()      // unknown[]
obj.entries()     // [string, unknown][]

for (const [key, value] of obj) { ... }

// Re-encode a GobObject without extra setup
enc.encode(obj);
```

`GobObject` does not support bracket-notation access (`obj['X']`) — that would require a `Proxy`, which has measurable performance cost.

---

## Registering concrete types for `interface{}` fields

When a Go struct has an `interface{}` field, gobts returns the concrete value as a `GobObject` by default. Register a factory to get a typed value instead:

```ts
import { GobDecoder, Schema, GOB_INT } from 'gobts';

const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });

const dec = new GobDecoder(bytes);
dec.register('main.Point', fields => ({
  x: Number(fields['X'] as bigint),
  y: Number(fields['Y'] as bigint),
}));

const result = dec.decode();
```

### Which name to register

An interface value carries **two** names on the wire, and `register` accepts either:

| Name | Where it comes from | Example |
|------|---------------------|---------|
| Qualified | The interface header — whatever was passed to `gob.Register` on the Go side | `"main.Point"` |
| Unqualified | The inline type definition's `CommonType.Name` | `"Point"` |

The qualified name is tried first, so it wins when both are registered — use it
to disambiguate same-named types from different packages. The unqualified name
is the portable choice: it is what `pygob` and `gobdotnet` key their decode-side
registries on, and it is also the name a **top-level** (non-interface) struct is
matched by.

> **The qualified name is not always `main.X`.** Go builds it from the full
> import path, so a type outside `package main` registers as
> `"github.com/you/pkg.Point"`, not `"pkg.Point"`. If you are unsure of the
> exact string, register the unqualified name instead.

Note the asymmetry with the encoder: `encoder.register(goName, schema)` writes
`goName` into the interface header, so it must be the **qualified** name that
the Go decoder expects.

---

## Codecs: time.Time and uuid.UUID

The default codecs are tree-shaken separately so scalar-only apps don't pay for them.

```ts
import { encode, decode, GobEncoder } from 'gobts';
import { DEFAULT_CODECS } from 'gobts/codecs';
// or individually:
import { TimeCodec } from 'gobts/codecs/time';
import { UuidCodec } from 'gobts/codecs/uuid';

// Decode a Go time.Time → Date
const date = decode(bytes, { codecs: DEFAULT_CODECS }) as Date;

// Encode a Date → Go time.Time
const enc = new GobEncoder({ codecs: DEFAULT_CODECS });
enc.encode(new Date('2009-11-10T23:00:00.000Z'), {
  marshalerType: 'Time',
  marshalerKind: 'gob',
});

// Decode a Go uuid.UUID → string
const uuid = decode(bytes, { codecs: DEFAULT_CODECS }) as string;
// "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
```

### TimeCodec precision

`Date` has millisecond precision; Go stores nanoseconds. Sub-millisecond values are **truncated** on both encode and decode. The timezone offset and IANA zone name are also lost — `Date` stores only UTC milliseconds. The encoded value always carries the UTC sentinel.

For full nanosecond precision or offset preservation, register a custom codec:

```ts
import type { Codec } from 'gobts';

const NanoTimeCodec: Codec<{ seconds: bigint; nanos: number }> = {
  kind: 'gob',
  decode(data) { /* parse 15-byte format */ },
  encode(value) { /* write 15-byte format */ },
};
```

### UuidCodec compatibility

`UuidCodec` is compatible with `github.com/google/uuid`, `github.com/gofrs/uuid`, and `github.com/satori/go.uuid` — all produce the same 16-byte RFC 4122 wire format.

---

## Custom codecs

Implement the `Codec<T>` interface:

```ts
import type { Codec } from 'gobts';

// For a Go type that implements encoding.BinaryMarshaler:
const MyCodec: Codec<MyType> = {
  kind: 'binary',  // 'gob' | 'binary' | 'text'
  encode(value: MyType): Uint8Array { ... },
  decode(bytes: Uint8Array): MyType { ... },
};

// Register with encoder / decoder
const enc = new GobEncoder({ codecs: { MyType: MyCodec } });
const dec = new GobDecoder(bytes, { codecs: { MyType: MyCodec } });
```

The `kind` must match how the Go type is registered in its package (`encoding.GobEncoder` → `'gob'`; `encoding.BinaryMarshaler` → `'binary'`; `encoding.TextMarshaler` → `'text'`). A mismatch produces bytes that Go rejects.

---

## Errors

```ts
import { GobDecodeError, GobEncodeError, EndOfStreamError } from 'gobts';

try {
  decode(malformedBytes);
} catch (e) {
  if (e instanceof EndOfStreamError) { /* buffer exhausted */ }
  if (e instanceof GobDecodeError)   { /* malformed wire data */ }
}

try {
  encode(tooBigBigInt);
} catch (e) {
  if (e instanceof GobEncodeError) { /* out-of-range value or schema error */ }
}
```

All error classes extend `GobError extends Error`.

---

## SemanticType

Map a named Go type (e.g., `type Status string`) to a TypeScript type:

```ts
import { SemanticType, GOB_STRING } from 'gobts';

type Status = 'active' | 'inactive';

const GOB_STATUS = SemanticType<Status>({
  wire: GOB_STRING,
  encode: (s: Status) => s,
  decode: (w: unknown) => w as Status,
  zero: 'inactive',
});

const UserSchema = new Schema('User', {
  Name:   GOB_STRING,
  Status: GOB_STATUS,
});
```

---

## Schema evolution

Adding or removing fields is safe — this is a guarantee of the gob wire format that gobts inherits:

- **Fields present in Go, absent in TS schema:** decoded and ignored.
- **Fields absent in Go, present in TS schema:** filled with zero values.
- **Field types must not change** within a stream — gob has no field-level type negotiation.

---

## Go–TypeScript interchange examples

These patterns are validated by the project's cross-validation test suite, which encodes values in TypeScript and pipes the bytes to a live Go decoder.

### Go encodes, TypeScript decodes

```go
// Go
type Point struct{ X, Y int }
var buf bytes.Buffer
enc := gob.NewEncoder(&buf)
enc.Encode(Point{22, 33})
// send buf.Bytes() over the wire
```

```ts
// TypeScript
const obj = decode(gobBytes) as GobObject;
console.log(obj.get('X')); // 22n
console.log(obj.get('Y')); // 33n
console.log(obj.type);     // "Point"
```

### TypeScript encodes, Go decodes

```ts
// TypeScript
const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
const bytes = encode({ X: 22n, Y: 33n }, { schema: PointSchema });
// send bytes over the wire
```

```go
// Go
type Point struct{ X, Y int }
var p Point
gob.NewDecoder(bytes.NewReader(data)).Decode(&p)
// p == Point{22, 33}
```

### Nested structs

```ts
const PointSchema = new Schema('Point', { X: GOB_INT, Y: GOB_INT });
const PersonSchema = new Schema('Person', {
  Name: GOB_STRING,
  Home: PointSchema,
});
const bytes = encode(
  { Name: 'Alice', Home: { X: 10n, Y: 20n } },
  { schema: PersonSchema },
);
```

```go
type Person struct {
    Name string
    Home Point
}
var p Person
gob.NewDecoder(bytes.NewReader(data)).Decode(&p)
// p == Person{Name: "Alice", Home: Point{10, 20}}
```

---

## Wire format compatibility notes

- **User type IDs start at 65.** Go's global type registry accumulates IDs across encoder instances within a process. A fresh gobts encoder always starts at 65, but a Go encoder in a long-running process may have already assigned 65–N to earlier types. Consequence: **byte-level comparison against Go-generated `.gob` files is reliable only for scalars** (which carry no user type IDs). For structs, slices of structs, and maps: decode both sides and compare values structurally. The `go_verify` test helper does this correctly.

- **Go map iteration is non-deterministic.** Never byte-compare map-containing gob output between runs or processes — the key-value order varies. Decode and compare structurally.

- **Zero-valued fields are omitted on the wire.** The decoder pre-populates all fields with zero values before the delta loop, so missing fields arrive as their Go zero value (`0n`, `false`, `""`, etc.).

- **Float bytes are reversed.** Go's float encoding is byte-reversed IEEE 754, then encoded as unsigned int. This is a feature (trailing-zero compression), not a bug.

- **Nested struct fields are unwrapped.** A nested struct value is raw delta-encoded bytes with no type def and no byte-count prefix.

- **Collection wire types use an empty `CommonType.Name`.** The `Id` field arrives with delta=2, skipping the absent `Name`. This is the most common source of off-by-one delta bugs.

---

## Limitations

- **Integers default to `bigint`.** Convert with `Number(x)` when you know the value is safe (≤ `Number.MAX_SAFE_INTEGER`).
- **`time.Time` loses offset and sub-millisecond precision.** Register a custom codec for nanosecond or offset fidelity.
- **`interface{}` encoding requires type registration** (`encoder.register(goName, schema)`) with the fully-qualified Go name. Decoding is always self-describing and requires no registration; registering a decode-side factory is optional, and accepts either the qualified or the unqualified name.
- **No async API in v1.** Use `decoder.feed()` inside a chunk loop for streaming over WebSockets or Node streams.
- **Array length not preserved.** `[3]int` decodes to `bigint[]` of length 3; re-encode with `ArrayOf(GOB_INT, 3)` to restore wire fidelity.
- **Map ordering is non-deterministic** in Go. Byte-level comparison of map-containing gob streams is unreliable — decode and compare structurally.
- **No recursive types.** Self-referential structs are not supported.
- **`bigint` values outside `[-(2^63), 2^63-1]` throw `GobEncodeError`** — no silent truncation.
- **`SemanticType` conversion is encode-side only.** The decoder has no schema to infer the semantic type from; it returns the underlying wire primitive (`bigint`, `number`, `string`, etc.). Apply your conversion after decoding.

---

## Performance

gobts is not a high-performance serializer. The rough target is within **2× of `JSON.stringify`/`JSON.parse`** for equivalent payloads. Actual numbers on an AMD Ryzen 9 5950X, Bun 1.3.10:

| Scenario | gobts | JSON equiv | Ratio |
|----------|-------|------------|-------|
| encode bigint 42n | 2.81 µs | 34 ns | ~83× |
| encode string "hello, world!" | 2.88 µs | 43 ns | ~67× |
| decode bigint | 3.02 µs | 30 ns | ~100× |
| encode Point (cold) | 7.20 µs | 60 ns | ~120× |
| encode Point (warm, reused encoder) | 2.53 µs | 62 ns | ~40× |
| decode Point | 6.66 µs | 83 ns | ~80× |
| decode []int (1000 elements) | 103 µs | 17.8 µs | ~6× |
| decode 1000 Points | 318 µs | 75 µs | ~4× |

The gap versus JSON is consistent with the Python and C# ports of this library, and is expected given V8's built-in JSON routines vs. TypeScript object allocation. For large payloads (1000 Points: 4×) the overhead is well within range for typical RPC use cases.

For streaming use cases: reuse a single `GobEncoder` across many messages. The warm-encoder path (type defs emitted once) costs ~2.5 µs per Point message — adequate for most applications.

Run benchmarks: `bun bench/index.bench.ts`

---

## Development

```sh
bun test                          # run all tests (289 tests)
bun test tests/decoder.test.ts    # one file
bunx tsc --noEmit                 # type-check only
bun run build                     # compile to dist/ for npm publishing
bun bench/index.bench.ts          # benchmarks
go run tests/generate_testdata.go # regenerate Go fixtures (requires Go)
```

Tests include four validation layers:

1. **Go → TS** — every `.gob` file in `tests/testdata/` decoded against a JSON sidecar.
2. **TS → TS round-trip** — catches asymmetric encoder/decoder bugs.
3. **TS → Go cross-validation** — gobts output piped to a Go decoder; skipped (not failed) when Go is absent.
4. **Property tests** — `fast-check` fuzzes round-trip invariants at 1000 runs per shape.

---

## Sister libraries

| Language | Library |
|----------|---------|
| Go | `encoding/gob` (standard library) |
| Python | `pygob` |
| C# | `gobdotnet` |
| TypeScript | **gobts** (this library) |

Same mental model across all ports: `Schema`, `SliceOf`, `MapOf`, `GOB_INT`, etc.

---

## License

MIT
