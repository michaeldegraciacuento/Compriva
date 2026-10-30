import type { LocalDatabase, SqlStatement } from "@/platform/types";

import { formatUnits, parse } from "../pos/fixed-point";
import { sumQuantities } from "./meta";
import { enqueue } from "./outbox";

/**
 * What this terminal may still sell of a SKU: its allocation as the server
 * last reported it, minus what local operations not yet synced have used
 * (sales, minus voids, plus releases). Base units, 1/10000.
 */
export async function availableFor(db: LocalDatabase, skuId: string): Promise<bigint> {
  const [allocation] = await db.select<{ remaining: string }>("SELECT remaining FROM stock_allocations WHERE sku_id = $1", [skuId]);
  const used = await db.select<{ base_quantity: string }>(
    `SELECT c.base_quantity FROM sale_consumption c JOIN sync_outbox o ON o.operation_id = c.operation_id
     WHERE c.sku_id = $1 AND o.status <> 'synced'`, [skuId]);
  return parse(allocation?.remaining ?? "0") - sumQuantities(used.map((u) => u.base_quantity));
}

/**
 * Gives stock back to the server (more than this terminal's fair share).
 * Never more than is still available here; the release is queued after any
 * unsynced sales, so stock already sold offline is never released.
 */
export async function releaseStatements(db: LocalDatabase, skuId: string, excess: string, now = new Date()): Promise<SqlStatement[]> {
  const available = await availableFor(db, skuId);
  const wanted = parse(excess);
  const quantity = wanted < available ? wanted : available;
  if (quantity <= BigInt(0)) return [];

  const op = enqueue("allocation.release", { sku_id: skuId, quantity: formatUnits(quantity) }, undefined, now);
  return [
    { sql: "INSERT INTO sale_consumption (sale_id, operation_id, sku_id, base_quantity) VALUES ('release', $1, $2, $3)", params: [op.id, skuId, formatUnits(quantity)] },
    op.statement,
  ];
}
