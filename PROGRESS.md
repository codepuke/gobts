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

**Phase:** All phases complete ✅ — plus documentation-snippet integration (2026-08-20).
**Last session:** 2026-08-20 (Session 4) — cross-port snippet data harmonization: stream topic merge, canonical Point fixtures, two new topics. See Discovered work #6.
**Branch:** main

**Next session:** Two decoder/API issues surfaced while writing the doc examples — see "Discovered work". Otherwise: performance (see bench/results/baseline.md) or v1 release prep.

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

### 1. `SemanticField<T>` was unusable inside a `Schema` (fixed 2026-08-20)

`SemanticField<T>` declared `encode` as a readonly *property*, which TypeScript
checks contravariantly. That made `SemanticField<Status>` unassignable to
`SemanticField<unknown>`, so the README's own `SemanticType` example did not
compile once placed in a `Schema`. Changed to method syntax (bivariant) in
`src/types.ts`. Type-level only — no runtime or wire change.

### 2. `GobDecoder.register()` never fired for `interface{}` values (fixed 2026-08-20)

`_decodeInterface` read the package-qualified concrete type name off the wire
and discarded it, so the factory lookup in `_decodeStruct` saw only the struct's
own wire name. `dec.register('main.Point', …)` — exactly what README.md
documented — silently did nothing.

**Evidence.** An interface value carries two distinct names. The Go-generated
`tests/testdata/interface_value.gob` shows both: `0a "main.Point"` in the
interface header, then `05 "Point"` as the inline type definition's
`CommonType.Name`. Go's own decoder keys on the qualified one
(`encoding/gob/decode.go:700`, "name not registered for interface"), and
`gob.Register` builds it from the **full import path** — so it is `main.Point`
only in `package main`, otherwise `github.com/you/pkg.Point`.

**Sister-port precedent.** Both ports key their decode-side registry on the
*unqualified* name and document the asymmetry (qualified for encode, unqualified
for decode): `gobdotnet` README shows `dec.Register<Point>("Point")` alongside
`enc.Register("main.Point", …)`; `pygob`'s decoder `register()` is effectively
write-only and documented as not required, because decoding is self-describing.

**Resolution — accept both, qualified first.** `_decodeStruct` now takes an
optional `qualifiedName`, supplied only on the interface path, and prefers it
over `structT.common.name`. This makes the documented qualified form work,
disambiguates same-named types from different packages, and keeps the
unqualified name — the portable key the sister ports use, and the one top-level
structs already matched — as the fallback. `GobObject.type` is unchanged
(unqualified), so the testdata sidecars still match.

Regression tests in `tests/decoder.test.ts` → "interface decoding" cover all
four cases: qualified fires, unqualified fires, qualified wins when both are
registered, and an unrelated qualified name does not fire.

README.md's "Registering concrete types" section was rewritten — it was the
actual source of the wrong instruction — and `docs/04-go-interop.md` gained a
"Two names, one value" section. The `interface-values` snippet still shows the
`GobObject` path, which is the variant that stays honest across all four
languages.

### 3. Two pre-existing typecheck errors in `tests/encoder.test.ts`

Lines 470 and 485: `expect(...).toEqual(...)` resolves to the `(expected:
undefined)` overload under the current `bun-types`. Predates this session;
`bun test` passes. Worth pinning or reworking so `bunx tsc --noEmit` is clean.

### 4. Cross-language snippet topic contract (codepuke)

gobts was written believing itself the first mover — at the time no sibling repo
had any `snippet:start` marker and `content/manifest.json` listed every source
with `"topics": []`. That premise turned out to be wrong: all four repos landed
ids independently. See section 5 — the ids were reconciled on 2026-08-20 with
gobts's vocabulary winning the ties, so the 16 ids below did become the contract,
but by agreement rather than by precedence.

Topics and their host files (see CLAUDE.md → "Documentation snippets"; tables
updated 2026-08-20 by the harmonization pass, section 6):

| Topic | File |
|---|---|
| `define-schema`, `schema-type-inference`, `semantic-type` | `examples/schemas.test.ts` |
| `encode-struct`, `decode-struct`, `nested-struct`, `zero-fields-omitted`, `dynamic-field-access` | `examples/structs.test.ts` |
| `encode-scalars`, `encode-slice`, `encode-map` | `examples/collections.test.ts` |
| `stream-multiple-values`, `end-of-stream` | `examples/streaming.test.ts` |
| `interface-values` | `examples/interfaces.test.ts` |
| `time-values`, `uuid-values`, `custom-marshaler` | `examples/codecs.test.ts` |

Shared fixture data every port must mirror:

