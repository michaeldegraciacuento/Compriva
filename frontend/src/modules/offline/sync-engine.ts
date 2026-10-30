import { ApiError, toApiError } from "@/lib/api";
import type { LocalDatabase } from "@/platform/types";

import { releaseStatements } from "./allocations";
import { allocationStatements, changeStatements, snapshotStatements } from "./catalog-cache";
import { getMeta, META, setMeta } from "./meta";
import { failedAttemptStatements, outboxCounts, pendingOperations, resultStatements } from "./outbox";
import type { Allocation, OperationResult, OutboxOperation, PullResponse } from "./types";

/** The server side of sync (src/modules/offline/sync-api.ts over HTTP; fakes in tests). */
export interface SyncApi {
  push(operations: OutboxOperation[]): Promise<OperationResult[]>;
  pull(cursor: number | null, limit?: number): Promise<PullResponse>;
  /** New allocations, and stock held above this terminal's fair share (to release). */
  topUp(): Promise<{ allocations: Allocation[]; excess: { sku_id: string; quantity: string }[] }>;
}

export type SyncState = "idle" | "syncing" | "offline" | "error";

export interface SyncStatus {
  state: SyncState;
  pending: number;
  rejected: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  openConflicts: number | null;
}

export interface SyncReport {
  outcome: "ok" | "partial" | "offline" | "failed";
  pushed: number;
  rejected: number;
  pulled: number;
  message: string | null;
}

export const BASE_DELAY_MS = 5_000;
export const MAX_DELAY_MS = 5 * 60_000;

/** Exponential backoff with jitter: 5 s, 10 s, 20 s … capped at 5 min, each scaled by 50–100%. */
export function backoffDelay(failures: number, random: () => number = Math.random): number {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, failures - 1));
  return Math.round(exponential * (0.5 + random() * 0.5));
}

class BatchStopped extends Error {}

/**
 * Background synchronization of a desktop terminal (docs/offline-sync.md §4–§5).
 *
 * One cycle: push the outbox in order (batches of 50) → pull changes after the
 * cursor until there are no more (a snapshot first, or again when the server
 * says the cursor is unknown) → ask for an allocation top-up. Every step is
 * safe to interrupt and repeat:
 * - push is idempotent (operation IDs); results are recorded per operation
 * - each pulled page is applied together with its cursor in one transaction
 * - nothing is ever deleted: rejected operations stay in the outbox for review
 *
 * Failures (no internet, server errors) are retried with exponential backoff.
 * Each cycle is written to sync_log (the sync history screen).
 */
export class SyncEngine {
  private running: Promise<SyncReport> | null = null;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private kickTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private status: SyncStatus = { state: "idle", pending: 0, rejected: 0, lastSuccessAt: null, lastError: null, nextAttemptAt: null, openConflicts: null };

  constructor(
    private readonly deps: {
      db: LocalDatabase;
      api: SyncApi;
      now?: () => Date;
      random?: () => number;
      onStatus?: (status: SyncStatus) => void;
      batchSize?: number;
      intervalMs?: number;
    },
  ) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Runs a sync cycle now (or joins the one already running). */
  syncNow(): Promise<SyncReport> {
    this.running ??= this.cycle().finally(() => {
      this.running = null;
      this.schedule();
    });
    return this.running;
  }

  /** A local change was saved: sync soon (debounced). */
  kick(): void {
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = setTimeout(() => void this.syncNow(), 1_000);
  }

