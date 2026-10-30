/**
 * Cross-cutting primitive types shared by every module.
 * These aliases document intent; the API sends them as plain JSON strings/numbers.
 */

/** UUIDv7 string: every application record's ID. Terminals generate them offline (lib/ids.ts). */
export type Uuid = string;

/** ISO-8601 UTC timestamp, e.g. "2026-10-30T04:12:00Z". */
export type IsoDateTime = string;

/** Calendar date in the business timezone (Asia/Manila), e.g. "2026-10-30". */
export type IsoDate = string;

/**
 * Money as a decimal string with 4 places, exactly as stored (DECIMAL(15,4)):
 * "12.5000" is ₱12.50. Never convert to a JS number for arithmetic; use
 * formatMoney() for display and a decimal library for calculations.
 */
export type Money = string;

/** Quantity as a decimal string with 4 places (DECIMAL(15,4)): "1.2500" kg. */
export type Quantity = string;

/** Tax rate as a percentage decimal string (DECIMAL(7,4)): "12.0000" is 12%. */
export type Rate = string;
