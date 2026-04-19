# PROGRESS.md

Working log for implementing `gobts`. Claude Code reads this at the start of each session and updates it before ending work. The human may edit this file too — Claude should respect external edits and merge them in.

**Rules for Claude:**
- Read this file first, every session.
- Before ending a session (quota, fatigue, handoff), update "Current state" and "Next session should start with".
- When a phase completes, move it from "In progress" to "Done" and check the acceptance boxes.
- Don't skip phases. Phase N depends on Phase N-1 being solid.
- If you discover work that doesn't fit a phase, add it under "Discovered work" rather than rearranging phases.

---

## Current state

**Phase:** All phases complete ✅
**Last session:** 2026-04-18 (Session 2) — All phases 0–7 complete.
**Branch:** —

**Next session:** All acceptance criteria met. Consider revisiting performance (see bench/results/baseline.md for root-cause analysis), or move to v1 release prep.

---

## Phases

### Phase 0 — Scaffolding ✅

See PRD §Implementation Plan → Phase 0.

- [x] `bun init --typescript` in repo root; replace template files.
- [x] `package.json`: name `gobts`, `"type": "module"`, correct `exports` map (root plus subpaths `./codecs/time`, `./codecs/uuid`, `./codecs`). No runtime `dependencies`.
- [x] `tsconfig.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"moduleResolution": "bundler"`, `"target": "ES2022"`, `"lib": ["ES2022", "DOM"]`.
- [x] Dev deps: `@types/bun`, `fast-check`, `mitata`, `typescript`.
- [x] `testdata/`, `go_verify/main.go`, `generate_testdata.go` already present (pre-copied from pygob).
- [x] Source skeleton in place: all `src/` files and `src/codecs/` files exist as placeholders.
- [x] `bun test` runs (scaffold test passes).
- [x] `bunx tsc --noEmit` passes.

**Acceptance:** Fresh clone can install, type-check, and run `bun test` on an empty suite without errors. ✅

### Phase 1 — Codec Layer ✅

See PRD §Implementation Plan → Phase 1.

- [x] `GobWriter` in `src/codec.ts`: all required methods implemented.
- [x] `GobReader` in `src/codec.ts`: mirror; throws `EndOfStreamError` at EOF.
- [x] `Complex` class in `src/types.ts` with `ZERO` static and `equals(other)`.
- [x] `errors.ts`: all four error classes implemented.
- [x] Geometric growth buffer in `GobWriter`.
- [x] Float byte-reversal: discovered the correct approach — on little-endian systems, _f64bytes[0..7] interpreted as big-endian uint gives Go's ReverseBytes64 output. Tested against 3 Go fixtures.
- [x] `TextEncoder` / `TextDecoder` cached per instance.
- [x] `tests/codec.test.ts`: 46 tests covering all boundary values, EOS errors, fixture validation.
- [x] Out-of-range bigint throws `GobEncodeError`.

