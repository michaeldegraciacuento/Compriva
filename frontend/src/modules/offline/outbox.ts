import { uuidv7 } from "@/lib/ids";
import type { LocalDatabase, SqlStatement } from "@/platform/types";

import type { OperationResult, OperationType, OutboxOperation, OutboxRow } from "./types";

/**
 * The sync outbox: every local change the server must know about, in order.
 * An operation is written in the same transaction as the change itself, so a
 * sale can never exist locally without its outbox entry. Operations are never
 * deleted: synced ones are kept with their result, rejected ones stay for
 * review (docs/offline-sync.md §3–§4).
 */

/** Insert statement; the local sequence is taken inside the transaction, so it is gap-free and ordered. */
export function enqueue(type: OperationType, payload: Record<string, unknown>, operationId = uuidv7(), now = new Date()): { id: string; statement: SqlStatement } {
  return {
    id: operationId,
    statement: {
      sql: `INSERT INTO sync_outbox (operation_id, local_seq, type, payload, schema_version, created_at, status)
            VALUES ($1, (SELECT COALESCE(MAX(local_seq), 0) + 1 FROM sync_outbox), $2, $3, 1, $4, 'pending')`,
      params: [operationId, type, JSON.stringify(payload), now.toISOString()],
    },
  };
}

export async function pendingOperations(db: LocalDatabase, limit: number): Promise<OutboxOperation[]> {
  const rows = await db.select<OutboxRow>("SELECT * FROM sync_outbox WHERE status = 'pending' ORDER BY local_seq LIMIT $1", [limit]);
  return rows.map((row) => ({
    operation_id: row.operation_id,
    local_seq: Number(row.local_seq),
    type: row.type,
    schema_version: Number(row.schema_version),
    created_at: row.created_at,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  }));
}

/** Records the server's answer for each operation. Failed ones stay pending with the error noted. */
export function resultStatements(results: OperationResult[], now = new Date()): SqlStatement[] {
  const at = now.toISOString();
  return results.map((r) => {
    switch (r.status) {
      case "applied":
      case "duplicate":
        return { sql: "UPDATE sync_outbox SET status = 'synced', synced_at = $2, result = $3, last_error = NULL, attempts = attempts + 1 WHERE operation_id = $1", params: [r.operation_id, at, JSON.stringify(r.result ?? {})] };
      case "rejected":
        return { sql: "UPDATE sync_outbox SET status = 'rejected', last_error = $2, attempts = attempts + 1 WHERE operation_id = $1", params: [r.operation_id, `${r.error.code}: ${r.error.message}`] };
      default:
        return { sql: "UPDATE sync_outbox SET last_error = $2, attempts = attempts + 1 WHERE operation_id = $1", params: [r.operation_id, `${r.error.code}: ${r.error.message}`] };
    }
  });
}

export function failedAttemptStatements(operationIds: string[], message: string): SqlStatement[] {
  return operationIds.map((id) => ({ sql: "UPDATE sync_outbox SET last_error = $2, attempts = attempts + 1 WHERE operation_id = $1", params: [id, message] }));
}

export async function outboxCounts(db: LocalDatabase): Promise<{ pending: number; rejected: number; synced: number }> {
  const rows = await db.select<{ status: string; total: number }>("SELECT status, COUNT(*) AS total FROM sync_outbox GROUP BY status");
  const count = (status: string) => Number(rows.find((r) => r.status === status)?.total ?? 0);
  return { pending: count("pending"), rejected: count("rejected"), synced: count("synced") };
}

export async function recentOperations(db: LocalDatabase, status: "pending" | "rejected" | "synced" | "all", limit = 100): Promise<OutboxRow[]> {
  return status === "all"
    ? db.select<OutboxRow>("SELECT * FROM sync_outbox ORDER BY local_seq DESC LIMIT $1", [limit])
    : db.select<OutboxRow>("SELECT * FROM sync_outbox WHERE status = $1 ORDER BY local_seq DESC LIMIT $2", [status, limit]);
}
