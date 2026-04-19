import type { GobReader } from './codec.ts';

// ---------------------------------------------------------------------------
// Bootstrap type ID constants
// ---------------------------------------------------------------------------

export const BOOL = 1;
export const INT = 2;
export const UINT = 3;
export const FLOAT = 4;
export const BYTES = 5;
export const STRING = 6;
export const COMPLEX = 7;
export const INTERFACE = 8;
export const WIRE_TYPE = 16;
export const ARRAY_TYPE = 17;
export const COMMON_TYPE = 18;
export const SLICE_TYPE = 19;
export const STRUCT_TYPE = 20;
export const FIELD_TYPE = 21;
export const FIELD_TYPE_SLICE = 22;
export const MAP_TYPE = 23;
export const FIRST_USER_ID = 65;

// ---------------------------------------------------------------------------
// Wire-type record interfaces
// ---------------------------------------------------------------------------

export interface CommonType {
  readonly name: string;
  readonly id: number;
}

export interface FieldWireType {
  readonly name: string;
  readonly id: number;
}

export interface StructWireType {
  readonly common: CommonType;
  readonly fields: ReadonlyArray<FieldWireType>;
}

export interface SliceWireType {
  readonly common: CommonType;
  readonly elem: number;
}

export interface ArrayWireType {
  readonly common: CommonType;
  readonly elem: number;
  readonly len: number;
}

export interface MapWireType {
  readonly common: CommonType;
  readonly key: number;
  readonly elem: number;
}

export interface MarshalerWireType {
  readonly common: CommonType;
}

export interface WireType {
  readonly array?: ArrayWireType;
  readonly slice?: SliceWireType;
  readonly struct?: StructWireType;
  readonly map?: MapWireType;
  readonly gobEncoder?: MarshalerWireType;
  readonly binaryMarshaler?: MarshalerWireType;
  readonly textMarshaler?: MarshalerWireType;
}

// ---------------------------------------------------------------------------
// Wire-type decoding
// ---------------------------------------------------------------------------

function decodeCommonType(r: GobReader): CommonType {
  let name = '';
  let id = 0;
  let fieldNum = -1;
  for (;;) {
    const delta = Number(r.readUInt());
    if (delta === 0) break;
    fieldNum += delta;
    if (fieldNum === 0) {
      name = r.readString();
    } else if (fieldNum === 1) {
      id = Number(r.readInt());
    }
  }
  return { name, id };
}

function decodeFieldWireType(r: GobReader): FieldWireType {
  let name = '';
  let id = 0;
  let fieldNum = -1;
  for (;;) {
    const delta = Number(r.readUInt());
    if (delta === 0) break;
    fieldNum += delta;
    if (fieldNum === 0) {
      name = r.readString();
    } else if (fieldNum === 1) {
      id = Number(r.readInt());
    }
  }
  return { name, id };
}

function decodeArrayWireType(r: GobReader): ArrayWireType {
  let common: CommonType = { name: '', id: 0 };
  let elem = 0;
  let len = 0;
  let fieldNum = -1;
  for (;;) {
    const delta = Number(r.readUInt());
    if (delta === 0) break;
    fieldNum += delta;
    if (fieldNum === 0) {
      common = decodeCommonType(r);
    } else if (fieldNum === 1) {
      elem = Number(r.readInt());
    } else if (fieldNum === 2) {
      len = Number(r.readInt());
    }
  }
  return { common, elem, len };
}

function decodeSliceWireType(r: GobReader): SliceWireType {
  let common: CommonType = { name: '', id: 0 };
  let elem = 0;
  let fieldNum = -1;
  for (;;) {
    const delta = Number(r.readUInt());
    if (delta === 0) break;
    fieldNum += delta;
    if (fieldNum === 0) {
      common = decodeCommonType(r);
    } else if (fieldNum === 1) {
      elem = Number(r.readInt());
    }
  }
  return { common, elem };
}

function decodeStructWireType(r: GobReader): StructWireType {
  let common: CommonType = { name: '', id: 0 };
  let fields: FieldWireType[] = [];
  let fieldNum = -1;
  for (;;) {
    const delta = Number(r.readUInt());
    if (delta === 0) break;
    fieldNum += delta;
    if (fieldNum === 0) {
      common = decodeCommonType(r);
    } else if (fieldNum === 1) {
      const count = Number(r.readUInt());
      fields = [];
      for (let i = 0; i < count; i++) {
        fields.push(decodeFieldWireType(r));
      }
    }
  }
  return { common, fields };
}

