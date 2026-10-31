// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";

import { addItem } from "../pos/cart";
import { LocalPos } from "./local-pos";
import { META, getMeta } from "./meta";
import { SyncEngine, type SyncApi } from "./sync-engine";
import { createTestDatabase } from "./testing/node-database";
import type { CachedItem } from "./types";

/**
 * Two desktop terminals against the REAL Laravel API (php artisan serve on :8000,
 * seeded demo data). Each terminal has its own SQLite database (the real
 * migrations), the real LocalPos and SyncEngine; only the HTTP transport is a
 * small fetch client. Run with: npm run test:sync
 *
 * Scenario: a new product with 20 in stock. Both terminals sync and end with
 * equal shares (90% of 20 split between the syncing terminals). Both go
 * offline; T-A sells its whole share and is refused one more; T-B sells all but
 * one. Back online, both sync: every sale on the server exactly once (even
 * though T-A's first push "times out"), stock exact, no conflicts.
 */
const API = process.env.COMPRIVA_API_URL ?? "http://127.0.0.1:8000/api/v1";
// `npm run test:sync` (vitest --mode sync) or COMPRIVA_SYNC_IT=1; skipped in the normal unit test run.
const run = process.env.COMPRIVA_SYNC_IT === "1" || import.meta.env.MODE === "sync";

