---
title: Codecs
---

# Codecs

Go types that implement `GobEncoder`, `BinaryMarshaler`, or `TextMarshaler`
appear on the wire as opaque bytes tagged with a type name. A codec is the
translation between those bytes and a native TypeScript value.

Without a codec, such a value decodes to a `GobEncoded` — the type name and the
raw bytes, undisturbed.

Codecs ship as separate entry points so applications that only move scalars
never pull them in:

```ts
import { DEFAULT_CODECS } from 'gobts/codecs';
import { TimeCodec } from 'gobts/codecs/time';
import { UuidCodec } from 'gobts/codecs/uuid';
```

`DEFAULT_CODECS` is `{ Time: TimeCodec, UUID: UuidCodec }`.

## Type names on the wire are unqualified

Codecs are keyed by the **unqualified** Go type name — `"Time"`, `"UUID"` — the
name `reflect.Type.Name()` returns. This is distinct from `interface{}` concrete
type registration, which uses the package-qualified name (`"main.Point"`). Using
the wrong one is a silent mismatch, not an error.

## time.Time

`time.Time` implements `GobEncoder`, **not** `BinaryMarshaler`. Its codec must
advertise `kind: 'gob'` so the encoder emits wire-type field index 4
(`GobEncoderT`); declaring it as `'binary'` produces a stream Go rejects.

:::examples time-values

`Date` stores UTC milliseconds and nothing else, so three things are lost in
both directions: sub-millisecond precision, the timezone offset, and the IANA
zone name. Encoded values always carry the UTC sentinel. Register a custom codec
if you need nanosecond or offset fidelity.

## uuid.UUID

`uuid.UUID` is a `BinaryMarshaler` — 16 raw bytes. It decodes to the canonical
hyphenated lowercase string, matching what `crypto.randomUUID()` produces, which
keeps it JSON-friendly and directly comparable.

:::examples uuid-values

## Writing your own

A `Codec<T>` declares its kind and converts in both directions. Register it on
the encoder, the decoder, or both, under the Go type's unqualified name.

:::examples custom-marshaler
