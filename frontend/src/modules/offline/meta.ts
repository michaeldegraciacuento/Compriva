import type { LocalDatabase, SqlStatement } from "@/platform/types";

import { divRound, formatUnits, parse, ZERO } from "../pos/fixed-point";

/** Keys in local_meta used by the offline POS and sync. */
export const META = {
  terminal: "terminal",
  cursor: "sync.cursor",
  lastSuccess: "sync.last_success_at",
  receiptFloor: "pos.receipt_sequence_floor",
  setupComplete: "pos.setup_complete",
} as const;

export async function getMeta(db: LocalDatabase, key: string): Promise<string | null> {
  const [row] = await db.select<{ value: string }>("SELECT value FROM local_meta WHERE key = $1", [key]);
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): SqlStatement {
  return {
    sql: "INSERT INTO local_meta (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    params: [key, value],
  };
}

export async function getJson<T>(db: LocalDatabase, key: string): Promise<T | null> {
  const value = await getMeta(db, key);
  return value === null ? null : (JSON.parse(value) as T);
}

export async function getList<T>(db: LocalDatabase, name: string): Promise<T | null> {
  const [row] = await db.select<{ data: string }>("SELECT data FROM local_lists WHERE name = $1", [name]);
  return row ? (JSON.parse(row.data) as T) : null;
}

export function setList(name: string, data: unknown): SqlStatement {
  return { sql: "INSERT INTO local_lists (name, data) VALUES ($1, $2) ON CONFLICT(name) DO UPDATE SET data = excluded.data", params: [name, JSON.stringify(data)] };
}

// --- Exact quantities (1/10000 units), no floating point ---------------------------

const SIX = /^(\d+)(?:\.(\d{1,6}))?$/;

/** quantity × conversion factor, rounded half up to 4 decimals: "2" × "12.000000" = "24". */
export function baseQuantity(quantity: string, factor: string): string {
  const match = SIX.exec(factor.trim());
  if (!match) throw new RangeError(`Not a conversion factor: "${factor}"`);
  const factorMicros = BigInt(match[1] + (match[2] ?? "").padEnd(6, "0"));
  return formatUnits(divRound(parse(quantity) * factorMicros, BigInt(1_000_000)));
}

/** Sum of quantity strings. */
export function sumQuantities(values: string[]): bigint {
  return values.reduce((total, v) => total + parse(v), ZERO);
}