  start(): void {
    this.stopped = false;
    void this.syncNow();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.kickTimer) clearTimeout(this.kickTimer);
  }

  async refreshStatus(): Promise<SyncStatus> {
    const counts = await outboxCounts(this.deps.db);
    this.status = { ...this.status, pending: counts.pending, rejected: counts.rejected, lastSuccessAt: await getMeta(this.deps.db, META.lastSuccess) };
    this.deps.onStatus?.(this.status);
    return this.status;
  }

  private schedule(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = this.failures > 0 ? backoffDelay(this.failures, this.deps.random) : (this.deps.intervalMs ?? 30_000);
    this.timer = setTimeout(() => void this.syncNow(), delay);
  }

  private async cycle(): Promise<SyncReport> {
    const startedAt = this.now();
    this.status = { ...this.status, state: "syncing", nextAttemptAt: null };
    this.deps.onStatus?.(this.status);
    const report: SyncReport = { outcome: "ok", pushed: 0, rejected: 0, pulled: 0, message: null };

    try {
      await this.push(report);
      await this.pull(report);
      const { allocations, excess } = await this.deps.api.topUp();
      if (allocations.length > 0) await this.deps.db.transaction(allocationStatements(allocations, this.now()));
      // Holding more than our share (another terminal joined): give it back, after our own unsynced sales.
      const releases = (await Promise.all(excess.map((e) => releaseStatements(this.deps.db, e.sku_id, e.quantity, this.now())))).flat();
      if (releases.length > 0) {
        await this.deps.db.transaction(releases);
        await this.push(report);
        await this.pull(report); // the server's new allocation for this terminal
      }
      await this.deps.db.transaction([setMeta(META.lastSuccess, this.now().toISOString())]);

      this.failures = 0;
      if (report.rejected > 0) {
        report.outcome = "partial";
        report.message = `${report.rejected} operation(s) rejected by the server: see Sync.`;
      }
      this.status = { ...this.status, state: "idle", lastError: null };
    } catch (caught) {
      this.failures++;
      const error = caught instanceof BatchStopped ? new ApiError({ code: "SERVER_ERROR", message: caught.message }) : toApiError(caught);
      report.outcome = error.isOffline ? "offline" : "failed";
      report.message = error.message;
      const next = new Date(this.now().getTime() + backoffDelay(this.failures, this.deps.random));
      this.status = { ...this.status, state: error.isOffline ? "offline" : "error", lastError: error.message, nextAttemptAt: next.toISOString() };
    }

    await this.deps.db.transaction([
      {
        sql: "INSERT INTO sync_log (started_at, finished_at, outcome, pushed, rejected, pulled, message) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        params: [startedAt.toISOString(), this.now().toISOString(), report.outcome, report.pushed, report.rejected, report.pulled, report.message],
      },
      { sql: "DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY id DESC LIMIT 500)" },
    ]);
    await this.refreshStatus();
    return report;
  }

  /** Pushes the outbox in local order. A rejected operation is recorded and the rest continue. */
  private async push(report: SyncReport): Promise<void> {
    const batchSize = this.deps.batchSize ?? 50;
    for (;;) {
      const operations = await pendingOperations(this.deps.db, batchSize);
      if (operations.length === 0) return;

      let results: OperationResult[];
      try {
        results = await this.deps.api.push(operations);
      } catch (error) {
        // Nothing is known about this batch: it stays pending and is sent again (idempotent).
        await this.deps.db.transaction(failedAttemptStatements(operations.map((o) => o.operation_id), toApiError(error).message));
        throw error;
      }

      await this.deps.db.transaction(resultStatements(results, this.now()));
      report.pushed += results.filter((r) => r.status === "applied" || r.status === "duplicate").length;
      report.rejected += results.filter((r) => r.status === "rejected").length;

      if (results.some((r) => r.status === "failed") || results.length < operations.length) {
        throw new BatchStopped("The server could not apply an operation; it will be retried.");
      }
    }
  }

  /** Pulls a snapshot (first time) or every page of changes after the cursor. */
  private async pull(report: SyncReport): Promise<void> {
    for (;;) {
      const stored = await getMeta(this.deps.db, META.cursor);
      const cursor = stored === null ? null : Number(stored);

      let page: PullResponse;
      try {
        page = await this.deps.api.pull(cursor);
      } catch (error) {
        if (toApiError(error).code === "SYNC_CURSOR_INVALID") {
          // The server does not know our position: start again from a full snapshot.
          await this.deps.db.execute("DELETE FROM local_meta WHERE key = $1", [META.cursor]);
          continue;
        }
        throw error;
      }

      if (page.mode === "snapshot") {
        const floor = page.snapshot.terminal.last_receipt_sequence ?? 0;
        const current = Number((await getMeta(this.deps.db, META.receiptFloor)) ?? 0);
        await this.deps.db.transaction([
          ...snapshotStatements(page.snapshot, page.cursor, this.now()),
          setMeta(META.receiptFloor, String(Math.max(floor, current))),
          setMeta(META.setupComplete, this.now().toISOString()),
        ]);
        report.pulled += page.snapshot.items.length;
        return;
      }

      await this.deps.db.transaction(changeStatements(page.changes, page.cursor, this.now()));
      report.pulled += page.changes.length;
      this.status = { ...this.status, openConflicts: page.open_conflicts };
      if (!page.has_more) return;
    }
  }
}