| Topic | Go shape | Value |
|---|---|---|
| `define-schema`, `encode-struct`, `decode-struct`, `dynamic-field-access` | `type Point struct { X, Y int }` | `{X: 3, Y: 4}` |
| `zero-fields-omitted` | `type Point struct { X, Y int }` | full `{3, 4}` vs partial `{3, 0}`; compare byte lengths, decode restores the zero |
| `nested-struct` | `type Line struct { From, To Point }` | `From{1,2}`, `To{3,4}` |
| `schema-type-inference` | `type Person struct { Name string; Age int }` | `{"Ada", 36}` |
| `stream-multiple-values`, `end-of-stream` | `type Point struct { X, Y int }` | one encoder: `{3, 4}` then `{5, 6}` |
| `encode-scalars` | `int` (+ a short idiomatic scalar tour) | anchor value `42` |
| `encode-slice` | `[]int` | `[1, 2, 3]` |
| `encode-map` | `map[string]int` | `{"one": 1, "two": 2}` |
| `interface-values` | `type Box struct { Value any }` | `main.Point{3, 4}` |
| `semantic-type` | `type Status string` | `"active"` |
| `time-values` | `time.Time` | `2009-11-10T23:00:00Z` |
| `uuid-values` | `uuid.UUID` | `6ba7b810-9dad-11d1-80b4-00c04fd430c8` |
| `custom-marshaler` | `type Celsius float64` (BinaryMarshaler, 8 big-endian bytes) | `21.5` |

`schema-type-inference` and `dynamic-field-access` are TypeScript-specific and
will render as single-tab blocks unless the other ports add equivalents.

### 5. Snippet topic ids reconciled across all four repos (resolved 2026-08-20)

`gobspect`, `pygob`, and `gobdotnet` each landed their own topic ids believing
themselves the first mover, so four vocabularies existed at once. Reconciled in
a `gobdotnet` session on 2026-08-20, with the maintainer breaking ties **toward
gobts** — the opposite direction from what this section originally proposed.
**gobts markers and `:::examples` references were left unchanged.** Do not
"fix" them back.

Renames applied elsewhere:

| repo | from | to |
|---|---|---|
| gobspect | `encode-nested-struct` | `nested-struct` |
| gobspect | `encode-interface` | `interface-values` |
| gobspect | `encode-time` | `time-values` |
| pygob | `interface-value` | `interface-values` |
| pygob | `decode-stream-until-eof` | `end-of-stream` |
| gobdotnet | `encode-scalar`, `stream-multiple`, `stream-eof`, `decode-interface`, `decode-time`, `decode-uuid`, `custom-codec`, `semantic-types` | `encode-scalars`, `stream-multiple-values`, `end-of-stream`, `interface-values`, `time-values`, `uuid-values`, `custom-marshaler`, `semantic-type` |

`go test ./...` green in gobspect and `pytest tests/test_examples.py` green in
pygob after their renames.

`custom-marshaler` vs gobspect's `gobencoder-type`: **not the same concept**, so
they were not merged. Ours registers a codec with the library; gobspect's shows
a Go type implementing `GobEncoder`/`GobDecode`, and stays a gobspect-only topic.

Still open at the time this section was written — both items were resolved on
the gobts side by the harmonization pass, section 6:

- **`stream-encode` + `stream-decode` vs `stream-multiple-values`.** gobspect,
  pygob, and gobdotnet each use one combined topic where we use two. Left as-is
  rather than renamed into a half-match; merging means rewriting our example
  bodies and the prose in `docs/02-encoding-decoding.md`. *(Merged in section 6.)*
- **Fixture data still diverges** on the shared multi-tab topics. gobspect uses
  `Dog`/`Pet` for `interface-values` and `2024-03-14T15:09:26Z` for
  `time-values`; ours uses `main.Point{3,4}` and `2009-11-10T23:00:00Z`;
  gobdotnet's are pinned to its `testdata/*.gob` fixtures. Same-id variants are
  supposed to show the same data, so a tabbed block currently shows four
  variants doing the same thing to different values. *(Canonical data agreed
  cross-port; gobts aligned in section 6.)*

**Not done here:** the codepuke side. `content/manifest.json` still pins gobts at
commit `bc04ab1` with `"topics": []` and `"docs": []`. The maintainer advances
`sources.json` and runs `go run ./cmd/sync` from that repo after this lands —
sync reads via git, so uncommitted changes here are invisible to it.

### 6. Snippet data harmonized to the cross-port canon (2026-08-20)

Follow-up to section 5: the canonical fixture data was agreed across all four
ports (running struct `Point{X: 3, Y: 4}`, bigint on our side), and gobts was
brought onto it. The tables in section 4 were updated in place and are current.

Changes:

- **Stream topics merged.** `stream-encode` + `stream-decode` replaced by the
  single combined `stream-multiple-values` (the id the other three ports already
  use): one `GobEncoder` encodes `Point{3n,4n}` then `Point{5n,6n}`, then a
  `GobDecoder` iterates both. The topic's point is that the type definition is
  sent once. The one-line comment that `bytes()` drains the buffer but keeps
  type state survives; the Person/Ada/Grace stream fixtures are gone from
  `examples/streaming.test.ts`.
