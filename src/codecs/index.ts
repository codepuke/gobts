import type { CodecMap } from '../decoder.ts';
import { TimeCodec } from './time.ts';
import { UuidCodec } from './uuid.ts';

export { TimeCodec } from './time.ts';
export { UuidCodec } from './uuid.ts';

/**
 * Default codecs for Go's standard marshaler types.
 * Keys are unqualified Go type names: "Time" and "UUID".
 *
 * Pass to GobDecoder / GobEncoder to enable automatic decode/encode
 * of Go `time.Time` and UUID values.
 */
export const DEFAULT_CODECS: CodecMap = {
  Time: TimeCodec as CodecMap[string],
  UUID: UuidCodec as CodecMap[string],
};