async function call<T>(method: string, path: string, token: string, body?: unknown, installId?: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(installId ? { "X-Compriva-Device": installId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as { data: T; error?: { code: string; message: string } };
  if (!response.ok) throw new ApiError({ code: (json.error?.code ?? "SERVER_ERROR") as never, message: json.error?.message ?? response.statusText, status: response.status });
  return json.data;
}

/** A terminal: its own database, POS and sync engine; `online` switches its network. */
function terminal(installId: string, deviceToken: string, user: { id: string; name: string; permissions: string[] }, skuId: string) {
  const db = createTestDatabase();
  const net = { online: true, dropNextPushResponse: false };
  const offline = () => {
    if (!net.online) throw new ApiError({ code: "NETWORK_ERROR", message: "Cannot reach the Compriva server." });
  };
  const api: SyncApi = {
    async push(operations) {
      offline();
      const result = await call<{ results: never[] }>("POST", "/sync/operations", deviceToken, { operations }, installId);
      if (net.dropNextPushResponse) {
        net.dropNextPushResponse = false;
        throw new ApiError({ code: "TIMEOUT", message: "The server took too long to answer." }); // applied, but the answer was lost
      }
      return result.results;
    },
    async pull(cursor) {
      offline();
      return call("GET", `/sync/changes${cursor === null ? "" : `?cursor=${cursor}`}`, deviceToken, undefined, installId);
    },
    async topUp() {
      offline();
      // Only the test product, so the demo stock is left alone.
      return call("POST", "/sync/allocations/top-up", deviceToken, { sku_ids: [skuId] }, installId);
    },
  };
  const engine = new SyncEngine({ db, api });
  const pos = new LocalPos({ db, user: () => user, verifyPin: async () => false });
  return { db, net, engine, pos };
}

describe.skipIf(!run)("two desktop terminals, offline, against the real API", () => {
  let owner: string;
  let skuId: string;
  const devices: string[] = [];
  let cashier: { id: string; name: string; permissions: string[] };

  beforeAll(async () => {
    owner = (await call<{ token: string }>("POST", "/auth/token", "", { login: "owner", password: "password" }).catch(async () => {
      const response = await fetch(`${API}/auth/token`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ login: "owner", password: "password" }) });
      return ((await response.json()) as { data: { token: string } }).data;
    })).token;
    const me = await call<{ user: { id: string; name: string }; permissions: string[] }>("GET", "/auth/me", owner);
    cashier = { id: me.user.id, name: me.user.name, permissions: me.permissions };

    const units = await call<{ id: string; code: string }[]>("GET", "/units", owner);
    const taxes = await call<{ id: string; code: string }[]>("GET", "/tax-rates", owner);
    const product = await call<{ id: string; skus: { id: string }[] }>("POST", "/products", owner, {
      name: `IT Sync Sardines ${Date.now()}`,
      tax_rate_id: taxes.find((t) => t.code === "VAT12")!.id,
      skus: [{ base_unit_id: units.find((u) => u.code === "pc")!.id, price: "25.00", cost_price: "18.00" }],
    });
    skuId = product.skus[0].id;
    await call("POST", "/inventory/stock-in", owner, { reason: "received", lines: [{ product_sku_id: skuId, quantity: "20", unit_cost: "18" }] });
  });

  afterAll(async () => {
    // Retire the test terminals so later runs and the demo are not affected.
    for (const id of devices) await call("POST", `/devices/${id}/revoke`, owner).catch(() => undefined);
  });

  it("sells offline within each terminal's allocation and syncs every sale once", async () => {
    const setUp = async (name: string) => {
      const installId = crypto.randomUUID();
      const registered = await call<{ id: string }>("POST", "/pos/terminal", owner, { name }, installId);
      devices.push(registered.id);
      const { token } = await call<{ token: string }>("POST", "/pos/terminal/sync-token", owner, {}, installId);
      return terminal(installId, token, cashier, skuId);
    };
    const a = await setUp("IT lane A");
    const b = await setUp("IT lane B");

    // A syncs first and takes its share; B joins; A is told it holds more than its share and
    // releases the excess; B picks it up. The shares end equal. (Other active desktop terminals,
    // e.g. a real one set up on this computer, also count, so the share is read, not assumed.)
    expect((await a.engine.syncNow()).outcome).toBe("ok");
    expect((await b.engine.syncNow()).outcome).toBe("ok");
    expect((await a.engine.syncNow()).outcome).toBe("ok");
    expect((await b.engine.syncNow()).outcome).toBe("ok");
    const shareA = Number((await a.pos.available(skuId)) / BigInt(10_000));
    const shareB = Number((await b.pos.available(skuId)) / BigInt(10_000));
    expect(shareA).toBe(shareB);
    expect(shareA).toBeGreaterThanOrEqual(2);
    expect(shareA * 2).toBeLessThanOrEqual(18); // never more than 90% of the 20 in stock

    const [itemA] = (await a.pos.catalog({ q: "IT Sync Sardines" })).filter((i) => i.id === skuId) as CachedItem[];
    const sell = (pos: LocalPos, id: string, quantity: number) =>
      pos.checkout({ id, lines: [{ ...addItem([], itemA)[0], quantity: String(quantity) }], discount: null, payments: [{ method: "cash", amount: String(25 * quantity) }], expectedTotal: "" });

    // Offline: A sells its whole share in two sales and is refused one more; B sells all but one.
    a.net.online = false;
    b.net.online = false;
    await a.pos.openShift("500");
    await b.pos.openShift("500");
    await sell(a.pos, crypto.randomUUID(), Math.ceil(shareA / 2));
    await sell(a.pos, crypto.randomUUID(), Math.floor(shareA / 2));
    await expect(sell(a.pos, crypto.randomUUID(), 1)).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    await sell(b.pos, crypto.randomUUID(), shareB - 1);
    expect((await a.engine.syncNow()).outcome).toBe("offline");
    expect((await a.engine.refreshStatus()).pending).toBe(3);

    // Back online. A's first push is applied but its answer is lost: the retry gets duplicates.
    a.net.online = true;
    b.net.online = true;
    a.net.dropNextPushResponse = true;
    expect((await a.engine.syncNow()).outcome).toBe("offline");
    const retry = await a.engine.syncNow();
    expect(retry).toMatchObject({ outcome: "ok", rejected: 0 });
    expect(await b.engine.syncNow()).toMatchObject({ outcome: "ok", rejected: 0 });

    // The server: every sale counted exactly once, nothing flagged.
    const sold = shareA + shareB - 1;
    const stock = await call<{ quantity_on_hand: string }[]>("GET", `/inventory/stock?q=${encodeURIComponent("IT Sync Sardines")}&include_inactive=1`, owner);
    const level = (stock as unknown as { sku_id: string; quantity_on_hand: string }[]).find((s) => s.sku_id === skuId)!;
    expect(level.quantity_on_hand).toBe(`${20 - sold}.0000`);
    const conflicts = await call<{ terminal: string }[]>("GET", "/sync/conflicts", owner);
    const terminals = await call<{ id: string; code: string; operations_applied: number }[]>("GET", "/terminals", owner);
    const ours = terminals.filter((t) => devices.includes(t.id));
    expect(conflicts.filter((c) => ours.some((t) => t.code === c.terminal))).toHaveLength(0);
    // Every operation applied: A's shift + 2 sales (+ releases), B's shift + sale (+ releases).
    const applied = (id: string) => ours.find((t) => t.id === id)!.operations_applied;
    expect(applied(devices[0])).toBeGreaterThanOrEqual(3);
    expect(applied(devices[1])).toBeGreaterThanOrEqual(2);

    // Close both shifts and sync, so the test leaves no open shift behind.
    await a.pos.closeShift("700");
    await b.pos.closeShift("600");
    expect((await a.engine.syncNow()).rejected).toBe(0);
    expect((await b.engine.syncNow()).rejected).toBe(0);

    // Each terminal's cursor moved on; its allocation was re-pulled from the server.
    expect(Number(await getMeta(a.db, META.cursor))).toBeGreaterThan(0);
    expect(await a.pos.available(skuId)).toBeGreaterThanOrEqual(BigInt(0));
  }, 120_000);
});