- **`end-of-stream`** switched from the Person stream to the same canonical
  `Point{3n,4n}`, `{5n,6n}` stream. The tryDecode/hasMore vs decode-throws
  teaching is unchanged.
- **`define-schema`** trimmed to the hand-declared Point schema only; the Person
  schema left the marked region so all four tabs show the same thing.
- **New topic `encode-scalars`** in `examples/collections.test.ts`: anchor value
  `42`, plus a short idiomatic tour (string/bool/float one-shots).
- **New topic `zero-fields-omitted`** in `examples/structs.test.ts`: full
  `Point{3n,4n}` vs partial `Point{3n,0n}`, byte-length comparison shows the
  zero field absent on the wire, decode restores it.
- **Docs:** `docs/02-encoding-decoding.md` streaming prose reworked around the
  single `:::examples stream-multiple-values` block and a new Scalars section
  references `encode-scalars`; `docs/04-go-interop.md` gained a "Zero values on
  the wire" section referencing `zero-fields-omitted` (replacing the redundant
  wire-format-notes bullet).

Deliberately unchanged, verified against the canon: `encode-struct`,
`decode-struct`, `nested-struct`, `encode-slice`, `encode-map`,
`interface-values`, `time-values`, `uuid-values`, `custom-marshaler`,
`semantic-type`, and `schema-type-inference` (now shared with pygob; the
Person/Ada/36 content is the canon). `dynamic-field-access` stays a gobts-only
topic — merging it into `decode-struct` was considered and rejected because it
shows keys/values/iteration the other ports do not.

Topic count is now 17: 16 − 2 stream ids + 1 merged + 2 new.

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

### 2026-08-20 (Session 3)
- Worked on: codepuke documentation integration — snippet markers and `docs/` pages.
- Completed:
  - New `examples/` directory with 6 doc-shaped test files defining 16 snippet
    topics. Regions wrap clean bodies; imports and assertions stay outside the
    markers. Picked up by `bun test` automatically (no `bunfig.toml` here).
  - New `docs/` with 6 numbered pages (`00-overview` … `05-limitations`),
    condensed from README.md, using `:::examples <topic>` in place of inline ts
    fences. All 16 topics referenced; README.md left untouched.
  - `tsconfig.json`: added `examples/**/*` to `include` so `bunx tsc --noEmit`
    actually covers the examples. `tsconfig.build.json` still builds only
    `src/**/*`, so examples never ship to `dist/`.
  - `CLAUDE.md`: new "Documentation snippets" section plus layout entries.
  - `src/types.ts`: `SemanticField<T>` variance fix (Discovered work #1).
- Verified: `bun test` 305 pass / 0 fail across 15 files; `bunx tsc --noEmit`
  clean apart from the two pre-existing `tests/encoder.test.ts` errors;
  16 `snippet:start` / 16 `snippet:end`, all marker lines conforming;
  defined topic set == referenced topic set; nothing in `../codepuke` touched.
- Partial / blocked: Discovered work #2 (interface factory registration) left
  open — it is a decoder behaviour question, not a docs one.
- Next session: decide #2, then decide whether README.md should point at the
  published docs pages rather than duplicating them.

### 2026-08-20 (Session 3, continued)
- Worked on: Discovered work #2 — interface-value factory registration.
- Completed: decoder fix (`src/decoder.ts`), 4 regression tests, README
  "Which name to register" rewrite, `docs/04-go-interop.md` update.
- Verified: `bun test` 309 pass / 0 fail; `go_verify` 17 pass (Go on PATH);
  `bunx tsc --noEmit` clean apart from the two pre-existing
  `tests/encoder.test.ts` errors (Discovered work #3).
- **New, needs a decision:** `../codepuke/content/manifest.json` changed under
  us. `gobspect` has since landed 19 snippet topics, so the "no ids to reuse"
  finding that drove this session's id choices is now stale. Four of our 16 ids
  match gobspect exactly (`encode-struct`, `decode-struct`, `encode-slice`,
  `encode-map`); several are near-misses that must be renamed to gobspect's
  spelling, and its fixture data differs from ours. See "Discovered work" #5.

### 2026-08-20 (Session 4)
- Worked on: cross-port snippet data harmonization (Discovered work #5 → #6).
- Completed: merged `stream-encode`/`stream-decode` into `stream-multiple-values`
  on the canonical Point stream; `end-of-stream` moved to the same stream;
  `define-schema` trimmed to Point only; new topics `encode-scalars` and
  `zero-fields-omitted`; docs pages 02 and 04 updated; sections 4/5/6 of this
  file updated. Working tree left dirty on purpose — the maintainer commits.
- Verified: `bun test` 310 pass / 0 fail; 17 `snippet:start` / 17 `snippet:end`;
  no duplicate topic ids; defined topic set equals the docs-referenced set; no
  `stream-encode`/`stream-decode` id remains in `examples/` or `docs/` (the old
  ids survive only as history in this file).
- Next session: nothing new — codepuke-side sync (`sources.json` + `cmd/sync`)
  still pending, as recorded in section 5.
