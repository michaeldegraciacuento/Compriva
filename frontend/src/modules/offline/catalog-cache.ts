import { cashierSnapshotStatements } from "@/modules/auth/offline";
import type { SqlStatement } from "@/platform/types";

import { META, setList, setMeta } from "./meta";
import type { Allocation, CachedItem, Change, Snapshot } from "./types";

/**
 * Writes what the terminal pulls into its local database. A snapshot or a
 * page of changes is applied together with the new cursor in ONE transaction,
 * so an interrupted pull simply replays the page next time (docs/offline-sync.md §5).
 */

function itemStatements(item: CachedItem): SqlStatement[] {
  return [
    {
      sql: `INSERT INTO catalog_items (sku_id, name, code, category_id, search, data) VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT(sku_id) DO UPDATE SET name = excluded.name, code = excluded.code, category_id = excluded.category_id,
              search = excluded.search, data = excluded.data`,
      params: [item.id, item.name, item.code, item.category_id, `${item.name} ${item.code}`.toLowerCase(), JSON.stringify(item)],
    },
    { sql: "DELETE FROM catalog_barcodes WHERE sku_id = $1", params: [item.id] },
    ...item.barcodes.map((b) => ({
      sql: "INSERT INTO catalog_barcodes (barcode, sku_id, unit_id) VALUES ($1, $2, $3) ON CONFLICT(barcode) DO UPDATE SET sku_id = excluded.sku_id, unit_id = excluded.unit_id",
      params: [b.barcode, item.id, b.unit_id],
    })),
  ];
}

function allocationStatement(allocation: Allocation, now: string): SqlStatement {
  return {
    sql: "INSERT INTO stock_allocations (sku_id, remaining, synced_at) VALUES ($1, $2, $3) ON CONFLICT(sku_id) DO UPDATE SET remaining = excluded.remaining, synced_at = excluded.synced_at",
    params: [allocation.sku_id, allocation.remaining, now],
  };
}

/** Replaces everything cached with a full snapshot. */
export function snapshotStatements(snapshot: Snapshot, cursor: number, now = new Date()): SqlStatement[] {
  const at = now.toISOString();
  return [
    { sql: "DELETE FROM catalog_barcodes" },
    { sql: "DELETE FROM catalog_items" },
    ...snapshot.items.flatMap(itemStatements),
    setList("categories", snapshot.categories),
    setList("payment_methods", snapshot.payment_methods),
    setList("discounts", snapshot.discounts),
    setList("settings", snapshot.settings),
    { sql: "DELETE FROM stock_allocations" },
    ...snapshot.allocations.map((a) => allocationStatement(a, at)),
    ...cashierSnapshotStatements(snapshot.cashiers, now),
    setMeta(META.terminal, JSON.stringify(snapshot.terminal)),
    setMeta(META.cursor, String(cursor)),
  ];
}

/** Applies one page of changes and advances the cursor. */
export function changeStatements(changes: Change[], cursor: number, now = new Date()): SqlStatement[] {
  const at = now.toISOString();
  const statements = changes.flatMap((change): SqlStatement[] => {
    switch (change.entity) {
      case "item":
        return change.op === "upsert"
          ? itemStatements(change.data)
          : [{ sql: "DELETE FROM catalog_barcodes WHERE sku_id = $1", params: [change.id] }, { sql: "DELETE FROM catalog_items WHERE sku_id = $1", params: [change.id] }];
      case "categories":
      case "payment_methods":
      case "discounts":
      case "settings":
        return [setList(change.entity, change.data)];
      case "cashiers":
        return cashierSnapshotStatements(change.data, now);
      case "allocation":
        return [allocationStatement(change.data, at)];
    }
  });
  return [...statements, setMeta(META.cursor, String(cursor))];
}

/** Allocations granted by a top-up (they also arrive with the next pull). */
export function allocationStatements(allocations: Allocation[], now = new Date()): SqlStatement[] {
  return allocations.map((a) => allocationStatement(a, now.toISOString()));
}
