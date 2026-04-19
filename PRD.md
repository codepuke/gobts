# PRD: gobts — TypeScript Port of Go's encoding/gob

## Overview

`gobts` is a pure-TypeScript encoder and decoder for Go's `gob` binary serialization format. It is a sister library to `pygob` (Python) and `gobdotnet` (C#). It shares the same mental model — `Schema`, `SliceOf`, `MapOf`, `ArrayOf`, `GOB_INT`, and so on — while embracing TypeScript-native conventions: `Uint8Array` buffers, `bigint` for 64-bit integers, module-level functions, tree-shakeable exports, strict nullability, and compile-time type inference via generics.

The goal is full wire-format compatibility with Go's `encoding/gob` package: any byte stream produced by Go's encoder must decode correctly in TypeScript, and any byte stream produced by the TypeScript encoder must decode correctly in Go.

### Who this is for

- Node.js services that need to interoperate with Go services over gob (RPC, on-disk formats, message queues).
- Bun and Deno services needing the same.
- Frontend code that consumes gob blobs produced by a Go backend.
- Polyglot shops wanting a consistent serialization story across Go, Python, .NET, and TypeScript.

We do NOT claim to match `msgpack-javascript`, `@bufbuild/protobuf`, or other high-performance binary serializers. The rough performance target is **within 2× of `JSON.stringify` / `JSON.parse`** for equivalent payloads. See [Benchmarks](#benchmarks).

### Target format version

We target gob as of Go 1.22. If Go adds new wire types in later versions (rare but possible), they will be added in minor versions of gobts.

### Supported runtimes

- **Node.js 20+** (LTS lines with `TextEncoder`, `TextDecoder`, `DataView` all built in).
- **Bun 1.1+** (primary development target — matches the maintainer's toolchain preference).
- **Modern browsers** — everything we depend on (`Uint8Array`, `DataView`, `TextEncoder`, `bigint`, ES2022) has been baseline for years.
- **Deno** — should work out of the box via npm specifiers; not tested in CI initially.

---

## Project Philosophy

- **Decode to native TypeScript types where possible.** `int`/`uint` → `bigint`; `float64` → `number`; `bool` → `boolean`; `string` → `string`; `[]byte` → `Uint8Array`; `complex128` → `Complex`; `map[K]V` → `Map<K, V>`; struct → `GobObject` (object with `Symbol` metadata) or a typed plain object when a schema is provided.
- **Encode with schemas, not reflection.** TypeScript's types are erased at runtime, so there is no `reflect.Type.Name()` equivalent. The user supplies a `Schema` (either by hand or via `InferSchema<S>` for type-inferred round-trips). `GobObject` instances carry their schema internally so decoded values can be re-encoded without any additional setup.
- **`bigint` is the default integer representation.** JavaScript `number` is IEEE 754 float64 and loses precision above `2^53 - 1`. Go's `int` is 64-bit. Silent truncation would be a data-loss footgun. We default to `bigint` and provide escape hatches (`Number(x)` is one line).
- **Wire fidelity.** The encoder produces bytes that Go's decoder accepts without modification.
- **No external runtime dependencies.** The main library depends on nothing beyond the ECMAScript built-ins (`Uint8Array`, `DataView`, `TextEncoder`, `TextDecoder`, `Map`, `Set`). Dev dependencies are scoped to test/bench.
- **ESM only, with correct `.d.ts` output.** CJS users can interop via dynamic `import()`. We do not maintain a dual-publish.
- **Tree-shakeable.** Sub-path imports (`gobts/codecs/time`) keep the codec bundles out of apps that don't use them.
- **Strict mode.** `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`. All public API fully typed.
- **No decorators.** Stage-3 decorators are workable but add a compile-config dependency. `defineGobStruct`-style builders (à la Zod, Valibot) are idiomatic and work in any TS config.

---

## Architecture

```
gobts/
├── src/
│   ├── index.ts            # Public re-exports
│   ├── codec.ts            # GobReader / GobWriter — primitive read/write on Uint8Array
│   ├── wire.ts             # Bootstrap type IDs, WireType structures, decoder
│   ├── types.ts            # Schema, GobObject, GobFieldType, SliceOf, MapOf, ArrayOf,
│   │                       # GOB_* constants, SemanticType, GobEncoded
│   ├── infer.ts            # InferSchema<S> type-level helpers (types only, no runtime)
│   ├── encoder.ts          # GobEncoder — stateful, message-sequence encoder
│   ├── decoder.ts          # GobDecoder — stateful, message-sequence decoder
│   ├── errors.ts           # GobError, GobDecodeError, GobEncodeError, EndOfStreamError
│   └── codecs/
│       ├── index.ts        # DEFAULT_CODECS
│       ├── time.ts         # Date ↔ Go time.Time
│       └── uuid.ts         # string (canonical hyphenated) ↔ Go uuid.UUID
├── tests/
│   ├── testdata/           # .gob and .json files; copied from pygob at project start,
│   │                       # evolves independently from here
│   ├── go_verify/
│   │   └── main.go         # Copied from pygob at project start, evolves separately
│   ├── generate_testdata.go # Copied from pygob at project start, evolves separately
│   ├── go.mod
│   ├── fixtures.ts         # Testdata loader, go_verify subprocess helper
│   ├── codec.test.ts       # Low-level encode+decode: uint, int, float, bool, string, bytes
│   ├── wire.test.ts        # Wire type structure decoding
│   ├── decoder.test.ts     # Decode every .gob file vs. its .json sidecar (parametrized)
│   ├── encoder.test.ts     # Encoding output, type-def idempotency, collections, structs
│   ├── roundtrip.test.ts   # Encode → decode → assert value equality
│   ├── goVerify.test.ts    # TS encode → Go decode cross-validation (skipped if Go absent)
│   ├── types.test.ts       # Schema, GobObject, SliceOf/MapOf/ArrayOf, SemanticType
│   ├── codecs.test.ts      # TimeCodec, UuidCodec, custom codec registration
│   ├── property.test.ts    # fast-check round-trip properties
│   └── errors.test.ts      # Truncated streams, type mismatches, missing registrations
├── bench/
│   └── index.bench.ts      # mitata — gobts vs JSON.stringify/parse
├── package.json
├── tsconfig.json
├── README.md
├── PRD.md                   # This file
├── PROGRESS.md              # Phase tracker
└── CLAUDE.md                # Claude Code guidance
```

> **Note on test assets:** The files under `testdata/`, `go_verify/`, and `generate_testdata.go` are **copied** from the Python port at project start, not referenced or submoduled. They will evolve independently after the initial copy. This matches the approach used by `gobdotnet` and avoids cross-repo synchronization complexity at the cost of occasional manual refresh when the Python or C# ports gain new test cases.

---

## Gob Wire Format Reference

This section is the definitive reference for this implementation. It is substantively identical to the pygob and gobdotnet PRDs — the wire format does not change across language ports. See also the Go source at `encoding/gob`.

### Primitive Encoding

**Unsigned int:** value < 128 → single byte. Otherwise: header byte = `256 - byte_count`, followed by big-endian minimal bytes.

- `0` → `0x00`
- `127` → `0x7F`
- `128` → `0xFF 0x80`
- `256` → `0xFE 0x01 0x00`
- `65536` → `0xFD 0x01 0x00 0x00`

**Signed int:** zigzag into unsigned. `if i < 0: u = (~i << 1) | 1` else `u = i << 1`. Then encode as unsigned int.

- `0` → `0x00` (zigzag 0)
- `1` → `0x02` (zigzag 2)
- `-1` → `0x01` (zigzag 1)
- `128` → `0xFF 0x00 0x01` (unsigned 256)

**Bool:** unsigned int 0 or 1.

**Float:** IEEE 754 float64 bits → byte-reversed → encoded as unsigned int. This puts the exponent byte first and enables trailing-zero compression for small values.

**Complex:** two floats (real then imaginary).

**String / `[]byte`:** unsigned int length, then raw bytes (UTF-8 for strings).

### Composite Types

**Slice/Array:** unsigned int element count, then N elements.

**Map:** unsigned int pair count, then N key-value pairs.

**Struct:** sequence of (unsigned int delta, field value). Delta = 0 terminates. Field indices start from -1, so the first field always sends delta=1.

- Zero-valued fields are **omitted** entirely. The decoder fills omitted fields with their Go zero values.
- Field ordering follows the Go struct's **source declaration order**, preserved in the wire type's field list.

### Top-Level Messages

A gob stream is a sequence of framed messages: `(uint byteCount, message)*`.

Each message is:
- **Type definition:** `int(-typeId) wireType_bytes` — defines a new user type.
- **Value:** `int(typeId) payload` — encodes a value of a known type.

Non-struct top-level values are wrapped: `0x00 encoded_value` (a singleton struct field with no field number — just the value, preceded by the struct terminator byte).

### Bootstrap Type IDs

```
BOOL=1, INT=2, UINT=3, FLOAT=4, BYTES=5, STRING=6, COMPLEX=7, INTERFACE=8
WIRE_TYPE=16, ARRAY_TYPE=17, COMMON_TYPE=18, SLICE_TYPE=19,
STRUCT_TYPE=20, FIELD_TYPE=21, FIELD_TYPE_SLICE=22, MAP_TYPE=23
User types: FIRST_USER_ID = 65
```

Go pre-decrements before assigning, so the first type in a fresh Go process gets ID 64. The TS encoder starts at 65 (matching Go's stated constant) for test determinism — identical to pygob and gobdotnet.

### Wire Type Structures

`WireType` is a struct with optional fields at delta positions 0–6:

```
field 0: ArrayT          → {CommonType, Elem typeId, Len int}
field 1: SliceT          → {CommonType, Elem typeId}
field 2: StructT         → {CommonType, Field []FieldType}
field 3: MapT            → {CommonType, Key typeId, Elem typeId}
field 4: GobEncoderT     → {CommonType}
field 5: BinaryMarshalerT → {CommonType}
field 6: TextMarshalerT  → {CommonType}
```

`CommonType = {Name string, Id int}`
`FieldType = {Name string, Id int}`

**Critical:** Collection types (slice, map, array) have an **empty** `CommonType.Name`. Since gob omits zero-value fields, and an empty string is the zero value for string, the `Name` field is **not transmitted** — the `Id` field arrives with a delta of 2 (skipping field 0, the Name). This is one of the most subtle bugs to hit during implementation.

### The `CommonType.Name` for `BinaryMarshaler`/`GobEncoder` types

For user types implementing `BinaryMarshaler`, `GobEncoder`, or `TextMarshaler`, Go transmits the **unqualified type name** (from `reflect.Type.Name()`), not the package-qualified name. For example, `time.Time` is transmitted as `"Time"`, and `github.com/google/uuid.UUID` is transmitted as `"UUID"`. This is a different namespace from the package-qualified names used for `interface{}` concrete-type registration (`gob.Register`), which are qualified (e.g., `"main.Point"`).

Our codec registry keys use the unqualified form to match Go's wire convention.

---

## Type System

### Go → TypeScript Type Mapping

| Go Type | TypeScript Type | Notes |
|---------|-----------------|-------|
| `int` / `int64` | `bigint` | Go's default int is 64-bit; `number` would lose precision |
| `uint` / `uint64` | `bigint` | Same reasoning; sign tracked via schema, not value type |
| `int32`, `int16`, `int8` | `bigint` | Encoded as signed gob int; widen on decode |
| `uint32`, `uint16`, `uint8` | `bigint` | Encoded as unsigned gob int |
| `bool` | `boolean` | |
| `float64` | `number` | |
| `float32` | `number` | Encoded as float64 on the wire (gob has no float32) |
| `complex128` | `Complex` | `{ re: number, im: number }` — library-defined class |
| `string` | `string` | UTF-8 |
| `[]byte` | `Uint8Array` | Not `Buffer`, not `ArrayBuffer` |
| `[]T` | `T[]` | Plain array |
| `[N]T` | `T[]` | Fixed-length info lost on decode; re-encode via `ArrayOf(elem, N)` |
| `map[K]V` | `Map<K, V>` | Use `Map` to preserve non-string key types; see below |
| `struct` | `GobObject` \| typed plain object | Typed when a schema is supplied to `decode<T>` |
| `interface{}` | `unknown` | Concrete value embedded; structs become `GobObject` or registered typed object |
| `time.Time` (with default codecs) | `Date` | See [TimeCodec](#timecodec-details) for precision and offset behavior |
| `uuid.UUID` (with default codecs) | `string` | Canonical hyphenated lowercase, e.g. `"6ba7b810-9dad-11d1-80b4-00c04fd430c8"` |
| `time.Duration` | `bigint` (nanoseconds) | Via `GOB_DURATION`; see [Precision](#duration-precision) |
| named primitive (e.g., `type Status string`) | custom TS type | Via `SemanticType` |

### Integers: `bigint` vs `number`

JavaScript's `number` is IEEE 754 float64. Integers up to `2^53 - 1` (`Number.MAX_SAFE_INTEGER`, roughly 9.0e15) are exact; above that, bit patterns collide. Go's `int` is 64-bit, and gob transmits values up to `2^63 - 1` (roughly 9.2e18). Silently coercing to `number` would lose data for any value above `MAX_SAFE_INTEGER`.

**Decision:** `GOB_INT` and `GOB_UINT` decode to `bigint` by default. When encoding, the user passes a `bigint` (or a `number` — the encoder coerces `number` to `bigint` via `BigInt(n)`, which throws on non-integer or unsafe values).

**Ergonomics:** Converting a `bigint` to `number` when safe is one line (`Number(x)`). Converting the other direction is also one line (`BigInt(n)`). The coercion cost is negligible for normal payloads.

**No opt-in "decode as number" flag.** Either all ints are `bigint` (safe), or some are `bigint` and some are `number` (context-dependent, footgun). We pick the safe default and document it prominently. Users who want raw `number` can run a one-pass post-decode transform.

Tagged literal numbers are not a thing in JS the way they are in Python (`UInt(42)`): signedness is tracked in the schema, not the value. A `bigint` field typed as `GOB_INT` encodes as signed; typed as `GOB_UINT` encodes as unsigned. This matches how gob works natively and mirrors the C# port's approach (`long` vs `ulong` is a schema decision).

### Schema

```ts
export class Schema<F extends FieldMap = FieldMap> {
  readonly name: string;
  readonly fields: ReadonlyArray<[string, GobFieldType]>;

  constructor(name: string, fields: F);

  /** Derive a schema from a runtime prototype. Rarely needed — usually you build
   *  a Schema directly. Provided for symmetry with pygob/gobdotnet. */
  static from(name: string, fields: Record<string, GobFieldType>): Schema;
}

export type FieldMap = Record<string, GobFieldType>;
```

Construction is straightforward:

```ts
import { Schema, GOB_INT, GOB_STRING } from 'gobts';

const PointSchema = new Schema('Point', {
  X: GOB_INT,
  Y: GOB_INT,
});

const PersonSchema = new Schema('Person', {
  Name: GOB_STRING,
  Age:  GOB_INT,
  Loc:  PointSchema,      // nested struct — Schema is itself a valid GobFieldType
});
```

`Schema` implements `GobFieldType` so it can be used as a field type directly (nested structs).

### GobFieldType

Field type descriptors. Analogous to pygob's constants and descriptor classes, and gobdotnet's `GobFieldType` static singletons.

```ts
// Primitive constants (exported as singletons):
export const GOB_BOOL: GobFieldType;
export const GOB_INT: GobFieldType;
export const GOB_UINT: GobFieldType;
export const GOB_FLOAT: GobFieldType;
export const GOB_BYTES: GobFieldType;
export const GOB_STRING: GobFieldType;
export const GOB_COMPLEX: GobFieldType;
export const GOB_INTERFACE: GobFieldType;

// Well-known semantic type:
export const GOB_DURATION: GobFieldType;   // bigint (ns) on the wire, no conversion on decode

// Composite factories:
export function SliceOf(elem: GobFieldType): GobFieldType;
export function MapOf(key: GobFieldType, value: GobFieldType): GobFieldType;
export function ArrayOf(elem: GobFieldType, length: number): GobFieldType;
// (A Schema instance is itself a GobFieldType — use it directly for nested structs.)

// Marshaler field types (for time.Time, uuid.UUID, etc.):
export function Marshaler(typeName: string, kind: 'gob' | 'binary' | 'text'): GobFieldType;

// Named primitive types (type Status string, type Count int64, ...):
export interface SemanticType<T> extends GobFieldType {
  readonly kind: 'semantic';
  readonly wire: GobFieldType;
  readonly encode: (value: T) => WireValue;
  readonly decode: (wire: WireValue) => T;
  readonly zero: T;
}
export function SemanticType<T>(opts: {
  wire: GobFieldType;
  encode: (value: T) => WireValue;
  decode: (wire: WireValue) => T;
  zero: T;
}): SemanticType<T>;
```

### Complex numbers

```ts
export class Complex {
  constructor(re: number, im: number);
  readonly re: number;
  readonly im: number;
  static readonly ZERO: Complex;
  equals(other: Complex): boolean;
  toString(): string;
}
```

Small and immutable. Not `frozen` at runtime (cost) but API-surface immutable.

### GobObject

```ts
/**
 * A decoded gob struct with no registered TS type. Carries the Go type name and
 * schema needed to re-encode it. Behaves as a plain read-only object with extra
 * metadata accessed via getters.
 */
export class GobObject {
  constructor(type: string, schema: Schema, fields: Record<string, unknown>);

  /** Go type name (e.g., "Point", "main.Container"). */
  readonly type: string;
  /** Full field schema — enables re-encoding without additional setup. */
  readonly schema: Schema;
  /** Plain object of field values. Readonly. */
  readonly fields: Readonly<Record<string, unknown>>;

  get(key: string): unknown;
  has(key: string): boolean;
  keys(): string[];
  values(): unknown[];
  entries(): Array<[string, unknown]>;

  // Iterable<[string, unknown]>
  [Symbol.iterator](): IterableIterator<[string, unknown]>;
}
```

**Not** indexable via `obj[key]` — that would require a `Proxy`, which has measurable perf cost and trips up structured clone. Accessing fields uses `obj.get(key)` or `obj.fields[key]`. This is one idiomatic change from the Python and C# APIs where dict/indexer access is natural.

### GobEncoded

```ts
/**
 * Opaque bytes for a Go type that implements GobEncoder, BinaryMarshaler, or
 * TextMarshaler when no TS codec is registered for that type name.
 */
export class GobEncoded {
  constructor(typeName: string, data: Uint8Array);
  /** Unqualified Go type name (e.g., "Time", "UUID"). */
  readonly typeName: string;
  readonly data: Uint8Array;
}
```

### Type Inference: `InferSchema<S>`

Because TS types are erased at runtime, we can't derive types from a class like `[GobStruct]` does in C#. The equivalent is a type-level helper that walks a `Schema`'s field types and produces the corresponding TS type. This makes round-trips type-safe at compile time without runtime cost.

```ts
import { Schema, GOB_INT, GOB_STRING, SliceOf, type InferSchema } from 'gobts';

const PointSchema = new Schema('Point', {
  X: GOB_INT,
  Y: GOB_INT,
});

type Point = InferSchema<typeof PointSchema>;
// Point = { X: bigint; Y: bigint }

const PersonSchema = new Schema('Person', {
  Name: GOB_STRING,
  Age:  GOB_INT,
  Tags: SliceOf(GOB_STRING),
});

type Person = InferSchema<typeof PersonSchema>;
// Person = { Name: string; Age: bigint; Tags: string[] }
```

Implementation notes:

- `GobFieldType` is a discriminated union with a `readonly symbol` brand on each variant.
- `InferSchema<S>` is a purely type-level conditional type chain — no runtime footprint.
- For `Marshaler("Time", "gob")` without a codec registered: inferred as `GobEncoded`. With the default time codec registered: inferred as `Date`. This is captured via a second generic parameter: `InferSchema<S, C extends CodecMap = {}>`.
- For `GOB_INTERFACE`: inferred as `unknown`.

This is the TS-native equivalent of the C# source generator — type inference without a build step.

### Zero values

Both encoding (to detect omission) and decoding (to pre-populate) need a zero value per field type:

- `GOB_BOOL` → `false`
- `GOB_INT` / `GOB_UINT` → `0n`
- `GOB_FLOAT` → `0`
- `GOB_STRING` → `""`
- `GOB_BYTES` → `new Uint8Array(0)`
- `GOB_COMPLEX` → `Complex.ZERO`
- `GOB_INTERFACE` → `null`
- `GOB_DURATION` → `0n`
- `SliceOf(...)` → `[]`
- `ArrayOf(..., N)` → N-length array of element zero values
- `MapOf(...)` → `new Map()`
- `Schema` (nested struct) → never omitted (Go always transmits)
- `SemanticType<T>` → `.zero` from the definition

---

## Public API

All functions live at the package root and under `gobts/codecs`. The stream-oriented classes `GobEncoder` and `GobDecoder` operate on `Uint8Array` — for live streaming users wrap them with a chunk loop (examples in the README).

### Convenience functions

```ts
/** Encode a value to bytes. Creates a fresh encoder per call. */
export function encode<T>(
  value: T,
  options?: EncodeOptions,
): Uint8Array;

/** Decode the first value from a buffer. Creates a fresh decoder per call.
 *  Throws EndOfStreamError if the buffer is empty. */
export function decode<T = unknown>(
  bytes: Uint8Array,
  options?: DecodeOptions,
): T;

export interface EncodeOptions {
  /** Schema for non-struct values and for plain-object values. */
  schema?: Schema;
  /** Element type for top-level slices/maps without an embedded schema. */
  elemType?: GobFieldType;
  /** Key type for top-level maps. */
  keyType?: GobFieldType;
  /** Array length for encoding as a fixed-length array. */
  arrayLength?: number;
  /** Codecs for BinaryMarshaler / GobEncoder / TextMarshaler types. */
  codecs?: CodecMap;
  /** Registered concrete types for interface{} fields (qualified Go names). */
  registry?: Map<string, Schema>;
}

export interface DecodeOptions {
  codecs?: CodecMap;
  /** Map Go type names to TS constructor/factory; otherwise returns GobObject. */
  registry?: Map<string, (fields: Record<string, unknown>) => unknown>;
}
```

### GobEncoder

Stream-oriented encoder. Keeps type-definition state across multiple `encode` calls — the same type ID is reused for the same schema, matching Go's wire protocol.

```ts
export class GobEncoder {
  constructor(options?: EncodeOptions);

  /** Append the value's message(s) to the internal buffer. */
  encode<T>(value: T, options?: EncodeOptions): void;

  /** Register a concrete type for interface{} fields.
   *  goName is the fully-qualified Go name (e.g., "main.Point"). */
  register(goName: string, schema: Schema): void;

  /** Register a codec for a BinaryMarshaler / GobEncoder / TextMarshaler type.
   *  typeName is the unqualified Go type name (e.g., "Time", "UUID"). */
  registerCodec<T>(typeName: string, codec: Codec<T>): void;

  /** Return accumulated bytes and reset the internal buffer to empty.
   *  Type-definition state is retained — subsequent encode() calls do NOT
   *  re-emit type defs. Call reset() to start a fresh wire session. */
  bytes(): Uint8Array;

  /** Clear all state: buffer, type registries, interface registrations.
   *  Codec registrations ARE preserved. */
  reset(): void;
}
```

**Why `bytes()` returns and resets:** this matches the common pattern of "encode multiple values, grab the result once." For truly streaming output (WebSocket, piped stdout), wrap the encoder in a loop that calls `bytes()` after each `encode()` and pipes the chunk.

### GobDecoder

Stream-oriented decoder. Maintains a type registry across calls — type definitions received in earlier messages are reused in later ones.

```ts
export class GobDecoder {
  /** Construct with initial buffer (can be empty and fed later). */
  constructor(bytes?: Uint8Array, options?: DecodeOptions);

  /** Append bytes to the internal buffer. Useful for incremental streaming. */
  feed(bytes: Uint8Array): void;

  /** Decode the next complete value.
   *  Throws EndOfStreamError when the buffer is exhausted.
   *  Throws GobDecodeError on malformed data. */
  decode<T = unknown>(): T;

  /** Attempt to decode; returns { ok: false } at end of stream. */
  tryDecode<T = unknown>(): { ok: true; value: T } | { ok: false };

  /** Register a TS factory for a Go struct name. */
  register<T>(goTypeName: string, factory: (fields: Record<string, unknown>) => T): void;

  /** Register a codec. */
  registerCodec<T>(typeName: string, codec: Codec<T>): void;

  /** True if at least one more value may be available.
   *  Cheap heuristic — a true response does not guarantee a complete message. */
  hasMore(): boolean;

  /** Async iteration over remaining values. */
  [Symbol.iterator](): IterableIterator<unknown>;
}
```

### Codec interface

```ts
export interface Codec<T> {
  /** Must match Go's marshaler kind: "gob", "binary", or "text". */
  readonly kind: 'gob' | 'binary' | 'text';
  encode(value: T): Uint8Array;
  decode(bytes: Uint8Array): T;
}

export type CodecMap = Record<string, Codec<unknown>>;
```

### Default codecs

```ts
// gobts/codecs/time.ts
export const TimeCodec: Codec<Date>;

// gobts/codecs/uuid.ts
export const UuidCodec: Codec<string>;

// gobts/codecs/index.ts
export const DEFAULT_CODECS: CodecMap;   // { Time: TimeCodec, UUID: UuidCodec }
```

Subpath imports keep the codec bundles out of apps that don't need them — a scalar-only user doesn't pay the codec cost.

### Errors

```ts
export class GobError extends Error {}
export class GobDecodeError extends GobError {}   // malformed wire data
export class GobEncodeError extends GobError {}   // unsupported type, schema error
export class EndOfStreamError extends GobError {} // buffer exhausted during decode
```

`tryDecode()` returns `{ ok: false }` instead of throwing `EndOfStreamError`. Matches the C# `TryDecode` convention.

---

## Codec Details

### TimeCodec Details

Go's `time.Time` wire format (15 bytes, via `GobEncoder` — NOT `BinaryMarshaler`, despite common assumption):

```
byte[0]:     version = 1
byte[1..8]:  seconds since January 1, year 1, UTC (int64 big-endian)
byte[9..12]: nanoseconds offset (int32 big-endian) — range [0, 999999999]
byte[13..14]: timezone offset in minutes (int16 big-endian)
              -1 = UTC sentinel (distinguishes from zone name "UTC")
```

The `TimeCodec` registers under the kind `"gob"` (not `"binary"`). This matches the bug the `gobdotnet` implementation hit: `time.Time` implements `encoding.GobEncoder`, not `BinaryMarshaler`. Wire-type field index 4 is `GobEncoderT`, and the codec's `kind` controls which field index the encoder emits.

**Decoding (Go → TS):** `Date` from the transmitted seconds + nanos. **The offset is lost.** `Date` stores only UTC milliseconds since epoch and has no offset field. To preserve offset on decode, users can register a custom codec that returns a richer structure (e.g., `{ date: Date, offsetMinutes: number }` or a `Temporal.ZonedDateTime` once Temporal is broadly available).

**Encoding (TS → Go):** `Date` has no offset; we emit the UTC sentinel (-1). Users who need to encode with a non-UTC offset pass a `GobTime`-like object through a custom codec.

**Precision loss:** JS `Date` has millisecond resolution; Go stores nanoseconds. Sub-millisecond values are truncated on both decode (nanos → ms) and encode (ms → ns with trailing zero fill). Document clearly. Users who need nanosecond precision can register a custom codec that returns `bigint` (Unix nanos) or a `{ seconds: bigint, nanos: number }` record.

**Forward-compatibility note:** when `Temporal` is baseline, a `TemporalTimeCodec` can ship as an opt-in replacement. This is an additive change, not a breaking one.

### UuidCodec Details

`UuidCodec` targets any Go type named `UUID` that implements `BinaryMarshaler` with the standard 16-byte RFC 4122 representation. This is compatible with `github.com/google/uuid`, `github.com/gofrs/uuid`, and `github.com/satori/go.uuid` without per-package configuration — all three produce the same 16-byte wire format, and gob transmits only the unqualified type name (`"UUID"`).

**Decode:** 16 bytes → canonical hyphenated lowercase string (`"6ba7b810-9dad-11d1-80b4-00c04fd430c8"`). This matches `crypto.randomUUID()`'s output format and is the de facto JS convention. Validated against the lowercase hex regex; invalid bytes still round-trip losslessly since we just hex-encode.

**Encode:** parse the hyphenated string back to 16 bytes, case-insensitive on input. Throws `GobEncodeError` on malformed input.

**Why string, not Uint8Array:** strings are value-equal by default in JS (`===`), immutable, serializable via `JSON.stringify`, and match the `crypto.randomUUID()` output. `Uint8Array` requires manual equality and doesn't JSON-round-trip. The cost is 36 chars vs 16 bytes, which is negligible.

### Duration Precision

Go's `time.Duration` is `int64` nanoseconds. We decode to `bigint` nanoseconds — no lossy conversion to `number` seconds or a JS-native duration type (there isn't one). Users who want milliseconds write `Number(durationNs / 1_000_000n)` or similar.

`GOB_DURATION` is defined as a `SemanticType<bigint>` over `GOB_INT`. It is identical to `GOB_INT` on the wire; the distinction is that `GOB_DURATION` documents intent and leaves room for a future `TemporalDurationCodec`.

---

## Implementation Plan

### Phase 0 — Scaffolding

- Initialize with `bun init --typescript`, replace defaults with project-specific config.
- `package.json`: name `gobts`, `"type": "module"`, correct `exports` map with subpath `./codecs/time`, `./codecs/uuid`.
- `tsconfig.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"moduleResolution": "bundler"`, `"target": "ES2022"`.
- Dev deps: `@types/bun`, `fast-check`, `mitata`, `typescript`. Nothing at runtime.
- Copy `testdata/`, `go_verify/`, `generate_testdata.go`, `go.mod` from the Python port.
- `bun test` runs, even with no tests (sanity check).
- `bunx tsc --noEmit` passes.

### Phase 1 — Codec Layer (`codec.ts`)

Implement stream-level primitive encoding and decoding on `Uint8Array`. All functions are pure (no state beyond cursor position). No thread-safety concerns — JS is single-threaded per context.

```ts
// Writer: appends to a growing Uint8Array via chunk buffer.
export class GobWriter {
  writeUInt(value: bigint): void;
  writeInt(value: bigint): void;
  writeFloat(value: number): void;
  writeComplex(value: Complex): void;
  writeBool(value: boolean): void;
  writeString(value: string): void;
  writeBytes(value: Uint8Array): void;
  writeRaw(bytes: Uint8Array): void;
  bytes(): Uint8Array;   // accumulated bytes (does not reset)
}

// Reader: cursor over a Uint8Array.
export class GobReader {
  constructor(bytes: Uint8Array, offset?: number);
  readUInt(): bigint;    // throws EndOfStreamError at EOF
  readInt(): bigint;
  readFloat(): number;
  readComplex(): Complex;
  readBool(): boolean;
  readString(): string;
  readBytes(): Uint8Array;
  readRaw(n: number): Uint8Array;
  get position(): number;
  get remaining(): number;
  eof(): boolean;
}
```

**Do NOT use `DataView` for variable-length types.** Use it only for fixed-width reads inside `writeFloat`/`readFloat`. The uint encoding is hand-rolled byte math.

**Float byte-reversal:** write the float64 to a `Float64Array`, read back as `Uint8Array`, reverse, then encode as uint. Reverse this on decode. Document thoroughly — it is the single most-forgettable piece of the format.

**String encoding:** `TextEncoder` / `TextDecoder` for UTF-8. Both are sync and baseline in all target runtimes.

### Phase 2 — Wire Types (`wire.ts`)

Define wire-type records and a `decodeWireType(reader: GobReader): WireType` function.

Bootstrap type ID constants:

```ts
export const BOOL = 1;
export const INT = 2;
export const UINT = 3;
export const FLOAT = 4;
export const BYTES = 5;
export const STRING = 6;
export const COMPLEX = 7;
export const INTERFACE = 8;
export const WIRE_TYPE = 16;
export const ARRAY_TYPE = 17;
export const COMMON_TYPE = 18;
export const SLICE_TYPE = 19;
export const STRUCT_TYPE = 20;
export const FIELD_TYPE = 21;
export const FIELD_TYPE_SLICE = 22;
export const MAP_TYPE = 23;
export const FIRST_USER_ID = 65;
```

Wire-type records as plain readonly interfaces (or classes with `readonly` fields — interfaces are lighter and TS-native):

```ts
export interface CommonType { readonly name: string; readonly id: number; }
export interface FieldWireType { readonly name: string; readonly id: number; }
export interface StructWireType { readonly common: CommonType; readonly fields: ReadonlyArray<FieldWireType>; }
export interface SliceWireType { readonly common: CommonType; readonly elem: number; }
export interface ArrayWireType { readonly common: CommonType; readonly elem: number; readonly len: number; }
export interface MapWireType { readonly common: CommonType; readonly key: number; readonly elem: number; }
export interface MarshalerWireType { readonly common: CommonType; }

export interface WireType {
  readonly array?: ArrayWireType;
  readonly slice?: SliceWireType;
  readonly struct?: StructWireType;
  readonly map?: MapWireType;
  readonly gobEncoder?: MarshalerWireType;
  readonly binaryMarshaler?: MarshalerWireType;
  readonly textMarshaler?: MarshalerWireType;
}
```

Handle the empty-`CommonType.Name` collection case (delta=2) explicitly.

### Phase 3 — Decoder (`decoder.ts`)

**Message framing:**

```ts
const byteCount = Number(outerReader.readUInt());
const msgBytes = outerReader.readRaw(byteCount);
const msgReader = new GobReader(msgBytes);
const typeId = msgReader.readInt();
// typeId < 0 → type definition; typeId > 0 → value
```

Using a scoped `GobReader` on the message slice gives us bounds-checking for free (reads past the end throw `EndOfStreamError`, which the decoder wrapper surfaces as `GobDecodeError`).

**Type registry:** `Map<number, WireType | null>` where `null` marks bootstrap types (1–23).

**Value dispatch:** same as pygob/gobdotnet. Bootstrap types unwrap the `0x00` singleton prefix; user types look up the `WireType` and dispatch on variant.

**Struct decoding:**

1. Pre-populate all fields with zero values.
2. Read delta-encoded field numbers: `const delta = Number(reader.readUInt())`.
3. While delta !== 0: `fieldIndex = prevIndex + delta; prevIndex = fieldIndex`.
4. Decode field value by field type ID; advance to next delta.
5. Build `GobObject` or call registered factory.

**Interface decoding** — the hardest part, same landmines as pygob/gobdotnet:

1. `typeName = reader.readString()` — if empty, nil interface → return `null`.
2. Inline type definition loop ends when a **positive** typeId is read (that positive int IS the concrete value's type ID).
3. Read `uint byteCount` wrapper inside the message payload.
4. Decode struct payload of that many bytes.

The deferred-message pattern (Go splits interface encoding across message N and N+1) requires the same substitution pass the C# port implemented. Re-use the same approach.

### Phase 4 — Encoder (`encoder.ts`)

**Type registries:**

- `Map<string, number>` — schema name → type ID.
- `Map<string, number>` — collection signature → type ID, keyed by a canonical string form of the collection structure (e.g., `"slice:2"` for `[]int`, `"map:6:2"` for `map[string]int`).
- `Map<string, { goName: string; schema: Schema }>` — interface concrete-type registry.
- `nextId = FIRST_USER_ID` (65).

**Message emission:** build each message's payload into a `GobWriter`, then prefix `uint length`. This avoids pre-computing the length.

**Struct payload encoding** — standard delta arithmetic with zero-value omission. Same as pygob/gobdotnet.

**Interface fields:** inline type def + deferred concrete value message. Track `topLevelSchemas` vs `inlineSchemas` as two separate sets — interface concrete types must have ONLY an inline type def, never a top-level one, or Go's decoder raises "duplicate type received." This bug cost a full session in the C# port; land it as a test case on day one.

**Zero-value detection:**

- `null` / `undefined` → always zero.
- `false` → zero for `GOB_BOOL`.
- `0n` → zero for `GOB_INT` / `GOB_UINT` / `GOB_DURATION`.
- `0` → zero for `GOB_FLOAT`.
- `""` → zero for `GOB_STRING`.
- `Uint8Array` of length 0 → zero for `GOB_BYTES`.
- `Complex.ZERO.equals(v)` → zero for `GOB_COMPLEX`.
- `[]` (length 0) → zero for `SliceOf` / `ArrayOf`.
- `new Map()` (size 0) → zero for `MapOf`.
- Nested struct → never zero (Go always transmits).

### Phase 5 — Public API + Type Inference

- Implement `encode<T>` / `decode<T>` as thin wrappers over `GobEncoder` / `GobDecoder`.
- Implement `InferSchema<S>` in `infer.ts` (type-level only, no runtime export).
- Implement `GobObject` with its iterator protocol.
- Error classes: `GobError`, `GobDecodeError`, `GobEncodeError`, `EndOfStreamError`.
- Finalize public export surface in `index.ts`.

### Phase 6 — Codecs

- `TimeCodec` in `src/codecs/time.ts` with `kind: 'gob'`.
- `UuidCodec` in `src/codecs/uuid.ts` with `kind: 'binary'`.
- `DEFAULT_CODECS` map in `src/codecs/index.ts`.
- Subpath exports configured in `package.json`.

### Phase 7 — Property Tests & Benchmarks

- `property.test.ts` with `fast-check` arbitraries for each schema shape.
- Minimum 1000 runs per property.
- `bench/index.bench.ts` with `mitata` — scenarios mirror the C# port for cross-language comparison:
  - Scalar encode/decode for `bigint`, `string`.
  - Small struct (`Point`: two int fields).
  - Nested struct (3 levels deep).
  - Slice of 1000 structs.
  - Map of 1000 entries.
  - Mixed round-trip.
- Target: within 2× of `JSON.stringify` / `JSON.parse` on equivalent payloads.

---

## Testing Strategy

Four validation layers, each catching different classes of bugs. Identical structure to the Python and C# ports — the wire format is shared, so the validation approach should be too.

### Layer 1: Go → TS (Decoder Tests)

Parametrize `decoder.test.ts` over every `.gob` file in `tests/testdata/`, asserting against its `.json` sidecar.

```ts
import { test, expect } from 'bun:test';
import { loadTestdata, TESTDATA_NAMES } from './fixtures';
import { decode } from '../src';

for (const name of TESTDATA_NAMES) {
  test(`decodes ${name}`, () => {
    const { gobBytes, expected } = loadTestdata(name);
    const result = decode(gobBytes, { codecs: DEFAULT_CODECS });
    expect(normalize(result)).toEqual(expected);
  });
}
```

`normalize` converts `bigint` to `number` where safe for easier JSON comparison. Full-fidelity tests assert `bigint` directly.

### Layer 2: TS → TS (Round-Trip Tests)

Encode a TS value → decode it → assert equality. Catches asymmetric encoder/decoder bugs but not symmetric ones.

### Layer 3: TS → Go Cross-Validation (GoVerify Tests)

`tests/go_verify/main.go` is **copied** from the Python port. Reads stdin gob → decodes → writes JSON. The TS test harness spawns it as a subprocess and asserts on the JSON output.

```ts
import { test } from 'bun:test';
import { goVerifyAvailable, runGoVerify } from './fixtures';

const describeOrSkip = goVerifyAvailable() ? test : test.skip;

describeOrSkip('go_verify: scalar_int', async () => {
  const bytes = encode(42n);
  const result = await runGoVerify('scalar_int', bytes);
  expect(result.ok).toBe(true);
  expect(result.value).toBe(42);
});
```

Go-absent CI systems skip rather than fail. This is the authoritative proof of wire compatibility.

### Layer 4: Property-Based Tests

`fast-check` fuzzes the core round-trip property across random values for each schema shape. Given the complexity of delta encoding, zero-value omission, and float byte-reversal, property tests catch edge cases example-based tests miss.

```ts
import fc from 'fast-check';
import { test } from 'bun:test';

test('round-trip any Point', () => {
  fc.assert(
    fc.property(fc.bigInt(), fc.bigInt(), (x, y) => {
      const bytes = encode({ X: x, Y: y }, { schema: PointSchema });
      const decoded = decode<Point>(bytes);
      return decoded.X === x && decoded.Y === y;
    }),
    { numRuns: 1000 },
  );
});
```

### Test Coverage Checklist

Same as pygob and gobdotnet, with TS-specific additions:

- [ ] All 8 bootstrap scalar types
- [ ] Boundary values: 0, 127/128, -1, `Number.MAX_SAFE_INTEGER`, `2n ** 63n - 1n`, `-(2n ** 63n)`, `2n ** 64n - 1n`, `NaN`, `Infinity`, `-Infinity`
- [ ] Empty string, empty `Uint8Array`, multi-byte UTF-8 strings
- [ ] All collection types: slice, array, map, nested
- [ ] Empty collections
- [ ] Struct with all field types
- [ ] Nested struct
- [ ] Zero-value field omission
- [ ] Delta encoding with non-sequential field indices
- [ ] Interface fields: concrete struct, primitive, nil
- [ ] `time.Time`: UTC, positive/negative offset, millisecond precision loss
- [ ] `uuid.UUID`: all-zeros, random, compatibility across google/gofrs/satori
- [ ] Type-def idempotency: same schema used twice → one emission
- [ ] Multiple values in a single stream
- [ ] End-of-stream: `decode` throws `EndOfStreamError`; `tryDecode` returns `{ ok: false }`
- [ ] Truncated stream (mid-message, mid-uint, mid-string)
- [ ] Unknown type ID
- [ ] Type mismatch on encode
- [ ] Missing interface registration
- [ ] Missing codec for marshaler type
- [ ] `number` coerces to `bigint` on encode (for integer schemas)
- [ ] Non-integer `number` throws `GobEncodeError` on encode
- [ ] `bigint` outside int64 range on encode for `GOB_INT` → `GobEncodeError`
- [ ] `Map` with non-string keys (`Map<bigint, string>` for `map[int]string`)
- [ ] Property tests: round-trip holds for generated values
- [ ] Go → TS for all testdata/*.gob files
- [ ] TS → Go for all supported test cases (via go_verify)

---

## Lessons Learned from the Python and C# Ports

These are the gotchas that cost the most time in the prior ports. Address them explicitly here.

### 1. Interface Fields Use Two Different Framing Schemes

Interface concrete-type definitions are embedded **inline** in the struct payload — not as separate framed messages. Inline defs end when a **positive** type ID is read (that positive int is the concrete value's type ID, not another type def signal). The concrete value is then wrapped in a `uint byteCount` prefix within the same message — or in a subsequent top-level message (the deferred pattern).

### 2. Empty `CommonType.Name` for Collection Types

Slice, map, and array wire types have empty `CommonType.Name`. Gob omits zero-value fields, so the `Id` field arrives with delta=2 (skipping the absent `Name` at index 0). Silent bug: wrong delta → wrong type IDs.

### 3. Zero-Value Omission Is Not Optional

Pre-populate all struct fields with their zero values before the decode loop. Missed fields show up as `undefined` and break downstream consumers.

### 4. First Field Delta Is 1, Not 0

Field numbering starts at -1, so the first field has delta `0 - (-1) = 1`. Delta=0 is the struct terminator.

### 5. Float Encoding Is Byte-Reversed IEEE 754

The 8 bytes of the float64 representation are reversed before encoding as a uint. Forgetting this produces wrong values for every float except 0.0.

### 6. Top-Level Non-Struct Values Are Singleton-Wrapped

`0x00 encoded_value`. The `0x00` precedes the value.

### 7. User Type IDs Start at 65

Matches Go's stated constant. Byte-level comparison against Go-generated `.gob` files for non-scalar types is unreliable because Go's in-process type registry accumulates IDs across encoders. Use `go_verify` instead.

### 8. Type Definition Idempotency

Track schema names and collection signatures in registries. The same schema used twice emits ONE type def. Duplicates cause "gob: duplicate type received" from Go.

### 9. Collection Type Registry Uses Structural Signature

Two fields of type `[]string` share a type ID. The registry key must include full element/key/value structure.

### 10. Nested Struct Fields Are Unwrapped

No type def, no byte-count prefix — just raw delta-encoded bytes + `0x00` terminator.

### 11. Interface Concrete Value Has an Inner Byte-Count Wrapper

Plus interface concrete types must use ONLY an inline type def — never a top-level one. This was session-long bug hunt in the C# port. Write the test on day one.

### 12. Bool Must Be Checked Before Int

When dispatching on value type, check `boolean` before coercing to `bigint`. In TS: `typeof v === 'boolean'` before `typeof v === 'bigint'`.

### 13. Map Encoding Order Is Non-Deterministic

JS `Map` iterates in insertion order, but Go's iteration is random. Both are valid gob output. Do NOT byte-compare map-containing gob. Decode and compare values structurally.

### 14. Signed vs. Unsigned Int for the Same Wire Width

Gob's `int` (ID 2) and `uint` (ID 3) share wire encoding (zigzag vs raw varint) but not type ID. The schema must track signedness. Crucial because both decode to `bigint` in TS.

### 15. Date Precision Mismatch

JS `Date` is millisecond precision; Go `time.Time` is nanosecond. Sub-millisecond values are lost. Document this on `TimeCodec`. Users who need nanosecond precision register a custom codec.

### 16. `time.Time` Codec Kind Is `"gob"`, Not `"binary"`

`time.Time` implements `encoding.GobEncoder`, not `BinaryMarshaler`. The codec must advertise `kind: 'gob'` so the encoder emits wire-type field index 4 (`GobEncoderT`). Using `'binary'` produces valid-looking bytes that Go rejects. The C# port hit this bug; preempt it here.

### 17. The go_verify Test Harness Is Invaluable

Run Go cross-validation tests frequently, not just at the end. They catch subtle wire-format bugs (byte ordering, framing, delta arithmetic) that TS-only round-trips miss because both encoder and decoder have the same bug.

---

## TypeScript-Specific Design Decisions

### `bigint` as the Default Integer Type

Covered at length in [Type System](#integers-bigint-vs-number). The alternative — heuristic coercion to `number` when "safe" — creates nondeterministic decoded types, which is a worse developer experience than `Number(x)` when narrowing.

### `Uint8Array`, Not `Buffer`

`Buffer` is Node-only. `Uint8Array` works in Node, Bun, Deno, and browsers. `Buffer` instances ARE `Uint8Array` instances (they extend it), so Node users can pass Buffers to `gobts` functions without conversion.

### No `BinaryReader`-equivalent

The analogous Node API is `DataView`. We use it only for fixed-width float conversion. The varint encoding is hand-rolled byte math — same constraint as pygob and gobdotnet, for the same reason (default endianness and lack of gob's variable-length encoding).

### `Map<K, V>` for `map[K]V`

Plain objects (`Record<string, V>`) coerce all keys to strings. Go `map[int]string` round-trips through `Map<bigint, string>` correctly; through `Record<string, string>` it does not. `Map` is TS-native, iterable, and preserves key types.

### No decorators

Decorators (both legacy and stage-3) require specific `tsconfig.json` settings and complicate the build story for consumers. The `Schema` + `InferSchema<S>` approach is decorator-free and works in any TS config. It is also more discoverable — a user reading `new Schema('Point', { X: GOB_INT })` can immediately see what's happening.

### No async API in v1

Matches the C# port's explicit decision. The core encoder/decoder operates on `Uint8Array`. Users who need to stream over WebSockets, fetch, or Node streams write a chunk loop around `decoder.feed()`. Adding `encodeAsync` / `decodeAsync` later is additive and non-breaking.

### ESM only

Dual-publishing ESM + CJS adds build complexity and doubles the test surface. All target runtimes support ESM. CJS consumers can use dynamic `import()`.

### Tree-shakeable codecs

The default time and UUID codecs live at `gobts/codecs/time` and `gobts/codecs/uuid`. Apps that don't need them (scalar-only use, for example) don't pay for them in the bundle.

### Strict TS config

`"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`. This makes the internal code slightly more verbose but catches a class of bugs that have cost time in the other ports (undefined slots, optional property gotchas).

### No runtime schema validation

Unlike Zod, we do not validate that a decoded value matches a claimed schema at runtime. Gob is already type-safe on the wire: the wire type tells us exactly what we're reading. Runtime "does this match Schema X" validation is the caller's responsibility (and Zod's job).

---

## Benchmarks

`bench/index.bench.ts` uses `mitata` to compare against `JSON.stringify` / `JSON.parse` on equivalent payloads. We do NOT claim to match `msgpack-javascript` or `@bufbuild/protobuf`. **Rough target: within 2× of JSON** for equivalent payloads.

Scenarios:

- `Scalar_Int` — encode/decode a single `bigint`.
- `Scalar_String` — encode/decode a 64-char string.
- `Struct_Point` — encode/decode a 2-field struct.
- `Struct_Nested` — 3-level nested struct.
- `Slice_1000_Structs` — `Point[]` of length 1000.
- `Map_1000_Entries` — `Map<string, bigint>` of size 1000.
- `RoundTrip_Mixed` — realistic mixed payload.

Benchmarks run on every release candidate. Results are committed under `bench/results/` for historical tracking. The C# port's benchmarks (collections faster than JSON, scalars within 2×, small-struct encode slower due to dictionary overhead) are a reasonable prior — expect similar shape.

---

## Limitations

- **`interface{}` encoding requires type registration.** For Go→TS decoding, no registration needed (the gob stream is self-describing). For TS→TS or TS→Go encoding of interface fields, call `encoder.register(goName, schema)`.
- **No pointer types.** Go pointers are transparent in gob; gobts does not model them.
- **No channel, function, or unexported fields.** Go's `encoding/gob` rejects these; gobts follows suit.
- **Array length not preserved on decoded values.** Go `[3]int` decodes to `bigint[]` of length 3; the fixed-length annotation is lost (re-encoding with `ArrayOf(elem, 3)` restores wire fidelity).
- **Map ordering.** Go map iteration order is random. Byte-level comparison of map-containing gob streams is unreliable. Decode and compare values structurally.
- **64-bit integers only.** `bigint` values outside `[-(2^63), 2^63 - 1]` (signed) or `[0, 2^64 - 1]` (unsigned) throw `GobEncodeError` on encode. Fail-loud, not silent truncation.
- **`time.Time` precision.** `Date` has millisecond precision; Go stores nanoseconds. Sub-millisecond values are truncated. Register a custom codec for full precision.
- **`time.Time` offset loss.** `Date` has no offset field; only UTC ms is preserved. The TimeCodec always emits the UTC sentinel on encode. For offset fidelity, use a custom codec.
- **Zone name loss.** `Date` cannot preserve Go's IANA zone name. Same fix as offset — custom codec.
- **Schema evolution.** Adding or removing struct fields is safe: unknown fields from Go are ignored; missing fields are filled with zero values. This is a gob protocol guarantee that gobts inherits.
- **Byte-level comparison is limited to scalars.** Go's global type registry accumulates type IDs across a process. Use `go_verify` for non-scalar types.
- **Type inference doesn't validate at runtime.** `InferSchema<S>` gives compile-time types. Runtime validation is Zod's job.

---

## Out of Scope (For Now)

- Async streaming API (`encodeAsync`, `decodeAsync` over `ReadableStream` / Node streams).
- `Temporal` types for time / duration (deferred until Temporal is baseline).
- Go interface types other than `interface{}` (typed interfaces).
- `chan`, `func`, pointer types (not encoded by gob).
- Recursive / self-referential types.
- Versioning / schema evolution beyond gob's native behavior.
- npm package publishing — add later.
- Preserving full IANA zone names for `time.Time` (application concern).
- Runtime schema validation of decoded values (out of scope — Zod does this job).

---

## Cross-Language Design Intent

`gobts` mirrors the Python and C# ports so that the mental model transfers across languages. The goal is that sister libraries use the same names and concepts, with each being idiomatic in its host language.

| Concept | Python (pygob) | C# (gobdotnet) | TypeScript (gobts) |
|---|---|---|---|
| Slice descriptor | `SliceOf(GOB_INT)` | `GobFieldType.SliceOf(GobFieldType.Int)` | `SliceOf(GOB_INT)` |
| Map descriptor | `MapOf(GOB_STRING, GOB_INT)` | `GobFieldType.MapOf(...)` | `MapOf(GOB_STRING, GOB_INT)` |
| Array descriptor | `ArrayOf(GOB_INT, 3)` | `GobFieldType.ArrayOf(..., 3)` | `ArrayOf(GOB_INT, 3)` |
| Unsigned int | `UInt(n)` wrapper | `ulong` native | `bigint` + `GOB_UINT` schema marker |
| Schema | `Schema("Point", X=GOB_INT)` | `new GobSchema("Point", ("X", GobFieldType.Int))` | `new Schema('Point', { X: GOB_INT })` |
| Struct declaration | `@gobstruct("Point")` | `[GobStruct("Point")]` | `new Schema('Point', ...)` + `InferSchema<S>` |
| Semantic type | `SemanticType(...)` | `GobFieldType.SemanticInt<T>(...)` | `SemanticType<T>({ ... })` |

The concept is the same; the idiom is language-native.

---

## Acceptance Criteria

The implementation is complete when:

1. All `tests/testdata/*.gob` files decode to the correct values (per `.json` sidecars).
2. All TS → Go cross-validation tests pass (Go decoder accepts TS encoder output).
3. TS → TS round-trip tests pass for all supported types.
4. Property-based round-trip tests pass at 1000 iterations per shape.
5. Codec tests pass for `TimeCodec` and `UuidCodec` (including compatibility with google/uuid, gofrs/uuid, satori/go.uuid).
6. All error-path tests pass (truncated streams, type mismatches, missing registrations, out-of-range bigint rejection, EOS via `EndOfStreamError`).
7. `InferSchema<S>` produces correct compile-time types for every canonical `Schema` shape.
8. Benchmarks run and complete within 2× of `JSON.stringify` / `JSON.parse` baseline across all scenarios.
9. Zero runtime dependencies.
10. `bunx tsc --noEmit` passes with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` enabled.
11. `bun test` passes on Node 20+, Bun 1.1+, and Deno current.
