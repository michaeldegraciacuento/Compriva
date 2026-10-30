// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";

import { addItem } from "../pos/cart";
import type { CartLine } from "../pos/types";
import { snapshotStatements } from "./catalog-cache";
import { LocalPos, type LocalUser } from "./local-pos";
import { META, setMeta } from "./meta";
import { CORNED_BEEF, JUAN, MARIA_ID, snapshot, verifyPin } from "./testing/fixtures";
import { createTestDatabase } from "./testing/node-database";

let db: ReturnType<typeof createTestDatabase>;
let user: LocalUser | null;
let now: Date;
let pos: LocalPos;
let saleCounter = 0;

beforeEach(async () => {
  db = createTestDatabase();
  now = new Date("2026-10-30T02:00:00Z");
  await db.transaction([...snapshotStatements(snapshot(), 10, now), setMeta(META.lastSuccess, now.toISOString())]);
  user = JUAN;
  pos = new LocalPos({ db, user: () => user, verifyPin, now: () => now });
});

function cart(quantity: string, unitId = "u-pc", extra: Partial<CartLine> = {}): CartLine[] {
  const [line] = addItem([], CORNED_BEEF, { unitId });
  return [{ ...line, quantity, ...extra }];
}

const sell = (lines: CartLine[], payments: { method: string; amount: string; reference?: string }[], extra: Record<string, unknown> = {}) =>
  pos.checkout({ id: `sale-${++saleCounter}`, lines, discount: null, payments, expectedTotal: "", ...extra });

async function outbox() {
  return db.select<{ local_seq: number; type: string; status: string; payload: string }>("SELECT local_seq, type, status, payload FROM sync_outbox ORDER BY local_seq");
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected the call to be refused");
}

