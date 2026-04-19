// Public API for gobts — TypeScript port of Go's encoding/gob.

export {
  Complex,
  GobEncoded,
  GobObject,
  Schema,
  GOB_BOOL,
  GOB_INT,
  GOB_UINT,
  GOB_FLOAT,
  GOB_BYTES,
  GOB_STRING,
  GOB_COMPLEX,
  GOB_INTERFACE,
  GOB_DURATION,
  SliceOf,
  MapOf,
  ArrayOf,
  Marshaler,
  SemanticType,
} from './types.ts';
export type {
  GobFieldType,
  PrimitiveField,
  SliceField,
  MapField,
  ArrayField,
  StructField,
  MarshalerField,
  SemanticField,
  FieldMap,
} from './types.ts';

export { GobEncoder } from './encoder.ts';
export type { EncodeOptions } from './encoder.ts';

export { GobDecoder } from './decoder.ts';
export type { Codec, CodecMap, DecodeOptions } from './decoder.ts';

export {
  GobError,
  GobDecodeError,
  GobEncodeError,
  EndOfStreamError,
} from './errors.ts';

export type { InferField, InferSchema } from './infer.ts';

// ---------------------------------------------------------------------------
// Convenience functions — one-shot encode / decode.
// ---------------------------------------------------------------------------

import { GobEncoder, type EncodeOptions } from './encoder.ts';
import { GobDecoder, type DecodeOptions } from './decoder.ts';

/** Encode a single value to gob bytes. Creates a fresh encoder per call. */
export function encode<T>(value: T, options?: EncodeOptions): Uint8Array {
  const enc = new GobEncoder(options);
  enc.encode(value, options);
  return enc.bytes();
}

/** Decode the first value from gob bytes. Creates a fresh decoder per call.
 *  Throws EndOfStreamError if the buffer is empty. */
export function decode<T = unknown>(bytes: Uint8Array, options?: DecodeOptions): T {
  return new GobDecoder(bytes, options).decode<T>();
}