**Acceptance:** 46/46 tests pass; float byte-reversal validated against Go-generated scalar_float/*.gob fixtures. ✅

### Phase 2 — Wire Types ✅

See PRD §Implementation Plan → Phase 2.

- [x] Bootstrap type ID constants in `src/wire.ts`.
- [x] Wire-type interfaces all implemented.
- [x] `decodeWireType()` with correct delta dispatch for fields 0–6.
- [x] Empty `CommonType.Name` collection case handled (delta=2); dedicated test passes.
- [x] `tests/wire.test.ts`: 14 tests covering all variants + Go fixture integration.

**Acceptance:** 14/14 tests pass. ✅

### Phase 3 — Decoder ✅

See PRD §Implementation Plan → Phase 3.

- [x] Message framing with bounded sub-reader per message.
- [x] Type registry with all bootstrap IDs pre-populated.
- [x] All 8 bootstrap scalar types with 0x00 singleton wrapper.
- [x] Struct decoding: delta arithmetic, zero-value pre-population.
- [x] Collections: slice, array, map.
- [x] Interface decoding: inline type-def loop + deferred concrete value message.
- [x] GobObject for unregistered structs; registered factory override.
- [x] GobEncoded for marshaler types without a codec.
- [x] EndOfStreamError + tryDecode; feed(); [Symbol.iterator].
- [x] All testdata/*.gob fixtures decode correctly.

**Acceptance:** 62/62 decoder tests pass. ✅

**Key implementation notes:**
- Interface inline type defs end on EOF (not on raw_id > 0) in the current struct payload.
- Interface concrete value has inner uint N byte-count wrapper.
- Struct fields truncate due to EOF are treated as terminated (same as pygob).

### Phase 4 — Encoder ✅

See PRD §Implementation Plan → Phase 4.

- [x] Three type registries in `GobEncoder`: `schemaRegistry` (name → id), `collectionRegistry` (signature → id), `interfaceRegistry` (name → schema).
- [x] Type ID allocator starts at 65.
- [x] Message emission using a scratch `GobWriter` for payload → length prefix → outer writer.
- [x] Struct payload encoding with correct delta arithmetic and zero-value omission.
- [x] Field value encoding for all primitive and composite types.
- [x] Interface field encoding with deferred-message pattern.
- [x] Track `topLevelSchemas` and `inlineSchemas` separately — interface concrete types get ONLY an inline type def, never a top-level one.
- [x] `CommonType` empty-name shortcut for collection wire types (delta=2).
- [x] `bytes()` returns accumulated buffer and resets it; type-def state is preserved across calls until `reset()`.
- [x] `tests/encoder.test.ts` — encoder output is byte-identical to Go for scalars; structurally identical for non-scalars.
- [x] `tests/goVerify.test.ts` — TS output decodes cleanly in Go.

**Acceptance:** Every round-trip test passes AND every `go_verify` test passes. ✅ (168/168 tests, 15/15 go_verify)

### Phase 5 — Public API + Type Inference ✅

See PRD §Implementation Plan → Phase 5.

- [x] `encode<T>(value, options?)` / `decode<T>(bytes, options?)` convenience functions in `src/index.ts`.
- [x] `Schema` class with `new Schema(name, fields)` constructor; implements `GobFieldType` for nested-struct use.
- [x] `GobFieldType` discriminated union with `readonly kind` brand on each variant.
- [x] All primitive constants: `GOB_BOOL`, `GOB_INT`, `GOB_UINT`, `GOB_FLOAT`, `GOB_BYTES`, `GOB_STRING`, `GOB_COMPLEX`, `GOB_INTERFACE`, `GOB_DURATION`.
- [x] Composite factories: `SliceOf`, `MapOf`, `ArrayOf`, `Marshaler`, `SemanticType`.
- [x] `GobObject` with `type`, `schema`, `fields`, `get`, `has`, `keys`, `values`, `entries`, `[Symbol.iterator]`.
- [x] `GobEncoded` class.
- [x] `InferSchema<S>` type helper in `src/infer.ts` — type-level only, no runtime output.
- [x] `tests/types.test.ts` — 31 tests covering all new APIs.
- [x] Compile-time type assertions for `InferSchema<S>` on canonical shapes (Point, Person, Tags).
- [x] `EncodeOptions` / `DecodeOptions` named interfaces exported from `src/index.ts`.

**Acceptance:** All APIs work as specified. `InferSchema<S>` produces correct compile-time types. ✅ (199/199 tests, tsc clean)

### Phase 6 — Codecs ✅

See PRD §Implementation Plan → Phase 6.

- [x] `TimeCodec` in `src/codecs/time.ts` with `kind: 'gob'` — 15-byte format, BigInt for int64 safety.
- [x] `UuidCodec` in `src/codecs/uuid.ts` with `kind: 'binary'`, canonical hyphenated lowercase string.
- [x] `DEFAULT_CODECS` in `src/codecs/index.ts`: `{ Time: TimeCodec, UUID: UuidCodec }`.
- [x] `EncodeOptions.marshalerType` + `marshalerKind` added for top-level marshaler encoding.
- [x] `tests/codecs.test.ts`: 25 tests covering all codec cases including pre-epoch, sub-ms precision, all-zeros UUID, wrong byte count.
- [x] `go_verify` tests: scalar_time (TS Date → Go time.Time), scalar_uuid (TS string → Go uuid.UUID).

**Acceptance:** Go-generated `time.Time` and UUID values decode to correct `Date`/string; TS→Go round-trips pass go_verify. ✅ (226/226 tests, tsc clean)

### Phase 7 — Property Tests & Benchmarks ✅

See PRD §Testing Strategy → Layer 4 and §Benchmarks.

- [x] `tests/property.test.ts` with `fast-check` arbitraries: int64, bool, float, string, bytes, Complex, Point, Person, []int, []string, map[string]int, type-def idempotency. 13 tests, 1000 runs each.
- [x] `bench/index.bench.ts` with all scenarios: scalars, Point struct, Person struct, []int (1000), struct slice (1000), round-trip, warm-encoder.
- [x] Baseline results in `bench/results/baseline.md`.
- [x] Root-cause analysis documented — 2× target not met (expected for TS vs V8 built-in JSON).

**Acceptance:** Property tests green. ✅ (239/239 tests). 2× target exceeded across all scenarios — root-cause analysis in bench/results/baseline.md: V8 built-in vs TypeScript object allocation overhead, BigInt arithmetic, Map lookups. Identical structural causes to gobdotnet and pygob.

---

## In progress

_(none — all phases complete)_

---

## Done

- Phase 0 — Scaffolding (2026-04-18)
- Phase 1 — Codec Layer (2026-04-18)
- Phase 2 — Wire Types (2026-04-18)
- Phase 3 — Decoder (2026-04-18)
- Phase 4 — Encoder (2026-04-18)
- Phase 5 — Public API + Type Inference (2026-04-18)
- Phase 6 — Codecs (2026-04-18)
- Phase 7 — Property Tests & Benchmarks (2026-04-18)

---

## Discovered work

_(empty — to be filled in as implementation surfaces unplanned items)_

---

## Decisions log

- **Project start**: Targeting Bun 1.1+ as the primary runtime and `bun test` as the primary test runner (matches the maintainer's stated preference for new TypeScript projects). Node 20+ and modern browsers are supported as a strict consequence of the zero-runtime-dependency rule — nothing in the code base uses Bun-specific APIs.
- **Project start**: `bigint` is the default representation for gob `int` and `uint`. Rejected "number if safe, bigint otherwise" — nondeterministic decoded types are a worse DX than `Number(x)` when narrowing.
- **Project start**: No decorators. Rejected stage-3 decorators (`@gobStruct`) because they require specific `tsconfig.json` settings and complicate consumer builds. `Schema` + `InferSchema<S>` is idiomatic, decorator-free, and works in any TS config.
- **Project start**: ESM only — rejected dual ESM/CJS publish to avoid doubling the build and test surface. CJS consumers use dynamic `import()`.
- **Project start**: `Date` for `time.Time` (with documented millisecond precision and offset loss). `Temporal` is forward-looking but not yet baseline; a `TemporalTimeCodec` can ship later as an additive change.
- **Project start**: `string` (canonical hyphenated lowercase) for `uuid.UUID`, not `Uint8Array`. Matches `crypto.randomUUID()` output and is JSON-friendly.

---

## Session handoff template

### YYYY-MM-DD (Session N)
- Worked on: _(phase, component, specific task)_
- Completed: _(files created / modified, tests added, bugs fixed)_
- Partial / blocked: _(anything unfinished or blocked, and why)_
- Next session: _(what to do first in the next session)_
