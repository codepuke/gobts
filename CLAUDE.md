# CLAUDE.md

Guidance for Claude Code when working on `gobts`. Read this before making changes.

## Session startup protocol

1. **Read `PROGRESS.md` first.** It tracks which phase is active, what's done, and what the next session should start with. Work sessions may be interrupted by quota limits or handoffs — the progress file is how continuity is maintained.
2. Skim `PRD.md` sections relevant to the current phase.
3. Before ending a session, update `PROGRESS.md`:
   - Update "Current state" at the top.
   - Check off completed acceptance items in the active phase.
   - Append a session handoff entry at the bottom.
   - If you discovered work that doesn't fit a phase, log it under "Discovered work".

Do not skip ahead of the current phase. Each phase depends on the previous one being solid. If Phase 1 codec tests aren't passing, don't start Phase 2 wire types.

## Project

Pure TypeScript port of Go's `encoding/gob` binary serialization format.

Sister library to `pygob` (Python) and `gobdotnet` (C#). These may be viewed at ../pygob and ../gobdotnet.

The Full PRD lives in `PRD.md` — read it before making architectural decisions.

- **Runtimes:** Node 20+, Bun 1.1+, modern browsers. Deno should work via npm specifiers.
- **Language:** TypeScript 5.4+ with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- **Package manager / runner:** Bun is primary. `npm` / `pnpm` should still work for consumers.
- **Test runner:** `bun test` (Jest-compatible API). `fast-check` for property tests. Go cross-validation via subprocess, skipped when Go is not on `PATH`.
- **Bench:** `mitata`.
- **Wire format version:** Go 1.22. New wire types (rare) go in minor versions.
- **Performance target:** within 2× of `JSON.stringify` / `JSON.parse`. We do NOT compete with `msgpack-javascript` or `@bufbuild/protobuf`.

## Project layout

```
src/
├── index.ts            # Public re-exports
├── codec.ts            # GobReader / GobWriter on Uint8Array
├── wire.ts             # Bootstrap type IDs, WireType structures, decoder
├── types.ts            # Schema, GobObject, GobFieldType, SliceOf/MapOf/ArrayOf, GOB_*
├── infer.ts            # InferSchema<S> — type-level only, no runtime
├── encoder.ts          # GobEncoder
├── decoder.ts          # GobDecoder
├── errors.ts           # GobError / GobDecodeError / GobEncodeError / EndOfStreamError
└── codecs/
    ├── index.ts        # DEFAULT_CODECS
    ├── time.ts         # Date ↔ time.Time
    └── uuid.ts         # string (canonical hyphenated) ↔ uuid.UUID

tests/
├── testdata/           # .gob + .json sidecars — copied from pygob, evolves here
├── go_verify/main.go   # Copied from pygob, evolves here
├── generate_testdata.go # Copied from pygob, evolves here
├── fixtures.ts         # Testdata loader, go_verify subprocess helper
├── *.test.ts           # Test files

bench/
└── index.bench.ts      # mitata vs JSON.stringify/parse

examples/               # Doc examples — snippet regions published to codepuke
└── *.test.ts           # Run by `bun test`; see "Documentation snippets"

docs/                   # Numbered docs pages published to codepuke
└── NN-*.md             # Nav order is filename order; NN- is stripped from the slug

PRD.md                  # Design doc — authoritative
PROGRESS.md             # Phase tracker — read and update every session
CLAUDE.md               # This file
```

The `testdata/`, `go_verify/`, and `generate_testdata.go` files were copied from `pygob` at project start and evolve independently here. Do not try to sync them back.

## Core design rules

These are non-negotiable. If a change seems to require violating one, stop and ask.

- **Wire fidelity is the top priority.** Any byte stream Go's encoder produces must decode correctly; any byte stream we produce must decode in Go. If a round-trip test passes but `go_verify` fails, the bug is ours.
- **`bigint` is the default for 64-bit ints.** Never silently coerce `int64` to `number` — it loses precision above `2^53 - 1`. The user converts with `Number(x)` when they know it's safe.
- **`Uint8Array` is the canonical byte type.** Not `Buffer`, not `ArrayBuffer`. Buffers from Node consumers ARE `Uint8Array` instances and flow through unchanged.
- **Caller owns any streams they wrap around us.** `GobEncoder` and `GobDecoder` expose a buffer-based API (`feed()`, `bytes()`). We do not open, close, or manage external streams.
- **`EndOfStreamError` for EOS.** `decode()` throws; `tryDecode()` returns `{ ok: false }`. Never swallow EOS silently.
- **No external runtime dependencies.** Browser/Node/Bun built-ins only (`Uint8Array`, `DataView`, `TextEncoder`, `TextDecoder`, `Map`, `Set`, `Symbol`, `bigint`). Dev deps are fine.
- **No `DataView` for variable-length ints.** Use it only for the fixed-width float64 → Uint8Array conversion. The uint encoding is hand-rolled byte math.
- **Schema + `InferSchema<S>` is the primary path for types.** No decorators. No runtime validation of values against schemas — that's Zod's job.
- **ESM only.** `package.json` has `"type": "module"` and an `exports` map. No CJS build.

## Gob wire format landmines

Bugs here are silent and expensive. Every change that touches encoding or decoding needs to keep these in mind:

- **First field delta is 1, not 0.** Field indices start at -1. Delta=0 is the struct terminator.
- **Collection types have empty `CommonType.Name`.** Field `Id` arrives with delta=2 (skipping the omitted `Name`).
- **Zero-valued fields are omitted on the wire** and pre-populated with zero values on decode.
- **Floats are byte-reversed IEEE 754** then encoded as unsigned int. This is for trailing-zero compression.
- **Top-level non-struct values are singleton-wrapped:** `0x00 value`. The `0x00` precedes the value.
- **User type IDs start at 65.** Go's pre-decrement allocates the first type as 64; we match Go's stated constant for determinism.
- **Interface inline type defs end on a positive type ID**, not EOF and not `0x00`. The positive int IS the concrete value's type ID.
- **Interface concrete values have an inner `uint N` byte-count wrapper** inside the message payload. Different from top-level struct framing.
- **Interface concrete types must have ONLY an inline type def**, never a top-level one. Go's decoder raises "duplicate type received" otherwise. This bug cost a full session in the C# port — land the test case on day one.
- **Nested struct fields are unwrapped** — no type-def, no byte-count prefix, just raw delta-encoded bytes + `0x00`.
- **`BinaryMarshaler` type names on the wire are unqualified** (`"Time"`, `"UUID"`) — from Go's `reflect.Type.Name()`. This is distinct from `interface{}` concrete-type registration, which uses qualified names (`"main.Point"`).
- **`time.Time` is a `GobEncoder`, NOT a `BinaryMarshaler`.** The `TimeCodec` must advertise `kind: 'gob'` — wire-type field index 4 (`GobEncoderT`). Using `'binary'` produces bytes Go rejects. The C# port hit this; preempt it here.
- **Go map iteration is non-deterministic.** Never byte-compare map-containing gob output. Compare decoded values structurally.

When in doubt, re-read the "Lessons Learned" section of `PRD.md`.

## Code conventions

- Strict TS config, no exceptions: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Prefer `readonly` on all internal data structures. Interfaces over classes when a plain shape is enough.
- Use `interface` for wire-type records (cheaper than class; TS-native).
- Use `class` for things with meaningful identity / methods: `Schema`, `GobObject`, `Complex`, `GobEncoded`, `GobReader`, `GobWriter`, `GobEncoder`, `GobDecoder`, error classes.
- Prefer named exports. No default exports.
- `bigint` literals use the `n` suffix: `0n`, `65n`. Document any place where a `number` cast to `bigint` is intentional.
- `for...of` over `forEach`. `Map.entries()` over `Object.entries()` for non-string keys.
- Avoid `Proxy`. It's slow and confuses structured clone.
- `Uint8Array` slices via `.subarray(start, end)` for zero-copy views; use `.slice()` only when ownership must not be shared.
- `TextEncoder` / `TextDecoder` for UTF-8. Construct once and cache per encoder/decoder instance.
- Discriminated unions for `GobFieldType` variants. Each variant has a `readonly kind` string literal.
- Exceptions: `GobDecodeError` / `GobEncodeError` for format errors; `EndOfStreamError` for EOS; `TypeError` for type mismatches in `decode<T>()` (matches JS convention); `GobEncodeError` at schema construction for unsupported types.
- Use `// @ts-expect-error` only with a comment explaining why. Never `// @ts-ignore`.

## Testing workflow

Four layers, in order of authority:

1. **Go → TS decoder tests** — parametrized over `testdata/*.gob` with JSON sidecar expectations.
2. **TS → TS round-trip tests** — catches asymmetric bugs.
3. **TS → Go `go_verify` cross-validation** — authoritative proof of wire compatibility. Skipped (not failed) when Go isn't on `PATH`.
4. **Property-based tests** via `fast-check` — catches edge cases example-based tests miss.

```bash
bun test                                # run everything
bun test tests/decoder.test.ts          # one file
bun test --reporter=verbose             # verbose
bunx tsc --noEmit                       # type-check only
bun bench/index.bench.ts                # run benchmarks
go run tests/generate_testdata.go       # regenerate fixtures
echo "" | go run ./tests/go_verify struct_simple   # manual verifier check
```

Run `go_verify` tests early and often during encoder work. They catch symmetric bugs that TS-only round-trips will happily pass.

## Documentation snippets

`examples/*.test.ts` and `docs/*.md` are a published contract with the
`codepuke` site, not private scratch files. The contract is
`../codepuke/SYNCING.md`; `cmd/sync` runs there, never here.

- Code between `// snippet:start <topic>` and `// snippet:end` is extracted and
  rendered on the docs site. The marker must be the only thing on its line —
  never write the marker tokens in prose, or the sync will try to parse them.
- Keep imports and assertions **outside** the region. The extracted snippet is
  dedented and trimmed, so a region inside a test body yields clean top-level
  code with no test scaffolding and no `../src/index.ts` import path leaking
  into the docs.
- A topic id is `[a-z0-9][a-z0-9-]*`, appears at most once per file, and at most
  once per language across all repos. The site renders every language's variant
  of a topic in one tabbed block, so the `pygob`, `gobdotnet`, and `gobspect`
  variants must use the same id **and the same fixture data** — see the topic
  table in `PROGRESS.md` → "Discovered work".
- Snippets must come from code the test suite executes. Never move a marked
  region without checking what references it; renaming a topic changes the site.
- Every topic needs a `:::examples <topic>` reference in some `docs/` page,
  otherwise it is extracted but never rendered.
- Anything malformed fails the sync loudly. Before finishing, check that
  `snippet:start` and `snippet:end` counts match and that the defined topic set
  equals the set referenced from `docs/`.

## When making changes

- **New feature or wire-format behavior:** update `PRD.md` in the same PR. The PRD is the source of truth.
- **Bug fix in the encoder or decoder:** add a regression test under the appropriate layer AND a `go_verify` test if the bug affects cross-language output.
- **Public API additions:** update the `exports` map in `package.json` if the feature needs a new subpath. Update `src/index.ts` for root-level exports.
- **Performance work:** run benchmarks before and after. Commit results under `bench/results/`.
- **Type-level changes to `InferSchema<S>`:** add compile-time assertion tests (`type _ = Expect<Equal<...>>`). These are free — they run at typecheck time, not runtime.
- **Snippet or docs changes:** keep `examples/` and `docs/` in sync — every topic defined must be referenced, and every topic referenced must be defined.
- **Any substantive session:** update `PROGRESS.md` before finishing.

## What NOT to do

- Don't silently coerce `bigint` to `number`. If a conversion is needed and the value is unsafe, throw.
- Don't introduce a `Buffer` dependency. Use `Uint8Array`.
- Don't add `BigInt64Array` / `BigUint64Array` as a public type. They're too limiting (no `bigint` heterogeneity) and surprise users.
- Don't change type ID assignment strategy — byte-level test stability depends on starting at 65.
- Don't use `DataView` for varint encoding. Hand-rolled byte math.
- Don't accept a "round-trip passes in TS" as sufficient evidence — always verify with `go_verify` for encoder changes.
- Don't add async APIs (`encodeAsync`, `decodeAsync`) — explicitly out of scope for v1. If you think the library needs them, open an issue first.
- Don't add stage-3 decorators (`@gobStruct`). The `Schema` + `InferSchema<S>` design is the decision. Changing it is a v2 conversation.
- Don't add runtime schema validation of decoded values. That's Zod's job. Gob is already type-safe on the wire.
- Don't quietly "fix" observed wire-format quirks. If the Go source does it, we do it — that's the point.
- Don't skip phases in `PROGRESS.md`. If you think a phase needs reordering, surface the choice rather than silently rearranging.

## References

- `PRD.md` — authoritative design doc.
- `PROGRESS.md` — phase tracker, updated every session.
- `encoding/gob` in the Go source tree — ultimate source of truth for wire format.
- `pygob` repo — Python sister library.
- `gobdotnet` repo — C# sister library, the second and more recent port. Its `PROGRESS.md` session notes are a useful reference for bug classes to watch for.
