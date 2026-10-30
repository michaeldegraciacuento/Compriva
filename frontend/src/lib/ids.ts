/**
 * UUIDv7 (RFC 9562): 48-bit Unix-ms timestamp + random bits.
 *
 * Used for IDs created on the client — offline sales, operation IDs, request
 * IDs — so they are globally unique without a server round trip and sort by
 * creation time (good for database indexes and sync ordering).
 */
export function uuidv7(timestampMs: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));

  const high = Math.floor(timestampMs / 2 ** 32);
  const low = timestampMs % 2 ** 32;
  bytes[0] = (high >>> 8) & 0xff;
  bytes[1] = high & 0xff;
  bytes[2] = (low >>> 24) & 0xff;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;

  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 9562 variant

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Extracts the creation time of a UUIDv7. */
export function uuidv7Timestamp(id: string): number {
  return parseInt(id.replace(/-/g, "").slice(0, 12), 16);
}
