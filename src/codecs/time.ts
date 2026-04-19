import type { Codec } from '../decoder.ts';

// Seconds from January 1, year 1 to January 1, 1970 (Unix epoch).
// Matches Go's time package: 1969 full years × 365.2425 days/year × 86400 s/day.
const SECS_FROM_YEAR1_TO_UNIX_EPOCH = 62135596800n;

/**
 * Codec for Go's `time.Time`, which implements `encoding.GobEncoder`.
 *
 * Wire format (15 bytes):
 *   byte[0]:     version = 1
 *   bytes[1..8]: seconds since January 1, year 1, UTC (int64 big-endian)
 *   bytes[9..12]: nanoseconds within the second (int32 big-endian, range [0, 999999999])
 *   bytes[13..14]: timezone offset in minutes (int16 big-endian); -1 = UTC sentinel
 *
 * Precision: JavaScript Date has millisecond resolution only. Sub-millisecond
 * nanoseconds (1–999_999 ns) are truncated on decode. Timezone offset is discarded —
 * the decoded Date is always in UTC.
 *
 * IMPORTANT: `kind` must be 'gob' because time.Time implements encoding.GobEncoder,
 * NOT encoding.BinaryMarshaler. Using 'binary' produces bytes Go rejects.
 */
export const TimeCodec: Codec<Date> = {
  kind: 'gob',

  decode(data: Uint8Array): Date {
    if (data.length < 15) {
      throw new Error(`TimeCodec: expected 15 bytes, got ${data.length}`);
    }
    if (data[0] !== 1) {
      throw new Error(`TimeCodec: unsupported version byte ${data[0]}`);
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // int64 big-endian, split into high and low 32-bit halves.
    const secHigh = BigInt(view.getInt32(1, false));
    const secLow = BigInt(view.getUint32(5, false));
    const secFromYear1 = (secHigh << 32n) | secLow;
    const unixSec = secFromYear1 - SECS_FROM_YEAR1_TO_UNIX_EPOCH;

    const nsec = view.getInt32(9, false);
    const ms = unixSec * 1000n + BigInt(Math.floor(nsec / 1_000_000));

    return new Date(Number(ms));
  },

  encode(value: Date): Uint8Array {
    const buf = new Uint8Array(15);
    const view = new DataView(buf.buffer);

    const ms = value.getTime();
    const unixSec = BigInt(Math.floor(ms / 1000));
    const secFromYear1 = unixSec + SECS_FROM_YEAR1_TO_UNIX_EPOCH;

    // Nanoseconds within the second (from millisecond precision).
    let nsWithinSec = (ms % 1000) * 1_000_000;
    if (nsWithinSec < 0) nsWithinSec += 1_000_000_000;

    buf[0] = 1; // version

    // int64 big-endian
    const secHigh = Number(secFromYear1 >> 32n);
    const secLow = Number(secFromYear1 & 0xFFFFFFFFn);
    view.setInt32(1, secHigh, false);
    view.setUint32(5, secLow, false);

    // int32 big-endian nanoseconds
    view.setInt32(9, nsWithinSec, false);

    // int16 big-endian offset minutes: -1 = UTC (JS Date has no timezone info)
    view.setInt16(13, -1, false);

    return buf;
  },
};
