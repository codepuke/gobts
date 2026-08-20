---
title: Limitations and Performance
---

# Limitations and Performance

## Limitations

- **Integers are `bigint`.** Convert with `Number(x)` when you know a value is
  at or below `Number.MAX_SAFE_INTEGER`. Values outside
  `[-(2^63), 2^63 - 1]` raise `GobEncodeError` rather than truncating.
- **`time.Time` loses offset and sub-millisecond precision.** Register a custom
  codec for nanosecond or offset fidelity.
- **Encoding `interface{}` requires type registration.** Decoding never does —
  the stream is self-describing.
- **`SemanticType` converts on encode only.** The decoder returns the underlying
  wire primitive; convert after decoding.
- **Array length is not preserved.** `[3]int` decodes to a `bigint[]` of length
  3; re-encode with `ArrayOf(GOB_INT, 3)` to restore wire fidelity.
- **Map ordering is non-deterministic**, so byte-level comparison of
  map-containing streams is unreliable. Compare decoded values.
- **No recursive types.** Self-referential structs are not supported.
- **No async API.** Drive `decoder.feed()` from your own chunk loop for
  WebSocket or Node stream sources.

## Performance

`gobts` is not a high-performance serializer, and it does not try to compete
with `msgpack-javascript` or `@bufbuild/protobuf`. The target is to stay within
a small constant factor of `JSON.stringify`/`JSON.parse` for equivalent
payloads. Measured on an AMD Ryzen 9 5950X under Bun 1.3.10:

| Scenario | gobts | JSON equivalent | Ratio |
|----------|-------|-----------------|-------|
| encode `42n` | 2.81 µs | 34 ns | ~83× |
| encode `"hello, world!"` | 2.88 µs | 43 ns | ~67× |
| decode bigint | 3.02 µs | 30 ns | ~100× |
| encode Point (cold) | 7.20 µs | 60 ns | ~120× |
| encode Point (warm encoder) | 2.53 µs | 62 ns | ~40× |
| decode Point | 6.66 µs | 83 ns | ~80× |
| decode `[]int` (1000 elements) | 103 µs | 17.8 µs | ~6× |
| decode 1000 Points | 318 µs | 75 µs | ~4× |

The shape of that gap — worst on tiny payloads, converging on larger ones — is
consistent across the Python and C# ports, and follows from V8's built-in JSON
routines versus per-object allocation in TypeScript, `bigint` arithmetic, and
`Map` lookups. At 1000 Points the overhead is roughly 4×, which is workable for
typical RPC payloads.

The practical lever is encoder reuse: keeping one `GobEncoder` for a stream
emits each type definition once and brings a Point message down to about
2.5 µs.
