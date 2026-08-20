---
title: Overview
---

# gobts

`gobts` is a pure TypeScript port of Go's `encoding/gob` binary serialization
format. Any byte stream Go's encoder produces decodes here, and any stream
`gobts` produces decodes in Go.

It has no runtime dependencies — only platform built-ins (`Uint8Array`,
`DataView`, `TextEncoder`/`TextDecoder`, `Map`, `bigint`) — and runs on Node 20+,
Bun 1.1+, Deno via npm specifiers, and modern browsers. It is ESM only.

## Installation

```sh
bun add gobts
# or: npm install gobts
```

## Encoding a value

A schema describes a Go struct to the encoder. Encoding a struct needs one;
decoding never does, because gob streams are self-describing.

:::examples encode-struct

Go's `int` is 64 bits wide, so `gobts` represents every gob integer as a
`bigint`. It never silently narrows to `number` — that would lose precision
above `Number.MAX_SAFE_INTEGER`. Convert with `Number(x)` when you know a value
is in range.

## Decoding a value

:::examples decode-struct

A struct with no registered factory decodes to a `GobObject`, which exposes the
field names carried on the wire.

## Type mapping

| Go type | TypeScript type | Notes |
|---------|-----------------|-------|
| `int` / `int64` | `bigint` | All integer sizes decode to `bigint` |
| `uint` / `uint64` | `bigint` | Sign is tracked by the schema, not the value type |
| `bool` | `boolean` | |
| `float64` | `number` | |
| `float32` | `number` | Encoded as float64 on the wire |
| `complex128` | `Complex` | `{ re: number, im: number }` |
| `string` | `string` | UTF-8 |
| `[]byte` | `Uint8Array` | |
| `[]T` | `T[]` | |
| `[N]T` | `T[]` | Fixed-length information is lost on decode |
| `map[K]V` | `Map<K, V>` | Preserves non-string key types |
| `struct` | `GobObject` | Or a typed plain object with a registered factory |
| `interface{}` | `unknown` | Concrete value is embedded in the stream |
| `time.Time` | `Date` | With `DEFAULT_CODECS`; millisecond precision, UTC only |
| `uuid.UUID` | `string` | Canonical hyphenated lowercase |
| `time.Duration` | `bigint` | Nanoseconds, via `GOB_DURATION` |

## Sister libraries

The same mental model — `Schema`, `SliceOf`, `MapOf`, `GOB_INT` — carries across
every port, with each spelling it idiomatically for its host language.

| Language | Library |
|----------|---------|
| Go | `encoding/gob` (standard library) |
| Python | `pygob` |
| C# | `gobdotnet` |
| TypeScript | **gobts** |
