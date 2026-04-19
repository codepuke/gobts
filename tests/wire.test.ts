import { test, expect, describe } from 'bun:test';
import { GobReader, GobWriter } from '../src/codec.ts';
import { decodeWireType, wireTypeId, wireTypeName, INT, UINT, FLOAT, BOOL, STRING, BYTES } from '../src/wire.ts';

function makeReader(bytes: number[]): GobReader {
  return new GobReader(new Uint8Array(bytes));
}

// Write a uint as a bigint, return reader at start.
function writeRead(fn: (w: GobWriter) => void): GobReader {
  const w = new GobWriter();
  fn(w);
  return new GobReader(w.bytes());
}

// Build a minimal WireType struct message for testing decodeWireType.
// This is the raw struct payload (no message framing, no typeId).
function buildStructWireType(name: string, id: number, fieldDefs: Array<[string, number]>): GobReader {
  const w = new GobWriter();

  // WireType: delta=3 → field 2 = StructT
  w.writeUInt(3n);

  // StructWireType: delta=1 → field 0 = CommonType
  w.writeUInt(1n);

  // CommonType:
  //   delta=1 → field 0 = Name
  w.writeUInt(1n);
  w.writeString(name);
  //   delta=1 → field 1 = Id
  w.writeUInt(1n);
  w.writeInt(BigInt(id));
  //   delta=0 → end CommonType
  w.writeUInt(0n);

  // delta=1 → field 1 of StructWireType = Field []FieldWireType
  w.writeUInt(1n);
  w.writeUInt(BigInt(fieldDefs.length));
  for (const [fieldName, fieldId] of fieldDefs) {
    // FieldWireType:
    //   delta=1 → Name
    w.writeUInt(1n);
    w.writeString(fieldName);
    //   delta=1 → Id
    w.writeUInt(1n);
    w.writeInt(BigInt(fieldId));
    //   delta=0 → end
    w.writeUInt(0n);
  }

  // delta=0 → end StructWireType
  w.writeUInt(0n);
  // delta=0 → end WireType
  w.writeUInt(0n);

  return new GobReader(w.bytes());
}

function buildSliceWireType(id: number, elem: number): GobReader {
  const w = new GobWriter();

  // WireType: delta=2 → field 1 = SliceT
  w.writeUInt(2n);

  // SliceWireType: delta=1 → field 0 = CommonType (with empty Name)
  w.writeUInt(1n);

  // CommonType with empty Name:
  //   delta=2 → field 1 = Id (skipping empty Name at field 0)
  w.writeUInt(2n);
  w.writeInt(BigInt(id));
  //   delta=0 → end CommonType
  w.writeUInt(0n);

  // delta=1 → field 1 of SliceWireType = Elem
  w.writeUInt(1n);
  w.writeInt(BigInt(elem));

  // delta=0 → end SliceWireType
  w.writeUInt(0n);
  // delta=0 → end WireType
  w.writeUInt(0n);

  return new GobReader(w.bytes());
}

function buildMapWireType(id: number, key: number, elem: number): GobReader {
  const w = new GobWriter();

  // WireType: delta=4 → field 3 = MapT
  w.writeUInt(4n);

  // MapWireType: delta=1 → field 0 = CommonType (with empty Name)
  w.writeUInt(1n);
  // CommonType: empty Name → skip to Id with delta=2
  w.writeUInt(2n);
  w.writeInt(BigInt(id));
  w.writeUInt(0n); // end CommonType

  // delta=1 → Key
  w.writeUInt(1n);
  w.writeInt(BigInt(key));

  // delta=1 → Elem
  w.writeUInt(1n);
  w.writeInt(BigInt(elem));

  // delta=0 → end MapWireType
  w.writeUInt(0n);
  // delta=0 → end WireType
  w.writeUInt(0n);

  return new GobReader(w.bytes());
}

