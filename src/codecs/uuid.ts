import type { Codec } from '../decoder.ts';

const HEX_CHARS = '0123456789abcdef';

/**
 * Codec for Go UUID types (github.com/google/uuid, github.com/gofrs/uuid,
 * github.com/satori/go.uuid) that implement `encoding.BinaryMarshaler`.
 *
 * All three libraries share the same 16-byte RFC 4122 big-endian wire format.
 * The canonical string representation is lowercase hyphenated:
 * "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
 *
 * Go's gob transmits the unqualified type name "UUID" regardless of the package.
 */
export const UuidCodec: Codec<string> = {
  kind: 'binary',

  decode(data: Uint8Array): string {
    if (data.length !== 16) {
      throw new Error(`UuidCodec: expected 16 bytes, got ${data.length}`);
    }
    // Format: 8-4-4-4-12 hex digits with dashes.
    const hex = new Array<string>(36);
    let h = 0;
    for (let i = 0; i < 16; i++) {
      if (i === 4 || i === 6 || i === 8 || i === 10) {
        hex[h++] = '-';
      }
      const byte = data[i]!;
      hex[h++] = HEX_CHARS[byte >> 4]!;
      hex[h++] = HEX_CHARS[byte & 0x0f]!;
    }
    return hex.join('');
  },

  encode(value: string): Uint8Array {
    // Strip dashes and parse 32 hex chars → 16 bytes.
    const clean = value.replace(/-/g, '');
    if (clean.length !== 32) {
      throw new Error(`UuidCodec: invalid UUID string "${value}"`);
    }
    const buf = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      const hi = parseInt(clean[i * 2]!, 16);
      const lo = parseInt(clean[i * 2 + 1]!, 16);
      if (isNaN(hi) || isNaN(lo)) {
        throw new Error(`UuidCodec: invalid hex in UUID "${value}"`);
      }
      buf[i] = (hi << 4) | lo;
    }
    return buf;
  },
};
