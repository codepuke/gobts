# Benchmark Baseline — 2026-04-18

**Machine:** AMD Ryzen 9 5950X 16-Core, ~3.82 GHz  
**Runtime:** Bun 1.3.10 (x64-linux)  
**Command:** `bun bench/index.bench.ts`

## Results

| Scenario | gob | JSON equiv | Ratio |
|----------|-----|------------|-------|
| encode bigint 42n | 2.81 µs | 34 ns (number) | ~83× |
| encode string "hello, world!" | 2.88 µs | 43 ns | ~67× |
| decode bigint | 3.02 µs | 30 ns | ~100× |
| decode string | 2.09 µs | 59 ns | ~35× |
| encode Point (cold) | 7.20 µs | 60 ns | ~120× |
| encode Point (warm, no type def) | 2.53 µs | 62 ns | ~40× |
| decode Point | 6.66 µs | 83 ns | ~80× |
| encode Person (cold) | 9.18 µs | 107 ns | ~86× |
| encode Person (warm, no type def) | 3.62 µs | 108 ns | ~33× |
| decode Person | 7.49 µs | 179 ns | ~42× |
| encode []int (1000) | 262 µs | 9.4 µs | ~28× |
| decode []int (1000) | 103 µs | 17.8 µs | ~6× |
| encode 1000 Points (struct slice) | 766 µs | 44 µs | ~17× |
| decode 1000 Points | 318 µs | 75 µs | ~4× |
| round-trip Person (encode+decode) | 18.0 µs | 0.33 µs | ~54× |

## Performance Analysis

The 2× target vs JSON.stringify/parse is **not met** in any scenario. Root causes:

### 1. Object allocation overhead (dominant for small payloads)
Every `encode()` or `decode()` call allocates:
- `GobEncoder`: 1 `GobWriter`, 4 `Map`, 2 `Set` objects
- `GobDecoder`: 2 `Map`, 1 `Uint8Array` copy
- `GobWriter`: geometric-growth buffer (initial `Uint8Array` allocation)

JSON.stringify/parse are V8 built-ins with zero TypeScript allocation overhead.

### 2. JavaScript BigInt arithmetic
Gob encodes integers as bigint (zigzag + varint). BigInt operations in V8 are 3–10× slower
than native 64-bit integer operations. All struct field values go through BigInt paths.

### 3. Map lookups per message
The type registry lookup (Map.get/set) dominates for small structs. A GobDecoder with a
pre-warmed type registry would save ~1µs per decode call.

### 4. No V8 fast paths
JSON.stringify/parse have dedicated V8 builtins (Torque-compiled) that bypass the JS
engine entirely. A TypeScript codec cannot compete on single-operation latency.

## When gobts is competitive

For large payloads (decode 1000 Points: 4× slower than JSON), the per-item overhead is
amortized. The decode-1000-Points ratio of 4× is within the documented acceptable range
for struct-heavy scenarios (PRD: "struct-only scenarios may exceed — document why").

### Warm encoder throughput
For streaming use (one `GobEncoder` reused across many messages), the per-message cost
for Point is 2.53 µs (warm). For a 10 MB/s channel at ~30 bytes/message, this is
~300k messages/s — adequate for most RPC use cases.

## Comparison with sister libraries
The C# port (gobdotnet) documented similar overhead vs Newtonsoft.Json for small objects.
The Python port (pygob) benchmarks are even slower due to CPython's overhead. gobts is
in the same ballpark as gobdotnet (~10–100× slower than stdlib JSON on small payloads,
~4–10× on large).

## Future optimization opportunities (not in scope for v1)
1. Lazy type-registry bootstrap (avoid pre-populating 15 Map entries per decoder)
2. Object pooling for GobWriter / GobDecoder (reuse across calls)
3. WASM or native addon for the varint loop (not zero-dependency)
4. Skip Map for schemas with only primitive fields (inline the dispatch)