function buildArrayWireType(id: number, elem: number, len: number): GobReader {
  const w = new GobWriter();

  // WireType: delta=1 → field 0 = ArrayT
  w.writeUInt(1n);

  // ArrayWireType: delta=1 → CommonType (empty Name)
  w.writeUInt(1n);
  w.writeUInt(2n); // CommonType delta=2 → Id
  w.writeInt(BigInt(id));
  w.writeUInt(0n); // end CommonType

  // delta=1 → Elem
  w.writeUInt(1n);
  w.writeInt(BigInt(elem));

  // delta=1 → Len
  w.writeUInt(1n);
  w.writeInt(BigInt(len));

  // delta=0 → end ArrayWireType
  w.writeUInt(0n);
  // delta=0 → end WireType
  w.writeUInt(0n);

  return new GobReader(w.bytes());
}

function buildMarshalerWireType(kind: 'gob' | 'binary' | 'text', name: string, id: number): GobReader {
  const w = new GobWriter();
  // Delta for WireType: gob=5 (field 4), binary=6 (field 5), text=7 (field 6)
  const delta = kind === 'gob' ? 5n : kind === 'binary' ? 6n : 7n;
  w.writeUInt(delta);

  // MarshalerWireType: delta=1 → CommonType
  w.writeUInt(1n);
  // CommonType: Name present
  w.writeUInt(1n);
  w.writeString(name);
  w.writeUInt(1n); // delta=1 → Id
  w.writeInt(BigInt(id));
  w.writeUInt(0n); // end CommonType

  // delta=0 → end MarshalerWireType
  w.writeUInt(0n);
  // delta=0 → end WireType
  w.writeUInt(0n);

  return new GobReader(w.bytes());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('decodeWireType: struct', () => {
  test('decodes a simple struct wire type', () => {
    const r = buildStructWireType('Point', 64, [['X', INT], ['Y', INT]]);
    const wt = decodeWireType(r);
    expect(wt.struct).toBeDefined();
    expect(wt.struct!.common.name).toBe('Point');
    expect(wt.struct!.common.id).toBe(64);
    expect(wt.struct!.fields).toHaveLength(2);
    expect(wt.struct!.fields[0]!.name).toBe('X');
    expect(wt.struct!.fields[0]!.id).toBe(INT);
    expect(wt.struct!.fields[1]!.name).toBe('Y');
    expect(wt.struct!.fields[1]!.id).toBe(INT);
    expect(wt.slice).toBeUndefined();
    expect(wt.map).toBeUndefined();
    expect(wt.array).toBeUndefined();
  });

  test('decodes a struct with mixed field types', () => {
    const r = buildStructWireType('Mixed', 65, [
      ['Name', STRING],
      ['Age', INT],
      ['Score', FLOAT],
      ['Active', BOOL],
    ]);
    const wt = decodeWireType(r);
    expect(wt.struct!.fields).toHaveLength(4);
    expect(wt.struct!.fields[0]!.name).toBe('Name');
    expect(wt.struct!.fields[0]!.id).toBe(STRING);
    expect(wt.struct!.fields[2]!.id).toBe(FLOAT);
    expect(wt.struct!.fields[3]!.id).toBe(BOOL);
  });
});

describe('decodeWireType: slice (empty CommonType.Name)', () => {
  test('decodes a slice wire type — Id arrives at delta=2', () => {
    const r = buildSliceWireType(68, INT);
    const wt = decodeWireType(r);
    expect(wt.slice).toBeDefined();
    expect(wt.slice!.common.name).toBe('');  // explicitly empty
    expect(wt.slice!.common.id).toBe(68);
    expect(wt.slice!.elem).toBe(INT);
    expect(wt.struct).toBeUndefined();
  });

  test('decodes slice of strings', () => {
    const r = buildSliceWireType(70, STRING);
    const wt = decodeWireType(r);
    expect(wt.slice!.elem).toBe(STRING);
  });
});

describe('decodeWireType: map (empty CommonType.Name)', () => {
  test('decodes a map[string]int wire type', () => {
    const r = buildMapWireType(72, STRING, INT);
    const wt = decodeWireType(r);
    expect(wt.map).toBeDefined();
    expect(wt.map!.common.name).toBe('');
    expect(wt.map!.common.id).toBe(72);
    expect(wt.map!.key).toBe(STRING);
    expect(wt.map!.elem).toBe(INT);
  });

  test('decodes a map[int]string wire type', () => {
    const r = buildMapWireType(73, INT, STRING);
    const wt = decodeWireType(r);
    expect(wt.map!.key).toBe(INT);
    expect(wt.map!.elem).toBe(STRING);
  });
});

describe('decodeWireType: array (empty CommonType.Name)', () => {
  test('decodes an array wire type', () => {
    const r = buildArrayWireType(74, INT, 3);
    const wt = decodeWireType(r);
    expect(wt.array).toBeDefined();
    expect(wt.array!.common.name).toBe('');
    expect(wt.array!.common.id).toBe(74);
    expect(wt.array!.elem).toBe(INT);
    expect(wt.array!.len).toBe(3);
  });
});

describe('decodeWireType: marshalers', () => {
  test('decodes a GobEncoder wire type (kind=gob)', () => {
    const r = buildMarshalerWireType('gob', 'Time', 75);
    const wt = decodeWireType(r);
    expect(wt.gobEncoder).toBeDefined();
    expect(wt.gobEncoder!.common.name).toBe('Time');
    expect(wt.gobEncoder!.common.id).toBe(75);
    expect(wt.binaryMarshaler).toBeUndefined();
    expect(wt.textMarshaler).toBeUndefined();
  });

  test('decodes a BinaryMarshaler wire type (kind=binary)', () => {
    const r = buildMarshalerWireType('binary', 'UUID', 76);
    const wt = decodeWireType(r);
    expect(wt.binaryMarshaler).toBeDefined();
    expect(wt.binaryMarshaler!.common.name).toBe('UUID');
    expect(wt.binaryMarshaler!.common.id).toBe(76);
    expect(wt.gobEncoder).toBeUndefined();
  });

  test('decodes a TextMarshaler wire type (kind=text)', () => {
    const r = buildMarshalerWireType('text', 'Foo', 77);
    const wt = decodeWireType(r);
    expect(wt.textMarshaler).toBeDefined();
    expect(wt.textMarshaler!.common.name).toBe('Foo');
  });
});

// ---------------------------------------------------------------------------
// Go fixture integration: parse real WireType messages from .gob files
// ---------------------------------------------------------------------------

describe('Go fixture wire-type decoding', () => {
  function loadGobMessages(name: string): Array<{ typeId: number; payload: Uint8Array }> {
    const data: Uint8Array = require('fs').readFileSync(`tests/testdata/${name}.gob`) as Uint8Array;
    const { GobReader } = require('../src/codec.ts') as typeof import('../src/codec.ts');
    const r = new GobReader(data);
    const messages = [];
    while (!r.eof()) {
      const msgLen = Number(r.readUInt());
      const msgBytes = r.readRaw(msgLen);
      const msgR = new GobReader(msgBytes);
      const typeId = Number(msgR.readInt());
      const payload = msgBytes.slice(msgR.position);
      messages.push({ typeId, payload });
    }
    return messages;
  }

  test('struct_simple.gob first message is a StructWireType for Point', () => {
    const msgs = loadGobMessages('struct_simple');
    const first = msgs[0]!;
    expect(first.typeId).toBeLessThan(0); // type def
    const r = new GobReader(first.payload);
    const wt = decodeWireType(r);
    expect(wt.struct).toBeDefined();
    expect(wt.struct!.common.name).toBe('Point');
    expect(wt.struct!.fields).toHaveLength(2);
  });

  test('slice_int.gob first message is a SliceWireType with empty name', () => {
    const msgs = loadGobMessages('slice_int');
    const first = msgs[0]!;
    expect(first.typeId).toBeLessThan(0);
    const r = new GobReader(first.payload);
    const wt = decodeWireType(r);
    expect(wt.slice).toBeDefined();
    expect(wt.slice!.common.name).toBe('');
    expect(wt.slice!.elem).toBe(INT);
  });

  test('map_string_int.gob first message is a MapWireType with empty name', () => {
    const msgs = loadGobMessages('map_string_int');
    const first = msgs[0]!;
    const r = new GobReader(first.payload);
    const wt = decodeWireType(r);
    expect(wt.map).toBeDefined();
    expect(wt.map!.common.name).toBe('');
    expect(wt.map!.key).toBe(STRING);
    expect(wt.map!.elem).toBe(INT);
  });

  test('array_int.gob first message is an ArrayWireType with empty name', () => {
    const msgs = loadGobMessages('array_int');
    const first = msgs[0]!;
    const r = new GobReader(first.payload);
    const wt = decodeWireType(r);
    expect(wt.array).toBeDefined();
    expect(wt.array!.common.name).toBe('');
    expect(wt.array!.elem).toBe(INT);
    expect(wt.array!.len).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// wireTypeId / wireTypeName
// ---------------------------------------------------------------------------

describe('wireTypeId', () => {
  test('returns id from struct variant', () => {
    const wt = decodeWireType(buildStructWireType('Foo', 65, [['X', INT]]));
    expect(wireTypeId(wt)).toBe(65);
  });

  test('returns id from slice variant', () => {
    const wt = decodeWireType(buildSliceWireType(70, INT));
    expect(wireTypeId(wt)).toBe(70);
  });

  test('returns id from map variant', () => {
    const wt = decodeWireType(buildMapWireType(72, STRING, INT));
    expect(wireTypeId(wt)).toBe(72);
  });

  test('returns id from array variant', () => {
    const wt = decodeWireType(buildArrayWireType(74, INT, 3));
    expect(wireTypeId(wt)).toBe(74);
  });

  test('returns id from gobEncoder variant', () => {
    const wt = decodeWireType(buildMarshalerWireType('gob', 'Time', 75));
    expect(wireTypeId(wt)).toBe(75);
  });

  test('returns id from binaryMarshaler variant', () => {
    const wt = decodeWireType(buildMarshalerWireType('binary', 'UUID', 76));
    expect(wireTypeId(wt)).toBe(76);
  });

  test('returns id from textMarshaler variant', () => {
    const wt = decodeWireType(buildMarshalerWireType('text', 'Foo', 77));
    expect(wireTypeId(wt)).toBe(77);
  });
});

describe('wireTypeName', () => {
  test('returns name from struct variant', () => {
    const wt = decodeWireType(buildStructWireType('Point', 65, [['X', INT]]));
    expect(wireTypeName(wt)).toBe('Point');
  });

  test('returns "<slice>" for unnamed slice variant', () => {
    const wt = decodeWireType(buildSliceWireType(70, INT));
    expect(wireTypeName(wt)).toBe('<slice>');
  });

  test('returns "<map>" for unnamed map variant', () => {
    const wt = decodeWireType(buildMapWireType(72, STRING, INT));
    expect(wireTypeName(wt)).toBe('<map>');
  });

  test('returns "<array>" for unnamed array variant', () => {
    const wt = decodeWireType(buildArrayWireType(74, INT, 3));
    expect(wireTypeName(wt)).toBe('<array>');
  });

  test('returns name from gobEncoder variant', () => {
    const wt = decodeWireType(buildMarshalerWireType('gob', 'Time', 75));
    expect(wireTypeName(wt)).toBe('Time');
  });

  test('returns name from binaryMarshaler variant', () => {
    const wt = decodeWireType(buildMarshalerWireType('binary', 'UUID', 76));
    expect(wireTypeName(wt)).toBe('UUID');
  });

  test('returns name from textMarshaler variant', () => {
    const wt = decodeWireType(buildMarshalerWireType('text', 'Bar', 77));
    expect(wireTypeName(wt)).toBe('Bar');
  });
});
