---
title: Schemas and Types
---

# Schemas and Types

A `Schema` describes the shape of a Go type to the encoder. Schemas are required
for encoding structs and are never needed for decoding — a gob stream carries
its own type definitions.

:::examples define-schema

## Field types

Field descriptors are a discriminated union, `GobFieldType`. Primitives are
exported as constants; composites come from factory functions.

| Descriptor | Go type |
|---|---|
| `GOB_BOOL` | `bool` |
| `GOB_INT` | `int`, `int8` … `int64` |
| `GOB_UINT` | `uint`, `uint8` … `uint64` |
| `GOB_FLOAT` | `float32`, `float64` |
| `GOB_BYTES` | `[]byte` |
| `GOB_STRING` | `string` |
| `GOB_COMPLEX` | `complex64`, `complex128` |
| `GOB_INTERFACE` | `interface{}` / `any` |
| `GOB_DURATION` | `time.Duration` |
| `SliceOf(elem)` | `[]T` |
| `MapOf(key, elem)` | `map[K]V` |
| `ArrayOf(elem, n)` | `[N]T` |
| `Marshaler(name, kind)` | a `GobEncoder` / `BinaryMarshaler` / `TextMarshaler` type |
| `SemanticType({...})` | a named Go type over a wire primitive |

## Nested structs

A `Schema` is itself a valid field type, so structs nest directly with no
wrapper. On the wire a nested struct field is unwrapped — raw delta-encoded
bytes with no type definition and no byte-count prefix of its own.

:::examples nested-struct

## Deriving TypeScript types

`InferSchema<S>` computes the plain-object type for a schema. It is purely
type-level and emits no runtime code, so there is no cost to using it.

:::examples schema-type-inference

There are no decorators and no runtime validation of decoded values against a
schema. Gob is already type-safe on the wire; validating shapes on top of it is
a job for a validation library.

## Named Go types

`SemanticType` maps a named Go type — `type Status string` — onto a TypeScript
type, converting as it encodes.

:::examples semantic-type

The conversion is **encode-side only**. The decoder has no schema to infer the
semantic type from, so it hands back the underlying wire primitive (`bigint`,
`number`, `string`, …). Apply your own conversion after decoding.
