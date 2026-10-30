// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";

import { addItem } from "../pos/cart";
import { releaseStatements } from "./allocations";
import { LocalPos } from "./local-pos";
import { getMeta, META } from "./meta";
import { backoffDelay, MAX_DELAY_MS, SyncEngine, type SyncApi } from "./sync-engine";
import { CORNED_BEEF, JUAN, snapshot, verifyPin } from "./testing/fixtures";
import { createTestDatabase } from "./testing/node-database";
import type { Change, OperationResult, OutboxOperation, PullResponse } from "./types";

/** A stand-in for the server: remembers applied operations, keeps a change log, can go offline. */
class FakeServer implements SyncApi {
  online = true;
  applied = new Map<string, OutboxOperation>();
  received: string[] = [];
  rejectTypes = new Set<string>();
  failOnSeq: number | null = null;
  changes: { id: number; change: Change }[] = [];
  head = 5;

  private offline() {
    if (!this.online) throw new ApiError({ code: "NETWORK_ERROR", message: "Cannot reach the Compriva server." });
  }

  async push(operations: OutboxOperation[]): Promise<OperationResult[]> {
    this.offline();
    const results: OperationResult[] = [];
    for (const op of operations) {
      this.received.push(op.operation_id);
      if (op.local_seq === this.failOnSeq) {
        results.push({ operation_id: op.operation_id, status: "failed", error: { code: "SERVER_ERROR", message: "boom" } });
        break;
      }
      if (this.applied.has(op.operation_id)) results.push({ operation_id: op.operation_id, status: "duplicate", result: {} });
      else if (this.rejectTypes.has(op.type)) results.push({ operation_id: op.operation_id, status: "rejected", error: { code: "FORBIDDEN", message: "not allowed" } });
      else {
        this.applied.set(op.operation_id, op);
        results.push({ operation_id: op.operation_id, status: "applied", result: { conflicts: [] } });
      }
    }
    return results;
  }

  async pull(cursor: number | null, limit = 2): Promise<PullResponse> {
    this.offline();
    if (cursor === null) return { mode: "snapshot", cursor: this.head, has_more: false, server_time: "", snapshot: snapshot() };
    if (cursor > this.head) throw new ApiError({ code: "SYNC_CURSOR_INVALID", message: "unknown cursor", status: 410 });
    const page = this.changes.filter((c) => c.id > cursor).slice(0, limit);
    return { mode: "changes", cursor: page.at(-1)?.id ?? cursor, has_more: page.length === limit, server_time: "", changes: page.map((c) => c.change), open_conflicts: 0 };
  }

  excess: { sku_id: string; quantity: string }[] = [];

  async topUp() {
    this.offline();
    const excess = this.excess;
    this.excess = [];
    return { allocations: [], excess };
  }

  addChange(change: Change) {
    this.head++;
    this.changes.push({ id: this.head, change });
  }
}

let db: ReturnType<typeof createTestDatabase>;
let server: FakeServer;
let engine: SyncEngine;
let pos: LocalPos;
let now: Date;

beforeEach(async () => {
  db = createTestDatabase();
  server = new FakeServer();
  now = new Date("2026-10-30T02:00:00Z");
  engine = new SyncEngine({ db, api: server, now: () => now, random: () => 1 });
  pos = new LocalPos({ db, user: () => JUAN, verifyPin, now: () => now });
});

async function sellOne(id: string) {
  const [line] = addItem([], CORNED_BEEF);
  return pos.checkout({ id, lines: [line], discount: null, payments: [{ method: "cash", amount: "50" }], expectedTotal: "50.00" });
}

const statuses = async () => (await db.select<{ type: string; status: string; attempts: number }>("SELECT type, status, attempts FROM sync_outbox ORDER BY local_seq")).map((r) => [r.type, r.status, Number(r.attempts)]);

