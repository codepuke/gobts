---
title: Go Interoperability
---

# Go Interoperability

Wire fidelity is the point of this library: bytes Go writes must read here, and
bytes written here must read in Go. The project's test suite proves the second
direction by piping encoder output to a live Go decoder subprocess.

## interface{} fields

Decoding an interface value needs no setup — the concrete value's type
definition travels inline in the stream. Encoding one does, because the encoder
has to know which schema and which Go name to write.

:::examples interface-values

Two details are easy to get wrong here:

- The name the **encoder** writes is **package-qualified** (`"main.Point"`),
  matching what the Go side passed to `gob.Register`. Codec type names, by
  contrast, are unqualified. Go builds the qualified name from the full import
  path, so a type outside `package main` is `"github.com/you/pkg.Point"` — not
  `"pkg.Point"`.
- A concrete type used behind an interface gets an **inline type definition
  only** — never also a top-level one. Emitting both makes Go's decoder fail
  with "duplicate type received".

### Two names, one value

An interface value carries both names: the qualified one in the interface
header, and the unqualified `CommonType.Name` in the inline type definition. The
decoded `GobObject` reports the unqualified name, and an optional decode-side
factory registered with `decoder.register()` matches on either — qualified
first, unqualified as a fallback. Registering the unqualified name is the
portable choice, since it is also what the Python and C# ports key on.

Decoding never *requires* any of this. The stream is self-describing; a factory
only lets you swap the resulting `GobObject` for a value of your own shape.

## Schema evolution

Adding and removing fields is safe, and that safety is inherited from the wire
format rather than implemented on top of it:

- Fields present in Go but absent from the TypeScript schema are decoded and
  ignored.
- Fields absent in Go but present in the schema are filled with zero values.
- Field **types** must not change within a stream. Gob has no field-level type
  negotiation.

## Wire format notes

These are the behaviours most likely to surprise you when comparing output
against Go by hand.

- **User type IDs start at 65.** A fresh encoder always begins there, but a Go
  encoder in a long-running process may already have assigned 65…N to earlier
  types. So byte-level comparison against Go-generated `.gob` files is reliable
  **only for scalars**, which carry no user type IDs. For structs, slices of
  structs, and maps, decode both sides and compare values structurally.

- **Go map iteration is non-deterministic.** The key/value order in a
  map-containing stream varies between runs. Never byte-compare such output.

- **Zero-valued fields are omitted on the wire.** The decoder pre-populates
  every field with its zero value before the delta loop, so an omitted field
  arrives as `0n`, `false`, `""`, and so on.

- **Floats are byte-reversed IEEE 754**, then encoded as an unsigned integer.
  That is deliberate — it makes trailing zeros compress.

- **Collection wire types carry an empty `CommonType.Name`**, so the `Id` field
  arrives with delta 2, skipping the absent name. This is the single most common
  source of off-by-one delta bugs.

- **The first field delta is 1, not 0.** Field indices start at −1, and a delta
  of 0 terminates the struct.

- **Top-level non-struct values are singleton-wrapped**: a `0x00` byte precedes
  the value.
