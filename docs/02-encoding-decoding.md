---
title: Encoding and Decoding
---

# Encoding and Decoding

`encode(value, options?)` and `decode(bytes, options?)` are one-shot
conveniences that build a fresh encoder or decoder per call. `GobEncoder` and
`GobDecoder` are the stream-oriented forms, and they keep type state across
messages.

## Collections

A top-level slice or map carries no struct schema, so the element type — and for
maps the key type — has to be named explicitly. The same applies to empty
collections, where there is no value to infer from.

:::examples encode-slice

Maps decode to `Map` instances rather than plain objects, because gob map keys
are not necessarily strings.

:::examples encode-map

## Streaming

Reusing one `GobEncoder` across messages is what makes gob cheap for RPC: each
type definition is written once, before the first value that needs it, and never
repeated. `bytes()` drains the accumulated buffer while preserving that type
state; `reset()` clears it to start a fresh stream.

:::examples stream-encode

On the read side a `GobDecoder` yields every value in the buffer. `feed()`
appends more bytes at any time, which is how you drive it from a socket or a
chunked HTTP body.

:::examples stream-decode

`gobts` has no async API. Wrap the decoder in your own chunk loop — the caller
owns whatever stream they put around it, and the library never opens, closes, or
manages one.

## End of stream

`decode()` throws `EndOfStreamError` when the buffer is exhausted; `tryDecode()`
reports it as `{ ok: false }` instead. End of stream is never swallowed
silently, so a partial message cannot be mistaken for a complete one.

:::examples end-of-stream

## Reading untyped structs

Without a registered factory, a struct decodes to a `GobObject`: the Go type
name plus the field names and values that arrived on the wire.

:::examples dynamic-field-access

`GobObject` deliberately does not support bracket access (`obj['X']`). That
would require a `Proxy`, which carries a measurable performance cost and
confuses structured clone.

## Errors

Every error class extends `GobError`, which extends `Error`.

| Class | Raised when |
|---|---|
| `GobDecodeError` | The wire data is malformed or references an unknown type |
| `GobEncodeError` | A value is out of range, or a schema is unsupported |
| `EndOfStreamError` | The buffer ran out mid-value |
| `TypeError` | A decoded value does not match the type asserted in `decode<T>()` |

Note that a `bigint` outside `[-(2^63), 2^63 - 1]` raises `GobEncodeError`
rather than truncating silently.