describe("local checkout (offline)", () => {
  it("saves the sale with its outbox operation and uses the terminal's allocation", async () => {
    await pos.openShift("1000");
    const sale = await sell(cart("2"), [{ method: "cash", amount: "100" }]);

    expect(sale).toMatchObject({ receipt_number: "T01-000001", grand_total: "100.00", vat_amount: "10.71", change_due: "0.00", status: "completed" });
    expect(sale.items?.[0]).toMatchObject({ product_name: "Corned Beef 150g", quantity: "2", line_total: "100.00" });

    const ops = await outbox();
    expect(ops.map((o) => [o.local_seq, o.type, o.status])).toEqual([[1, "shift.opened", "pending"], [2, "sale.completed", "pending"]]);
    const payload = JSON.parse(ops[1].payload);
    expect(payload).toMatchObject({ id: sale.id, receipt_sequence: 1, cashier_id: JUAN.id, totals: { grand_total: "100.00" } });
    expect(payload.lines[0]).toMatchObject({ sku_id: CORNED_BEEF.id, factor: "1.000000", unit_price: "50.0000", regular_unit_price: "50.0000" });

    expect(await pos.available(CORNED_BEEF.id)).toBe(BigInt(18 * 10_000));
    const [found] = await pos.catalog({ barcode: "4800000000019" });
    expect(found.stock.available).toBe("18");
  });

  it("a box barcode adds the box, and selling beyond the allocation is refused without writing anything", async () => {
    await pos.openShift("0");
    const [box] = await pos.catalog({ barcode: "BOX-CB" });
    expect(box.matched_unit_id).toBe("u-box");

    const error = await rejection(sell(cart("2", "u-box"), [{ method: "cash", amount: "1100" }])); // 24 pieces, only 20 allocated
    expect(error.code).toBe("INSUFFICIENT_STOCK");
    expect(error.message).toMatch(/20 left/);
    expect(await db.select("SELECT * FROM sales")).toHaveLength(0);
    expect((await outbox()).map((o) => o.type)).toEqual(["shift.opened"]);
  });

  it("a power cut before commit leaves no half-saved sale", async () => {
    await pos.openShift("0");
    db.failNextTransaction();
    await expect(sell(cart("1"), [{ method: "cash", amount: "50" }])).rejects.toThrow(/power cut/);

    expect(await db.select("SELECT * FROM sales")).toHaveLength(0);
    expect(await db.select("SELECT * FROM sale_consumption")).toHaveLength(0);
    expect(await outbox()).toHaveLength(1);
  });

  it("the same sale submitted twice is saved once", async () => {
    await pos.openShift("0");
    const input = { id: "sale-twice", lines: cart("1"), discount: null, payments: [{ method: "cash", amount: "50" }], expectedTotal: "50.00" };
    const first = await pos.checkout(input);
    const second = await pos.checkout(input);
    expect(second.receipt_number).toBe(first.receipt_number);
    expect(await db.select("SELECT * FROM sales")).toHaveLength(1);
  });

  it("a discount needs a manager's PIN, checked against the cached hashes", async () => {
    await pos.openShift("0");
    const discounted = cart("2", "u-pc", { discount: { type: "percentage", value: "10" } });

    expect((await rejection(sell(discounted, [{ method: "cash", amount: "90" }]))).code).toBe("APPROVAL_REQUIRED");
    const wrong = await rejection(sell(discounted, [{ method: "cash", amount: "90" }], { approval: { login: "maria", secret: "000000" } }));
    expect(wrong.details.reason).toBe("invalid_approver");

    const sale = await sell(discounted, [{ method: "cash", amount: "90" }], { approval: { login: "Maria", secret: "246810" } });
    expect(sale.grand_total).toBe("90.00");
    expect(JSON.parse((await outbox())[1].payload).approved_by).toBe(MARIA_ID);
  });

  it("payments follow the server's rules", async () => {
    await pos.openShift("0");
    expect((await rejection(sell(cart("2"), [{ method: "cash", amount: "99.99" }]))).message).toBe("₱0.01 is still due.");
    expect((await rejection(sell(cart("2"), [{ method: "gcash", amount: "100" }]))).message).toMatch(/reference number/);
    const split = await sell(cart("2"), [{ method: "gcash", amount: "60", reference: "GC-1" }, { method: "cash", amount: "50" }]);
    expect(split.payments?.map((p) => [p.method, p.amount, p.change_amount])).toEqual([["gcash", "60.00", "0.00"], ["cash", "40.00", "10.00"]]);
  });

  it("a void gives the stock back to the terminal and is queued", async () => {
    await pos.openShift("0");
    const sale = await sell(cart("5"), [{ method: "cash", amount: "250" }]);
    expect(await pos.available(CORNED_BEEF.id)).toBe(BigInt(15 * 10_000));

    expect((await rejection(pos.voidSale(sale.id, "Mistake"))).code).toBe("APPROVAL_REQUIRED");
    const voided = await pos.voidSale(sale.id, "Mistake", { login: "maria", secret: "246810" });
    expect(voided.status).toBe("voided");
    expect(voided.void?.voided_by).toBe("Maria Santos");
    expect(await pos.available(CORNED_BEEF.id)).toBe(BigInt(20 * 10_000));
    expect((await outbox()).map((o) => o.type)).toEqual(["shift.opened", "sale.completed", "sale.voided"]);
  });

  it("closing the shift counts the drawer against the expected cash", async () => {
    await pos.openShift("1000");
    await sell(cart("2"), [{ method: "cash", amount: "100" }]);
    await sell(cart("1"), [{ method: "gcash", amount: "50", reference: "GC-2" }]);
    await pos.cashMovement({ type: "cash_in", amount: "200", reason: "Coins", approval: { login: "maria", secret: "246810" } });

    expect((await pos.fetchShift())?.summary?.expected_cash).toBe("1300.00");
    const closed = await pos.closeShift("1290");
    expect(closed).toMatchObject({ status: "closed", expected_cash: "1300.00", counted_cash: "1290.00", cash_variance: "-10.00" });
    const last = (await outbox()).at(-1)!;
    expect(last.type).toBe("shift.closed");
    expect(JSON.parse(last.payload)).toMatchObject({ expected_cash: "1300.00", counted_cash: "1290.00" });
    expect((await rejection(sell(cart("1"), [{ method: "cash", amount: "50" }]))).code).toBe("SHIFT_REQUIRED");
  });

  it("stops selling when the terminal has not synced for too long", async () => {
    await pos.openShift("0");
    now = new Date(now.getTime() + 73 * 3_600_000);
    expect((await rejection(sell(cart("1"), [{ method: "cash", amount: "50" }]))).details.reason).toBe("offline_limit");
  });

  it("receipt numbers continue after the last number the server has seen", async () => {
    await db.transaction([setMeta(META.receiptFloor, "41")]);
    await pos.openShift("0");
    expect((await sell(cart("1"), [{ method: "cash", amount: "50" }])).receipt_number).toBe("T01-000042");
  });

  it("only the signed-in cashier's own open shift can sell", async () => {
    expect((await rejection(sell(cart("1"), [{ method: "cash", amount: "50" }]))).code).toBe("SHIFT_REQUIRED");
    await pos.openShift("0");
    user = { id: MARIA_ID, name: "Maria Santos", permissions: ["pos.access"] };
    expect((await rejection(sell(cart("1"), [{ method: "cash", amount: "50" }]))).code).toBe("SHIFT_REQUIRED");
  });
});