function decodeMapWireType(r: GobReader): MapWireType {
  let common: CommonType = { name: '', id: 0 };
  let key = 0;
  let elem = 0;
  let fieldNum = -1;
  for (;;) {
    const delta = Number(r.readUInt());
    if (delta === 0) break;
    fieldNum += delta;
    if (fieldNum === 0) {
      common = decodeCommonType(r);
    } else if (fieldNum === 1) {
      key = Number(r.readInt());
    } else if (fieldNum === 2) {
      elem = Number(r.readInt());
    }
  }
  return { common, key, elem };
}

function decodeMarshalerWireType(r: GobReader): MarshalerWireType {
  let common: CommonType = { name: '', id: 0 };
  let fieldNum = -1;
  for (;;) {
    const delta = Number(r.readUInt());
    if (delta === 0) break;
    fieldNum += delta;
    if (fieldNum === 0) {
      common = decodeCommonType(r);
    }
  }
  return { common };
}

/**
 * Decode a WireType struct from the reader.
 *
 * The reader must be positioned immediately after the type-ID field in a
 * type-definition message. Dispatches on the delta-encoded field index to
 * produce the correct variant.
 *
 * Critical: collection types (slice, map, array) have empty CommonType.Name.
 * Since gob omits zero-value fields, the Name field is not transmitted and
 * the Id field arrives with delta=2 (skipping Name at index 0). This is
 * handled transparently inside decodeCommonType.
 */
export function decodeWireType(r: GobReader): WireType {
  let array: ArrayWireType | undefined;
  let slice: SliceWireType | undefined;
  let struct: StructWireType | undefined;
  let map: MapWireType | undefined;
  let gobEncoder: MarshalerWireType | undefined;
  let binaryMarshaler: MarshalerWireType | undefined;
  let textMarshaler: MarshalerWireType | undefined;

  let fieldNum = -1;
  for (;;) {
    const delta = Number(r.readUInt());
    if (delta === 0) break;
    fieldNum += delta;
    if (fieldNum === 0) {
      array = decodeArrayWireType(r);
    } else if (fieldNum === 1) {
      slice = decodeSliceWireType(r);
    } else if (fieldNum === 2) {
      struct = decodeStructWireType(r);
    } else if (fieldNum === 3) {
      map = decodeMapWireType(r);
    } else if (fieldNum === 4) {
      gobEncoder = decodeMarshalerWireType(r);
    } else if (fieldNum === 5) {
      binaryMarshaler = decodeMarshalerWireType(r);
    } else if (fieldNum === 6) {
      textMarshaler = decodeMarshalerWireType(r);
    }
  }

  const wt: WireType = {};
  if (array !== undefined) (wt as { array?: ArrayWireType }).array = array;
  if (slice !== undefined) (wt as { slice?: SliceWireType }).slice = slice;
  if (struct !== undefined) (wt as { struct?: StructWireType }).struct = struct;
  if (map !== undefined) (wt as { map?: MapWireType }).map = map;
  if (gobEncoder !== undefined) (wt as { gobEncoder?: MarshalerWireType }).gobEncoder = gobEncoder;
  if (binaryMarshaler !== undefined) (wt as { binaryMarshaler?: MarshalerWireType }).binaryMarshaler = binaryMarshaler;
  if (textMarshaler !== undefined) (wt as { textMarshaler?: MarshalerWireType }).textMarshaler = textMarshaler;
  return wt;
}

/** Return the type ID that this WireType describes. */
export function wireTypeId(wt: WireType): number {
  if (wt.array) return wt.array.common.id;
  if (wt.slice) return wt.slice.common.id;
  if (wt.struct) return wt.struct.common.id;
  if (wt.map) return wt.map.common.id;
  if (wt.gobEncoder) return wt.gobEncoder.common.id;
  if (wt.binaryMarshaler) return wt.binaryMarshaler.common.id;
  if (wt.textMarshaler) return wt.textMarshaler.common.id;
  throw new Error('WireType has no variant set');
}

/** Return the display name of a WireType (for error messages). */
export function wireTypeName(wt: WireType): string {
  if (wt.array) return wt.array.common.name || '<array>';
  if (wt.slice) return wt.slice.common.name || '<slice>';
  if (wt.struct) return wt.struct.common.name;
  if (wt.map) return wt.map.common.name || '<map>';
  if (wt.gobEncoder) return wt.gobEncoder.common.name;
  if (wt.binaryMarshaler) return wt.binaryMarshaler.common.name;
  if (wt.textMarshaler) return wt.textMarshaler.common.name;
  return '<unknown>';
}