describe("sync engine", () => {
  it("downloads a snapshot first, then pushes offline sales in order once the server is reachable", async () => {
    expect((await engine.syncNow()).outcome).toBe("ok");
    expect(await getMeta(db, META.cursor)).toBe("5");
    expect(await getMeta(db, META.setupComplete)).not.toBeNull();

    // Offline: the terminal keeps selling; nothing is lost.
    server.online = false;
    await pos.openShift("0");
    await sellOne("sale-a");
    await sellOne("sale-b");
    const offline = await engine.syncNow();
    expect(offline.outcome).toBe("offline");
    expect(await statuses()).toEqual([["shift.opened", "pending", 1], ["sale.completed", "pending", 1], ["sale.completed", "pending", 1]]);
    expect((await engine.refreshStatus()).pending).toBe(3);

    // Back online: everything goes up in local order, once.
    server.online = true;
    const report = await engine.syncNow();
    expect(report).toMatchObject({ outcome: "ok", pushed: 3 });
    expect([...server.applied.values()].map((o) => o.local_seq)).toEqual([1, 2, 3]);
    expect(await statuses()).toEqual([["shift.opened", "synced", 2], ["sale.completed", "synced", 2], ["sale.completed", "synced", 2]]);
    expect((await engine.refreshStatus()).pending).toBe(0);
  });

  it("rejected operations are kept for review and do not block the others", async () => {
    await engine.syncNow();
    await pos.openShift("0");
    await sellOne("sale-a");
    await pos.cashMovement({ type: "cash_in", amount: "100", reason: "Coins", approval: { login: "maria", secret: "246810" } });
    server.rejectTypes.add("sale.completed");

    const report = await engine.syncNow();
    expect(report).toMatchObject({ outcome: "partial", pushed: 2, rejected: 1 });
    expect(await statuses()).toEqual([["shift.opened", "synced", 1], ["sale.completed", "rejected", 1], ["cash.movement", "synced", 1]]);
    const [rejected] = await db.select<{ last_error: string }>("SELECT last_error FROM sync_outbox WHERE status = 'rejected'");
    expect(rejected.last_error).toBe("FORBIDDEN: not allowed");

    // Never retried automatically, never deleted.
    await engine.syncNow();
    expect(server.received.filter((id) => !server.applied.has(id))).toHaveLength(1);
    expect(await db.select("SELECT * FROM sync_outbox")).toHaveLength(3);
  });

  it("an interrupted push is safe to repeat: the server reports duplicates", async () => {
    await engine.syncNow();
    await pos.openShift("0");
    await sellOne("sale-a");
    await sellOne("sale-b");

    // The server applies seq 1 and 2, then fails on 3: the batch stops, 3 stays pending.
    server.failOnSeq = 3;
    expect((await engine.syncNow()).outcome).toBe("failed");
    expect((await statuses()).map((s) => s[1])).toEqual(["synced", "synced", "pending"]);

    // Simulate a lost response: mark everything pending again and resend.
    await db.execute("UPDATE sync_outbox SET status = 'pending'");
    server.failOnSeq = null;
    const report = await engine.syncNow();
    expect(report.pushed).toBe(3);
    expect(server.applied.size).toBe(3);
  });

  it("pulls changes page by page and replays a page whose apply was interrupted", async () => {
    await engine.syncNow();
    server.addChange({ entity: "item", op: "upsert", id: CORNED_BEEF.id, data: { ...CORNED_BEEF, units: [{ ...CORNED_BEEF.units[0], price: "52.0000" }] } });
    server.addChange({ entity: "allocation", op: "upsert", id: CORNED_BEEF.id, data: { sku_id: CORNED_BEEF.id, remaining: "35.0000" } });
    server.addChange({ entity: "item", op: "delete", id: "sku-gone" });

    // The first page's transaction fails (power cut): the cursor must not move.
    db.failNextTransaction();
    expect((await engine.syncNow()).outcome).toBe("failed");
    expect(await getMeta(db, META.cursor)).toBe("5");

    const report = await engine.syncNow();
    expect(report.pulled).toBe(3);
    expect(await getMeta(db, META.cursor)).toBe("8");
    const [item] = await pos.catalog({ q: "corned" });
    expect(item.units[0].price).toBe("52.0000");
    expect(item.stock.available).toBe("35");
  });

  it("starts again from a snapshot when the server does not know the cursor", async () => {
    await engine.syncNow();
    await db.execute("UPDATE local_meta SET value = '999' WHERE key = $1", [META.cursor]);
    expect((await engine.syncNow()).outcome).toBe("ok");
    expect(await getMeta(db, META.cursor)).toBe("5");
  });

  it("releases stock above its share, but never stock it sold offline and has not synced", async () => {
    await engine.syncNow();
    server.online = false;
    await pos.openShift("0");
    await sellOne("sale-a");
    await sellOne("sale-b"); // 2 of the 20 allocated, not synced yet

    // Asked to release more than is left: only what is still unsold here.
    const statements = await releaseStatements(db, CORNED_BEEF.id, "25.0000", now);
    expect(JSON.parse(String(statements[1].params![2]))).toEqual({ sku_id: CORNED_BEEF.id, quantity: "18" });

    // During a sync, the release is queued after the sales and pushed in the same cycle.
    server.online = true;
    server.excess = [{ sku_id: CORNED_BEEF.id, quantity: "5.0000" }];
    expect((await engine.syncNow()).outcome).toBe("ok");
    const release = [...server.applied.values()].find((o) => o.type === "allocation.release")!;
    expect(release.payload).toEqual({ sku_id: CORNED_BEEF.id, quantity: "5" });
    expect(release.local_seq).toBe(4); // after the shift and both sales
    expect((await engine.refreshStatus()).pending).toBe(0);
  });

  it("keeps a sync history", async () => {
    await engine.syncNow();
    server.online = false;
    await engine.syncNow();
    const log = await db.select<{ outcome: string; message: string | null }>("SELECT outcome, message FROM sync_log ORDER BY id");
    expect(log.map((l) => l.outcome)).toEqual(["ok", "offline"]);
    expect(log[1].message).toBe("Cannot reach the Compriva server.");
  });

  it("retries with exponential backoff and jitter, capped at five minutes", () => {
    expect([1, 2, 3, 4].map((n) => backoffDelay(n, () => 1))).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(backoffDelay(20, () => 1)).toBe(MAX_DELAY_MS);
    expect(backoffDelay(1, () => 0)).toBe(2_500);
  });
});
