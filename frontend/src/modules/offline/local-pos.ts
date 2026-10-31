import { ApiError } from "@/lib/api";
import { uuidv7 } from "@/lib/ids";
import type { LocalDatabase, SqlStatement } from "@/platform/types";

import { createCustomer } from "../customers/api";
import type { CustomerInput } from "../customers/types";
import type { CheckoutInput } from "../pos/api";
import { toPosCustomer, type PosBackend } from "../pos/backend";
import { lineUnit, priceCart } from "../pos/cart";
import { cents, format, formatUnits, normalizeAmount, parse, sum, ZERO } from "../pos/fixed-point";
import { applyTenders } from "../pos/tender";
import type { Approval, CashMovement, CashMovementType, PaymentMethod, PosBootstrap, PosCustomer, PosItem, PresetDiscount, Sale, SaleItem, Shift, ShiftSummary, Terminal } from "../pos/types";
import { availableFor } from "./allocations";
import { customerStatement } from "./catalog-cache";
import { baseQuantity, getJson, getList, getMeta, META } from "./meta";
import { enqueue } from "./outbox";
import type { CachedItem, TerminalSettings } from "./types";

/** Who is signed in at the terminal (online or with an offline PIN). */
export interface LocalUser {
  id: string;
  name: string;
  permissions: string[];
}

export interface LocalPosDeps {
  db: LocalDatabase;
  user: () => LocalUser | null;
  verifyPin: (pin: string, hash: string) => Promise<boolean>;
  now?: () => Date;
  /** Called after every local write, to start a background sync. */
  onChange?: () => void;
}

interface ShiftRow {
  id: string;
  cashier_id: string;
  cashier_name: string;
  status: "open" | "closed";
  opening_float: string;
  opened_at: string;
  closed_at: string | null;
  data: string;
}

const fail = (code: ConstructorParameters<typeof ApiError>[0]["code"], message: string, status: number, details: Record<string, unknown> = {}): never => {
  throw new ApiError({ code, message, status, details });
};

/**
 * The desktop terminal's point of sale, on its local SQLite database. It works
 * the same with or without internet: every change is written locally together
 * with its sync outbox operation, in one transaction, before success is shown.
 * The same calculator and payment rules as the server are used, and the server
 * validates everything again when the operations sync (docs/README.md).
 *
 * Terminals sell only the stock allocated to them (§6): a line beyond the
 * terminal's remaining allocation is refused unless the store allows it.
 */
export class LocalPos implements PosBackend {
  readonly kind = "local" as const;
  private readonly db: LocalDatabase;
  private readonly now: () => Date;

  constructor(private readonly deps: LocalPosDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
  }

  // --- Reference data ------------------------------------------------------------

  private async terminal(): Promise<Terminal> {
    return (await getJson<Terminal>(this.db, META.terminal)) ?? fail("TERMINAL_REQUIRED", "This terminal has not been set up yet.", 409);
  }

  private async settings(): Promise<TerminalSettings> {
    return (await getList<TerminalSettings>(this.db, "settings")) ?? fail("TERMINAL_REQUIRED", "This terminal has not downloaded its data yet.", 409);
  }

  private signedIn(): LocalUser {
    return this.deps.user() ?? fail("UNAUTHENTICATED", "Sign in to use the POS.", 401);
  }

  async bootstrap(): Promise<PosBootstrap> {
    const settings = await this.settings();
    return {
      install_id: null,
      terminal: await this.terminal(),
      can_register: false,
      shift: await this.openShiftRow().then((row) => (row ? this.shiftFrom(row, false) : null)),
      payment_methods: (await getList<PaymentMethod[]>(this.db, "payment_methods")) ?? [],
      discounts: (await getList<PresetDiscount[]>(this.db, "discounts")) ?? [],
      categories: (await getList<{ id: string; name: string }[]>(this.db, "categories")) ?? [],
      receipt: settings.receipt,
      pos: { max_cash_in_drawer: settings.pos.max_cash_in_drawer ?? "0" },
    };
  }

  async registerTerminal(): Promise<void> {
    fail("CONFLICT", "This terminal is already set up.", 409);
  }

  async catalog(params: { q?: string; barcode?: string; category_id?: string }): Promise<PosItem[]> {
    const toItems = (rows: { data: string }[]) => rows.map((r) => this.withAllocation(JSON.parse(r.data) as CachedItem));

    if (params.barcode) {
      const rows = await this.db.select<{ data: string; unit_id: string | null }>(
        "SELECT i.data, b.unit_id FROM catalog_barcodes b JOIN catalog_items i ON i.sku_id = b.sku_id WHERE b.barcode = $1", [params.barcode]);
      const items = await Promise.all(toItems(rows));
      return items.map((item, i) => ({ ...item, matched_unit_id: rows[i].unit_id }));
    }
    const term = (params.q ?? "").trim().toLowerCase();
    const rows = await this.db.select<{ data: string }>(
      `SELECT data FROM catalog_items
       WHERE ($1 = '' OR search LIKE $2 OR sku_id IN (SELECT sku_id FROM catalog_barcodes WHERE barcode = $3))
         AND ($4 = '' OR category_id = $4)
       ORDER BY name LIMIT 60`,
      [term, `%${term.replace(/[%_]/g, "")}%`, params.q ?? "", params.category_id ?? ""]);
    return Promise.all(toItems(rows));
  }

  // --- Customers -----------------------------------------------------------------

  async customers(q: string): Promise<PosCustomer[]> {
    const term = q.trim().toLowerCase().replace(/[%_]/g, "");
    const rows = await this.db.select<{ data: string }>(
      "SELECT data FROM customers WHERE ($1 = '' OR search LIKE $2) ORDER BY name LIMIT 20", [term, `%${term}%`]);
    return rows.map((r) => JSON.parse(r.data) as PosCustomer);
  }

  /** New customers are created on the server (they need a code and must be unique); cached at once. */
  async createCustomer(input: CustomerInput): Promise<PosCustomer> {
    const customer = toPosCustomer(await createCustomer(input));
    await this.db.transaction([customerStatement(customer)]);
    return customer;
  }

  /** On the terminal, "stock" is what it may still sell: its allocation minus unsynced sales. */
  private async withAllocation(item: CachedItem): Promise<PosItem> {
    const available = item.stock.tracked ? formatUnits(await this.available(item.id)) : item.stock.available;
    return { ...item, stock: { ...item.stock, on_hand: available, available } };
  }

  /** Allocation remaining per the server, minus what local operations not yet synced have used. */
  available(skuId: string): Promise<bigint> {
    return availableFor(this.db, skuId);
  }

  // --- Shifts --------------------------------------------------------------------

  private async openShiftRow(): Promise<ShiftRow | null> {
    const [row] = await this.db.select<ShiftRow>("SELECT * FROM shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1");
    return row ?? null;
  }

  private async shiftFrom(row: ShiftRow, withSummary = true): Promise<Shift> {
    const data = JSON.parse(row.data) as Omit<Shift, "summary" | "cash_movements">;
    const movements = (await this.db.select<{ data: string }>("SELECT data FROM cash_movements WHERE shift_id = $1 ORDER BY rowid", [row.id]))
      .map((m) => JSON.parse(m.data) as CashMovement);
    return { ...data, cash_movements: movements, summary: withSummary ? await this.summary(row) : null };
  }

  private async summary(row: ShiftRow): Promise<ShiftSummary> {
    const sales = (await this.db.select<{ status: string; data: string }>("SELECT status, data FROM sales WHERE shift_id = $1", [row.id]))
      .map((s) => ({ status: s.status, sale: JSON.parse(s.data) as Sale }));
    const completed = sales.filter((s) => s.status === "completed").map((s) => s.sale);
    const payments: ShiftSummary["payments"] = {};
    for (const payment of completed.flatMap((s) => s.payments ?? [])) {
      const current = payments[payment.method] ?? { count: 0, total: "0.00" };
      payments[payment.method] = { count: current.count + 1, total: format(cents(current.total) + cents(payment.amount)) };
    }
    const movements = await this.db.select<{ type: CashMovementType; amount: string }>("SELECT type, amount FROM cash_movements WHERE shift_id = $1", [row.id]);
    const cashIn = sum(movements.filter((m) => m.type === "cash_in").map((m) => cents(m.amount)));
    const cashOut = sum(movements.filter((m) => m.type !== "cash_in").map((m) => cents(m.amount)));
    const cashSales = cents(payments.cash?.total ?? "0");
    return {
      sales_count: completed.length,
      voided_count: sales.length - completed.length,
      sales_total: format(sum(completed.map((s) => cents(s.grand_total)))),
      payments,
      refunds: {},
      refunds_total: "0.00",
      opening_float: row.opening_float,
      cash_sales: format(cashSales),
      cash_refunds: "0.00",
      cash_in: format(cashIn),
      cash_out: format(cashOut),
      expected_cash: format(cents(row.opening_float) + cashSales + cashIn - cashOut),
    };
  }

  async fetchShift(): Promise<Shift | null> {
    const row = await this.openShiftRow();
    return row ? this.shiftFrom(row) : null;
  }

  async openShift(openingFloat: string): Promise<Shift> {
    const user = this.signedIn();
    if (!user.permissions.includes("cashier.shift")) fail("FORBIDDEN", "You may not open a shift.", 403);
    const existing = await this.openShiftRow();
    if (existing) fail("CONFLICT", `A shift is already open on this terminal (${existing.cashier_name}). Close it first.`, 409);

    const terminal = await this.terminal();
    const at = this.now().toISOString();
    const shift: Omit<Shift, "summary" | "cash_movements"> = {
      id: uuidv7(), status: "open", terminal, cashier: { id: user.id, name: user.name },
      opening_float: normalizeAmount(openingFloat) ?? fail("VALIDATION_FAILED", "Enter the opening cash.", 422),
      expected_cash: null, counted_cash: null, cash_variance: null, opened_at: at, closed_at: null, closed_by: null, notes: null,
    };
    const op = enqueue("shift.opened", { shift_id: shift.id, cashier_id: user.id, opening_float: shift.opening_float, opened_at: at }, undefined, this.now());
    await this.commit([
      { sql: "INSERT INTO shifts (id, cashier_id, cashier_name, status, opening_float, opened_at, data) VALUES ($1, $2, $3, 'open', $4, $5, $6)",
        params: [shift.id, user.id, user.name, shift.opening_float, at, JSON.stringify(shift)] },
      op.statement,
    ]);
    return { ...shift, cash_movements: [], summary: null };
  }

  async closeShift(countedCash: string, notes?: string | null): Promise<Shift> {
    const user = this.signedIn();
    const row = (await this.openShiftRow()) ?? fail("SHIFT_REQUIRED", "There is no open shift on this terminal.", 409);
    if (row.cashier_id !== user.id && !user.permissions.includes("cashier.manage_shifts")) fail("FORBIDDEN", "Only the cashier or a manager can close this shift.", 403);

    const summary = await this.summary(row);
    const counted = normalizeAmount(countedCash) ?? fail("VALIDATION_FAILED", "Enter the cash counted.", 422);
    const at = this.now().toISOString();
    const closed = {
      ...(JSON.parse(row.data) as Omit<Shift, "summary" | "cash_movements">),
      status: "closed" as const, expected_cash: summary.expected_cash, counted_cash: counted,
      cash_variance: format(cents(counted) - cents(summary.expected_cash)), closed_at: at, closed_by: user.name, notes: notes ?? null,
    };
    const op = enqueue("shift.closed", { shift_id: row.id, closed_by: user.id, counted_cash: counted, expected_cash: summary.expected_cash, closed_at: at, notes: notes ?? null }, undefined, this.now());
    await this.commit([
      { sql: "UPDATE shifts SET status = 'closed', closed_at = $2, data = $3 WHERE id = $1 AND status = 'open'", params: [row.id, at, JSON.stringify(closed)] },
      op.statement,
    ]);
    return { ...closed, cash_movements: [], summary };
  }

  async cashMovement(input: { type: CashMovementType; amount: string; reason: string; approval?: Approval | null }): Promise<Shift> {
    const user = this.signedIn();
    const row = (await this.openShiftRow()) ?? fail("SHIFT_REQUIRED", "There is no open shift on this terminal.", 409);
    if (row.cashier_id !== user.id && !user.permissions.includes("cashier.manage_shifts")) fail("FORBIDDEN", "Only the cashier of this shift or a manager can record cash movements.", 403);
    const approver = await this.approve(["cashier.cash_movements"], input.approval ?? null);
    const amount = normalizeAmount(input.amount) ?? fail("VALIDATION_FAILED", "Enter an amount.", 422);
    if (input.type !== "cash_in") {
      const inDrawer = (await this.summary(row)).expected_cash;
      if (cents(amount) > cents(inDrawer)) fail("VALIDATION_FAILED", `Only ₱${inDrawer} should be in the drawer.`, 422, { fields: { amount: [`Only ₱${inDrawer} should be in the drawer.`] } });
    }

    const at = this.now().toISOString();
    const movement: CashMovement = { id: uuidv7(), type: input.type, amount, reason: input.reason, performed_by: user.name, occurred_at: at };
    const op = enqueue("cash.movement", {
      id: movement.id, shift_id: row.id, type: input.type, amount, reason: input.reason, performed_by: user.id, approved_by: approver, occurred_at: at,
    }, undefined, this.now());
    await this.commit([
      { sql: "INSERT INTO cash_movements (id, shift_id, type, amount, data) VALUES ($1, $2, $3, $4, $5)", params: [movement.id, row.id, input.type, amount, JSON.stringify(movement)] },
      op.statement,
    ]);
    return this.shiftFrom((await this.openShiftRow())!);
  }

  // --- Sales ---------------------------------------------------------------------

  async checkout(input: CheckoutInput): Promise<Sale> {
    const user = this.signedIn();
    const existing = await this.db.select<{ data: string }>("SELECT data FROM sales WHERE id = $1", [input.id]);
    if (existing.length > 0) return JSON.parse(existing[0].data) as Sale; // a double click: the sale is already saved

    const shift = await this.openShiftRow();
    if (!shift || shift.cashier_id !== user.id) fail("SHIFT_REQUIRED", "Open your shift on this terminal before selling.", 409);
    const settings = await this.settings();
    await this.assertWithinOfflineLimit(settings);

    const priced = priceCart(input.lines, input.discount);
    if (input.expectedTotal && cents(input.expectedTotal) !== cents(priced.totals.grand_total)) {
      fail("TOTAL_MISMATCH", `The total changed to ₱${priced.totals.grand_total}. Check the cart and take payment again.`, 409);
    }
    if (input.discount?.kind === "preset" && input.discount.preset.requires_customer_id && !input.discount.customerIdNumber) {
      fail("VALIDATION_FAILED", `Enter the customer's ID number for ${input.discount.preset.name}.`, 422);
    }
    const approver = await this.approve(priced.permissions, input.approval ?? null);

    // Payments: the same rules as the server (only cash gives change; e-wallets need a reference).
    const methods = (await getList<PaymentMethod[]>(this.db, "payment_methods")) ?? [];
    const byCode = new Map(methods.map((m) => [m.code, m]));
    for (const payment of input.payments) {
      const method = byCode.get(payment.method) ?? fail("VALIDATION_FAILED", "This payment method is not accepted.", 422);
      if (method.requires_reference && !payment.reference?.trim()) fail("VALIDATION_FAILED", `Enter the ${method.name} reference number.`, 422);
    }
    const tender = applyTenders(priced.totals.grand_total, input.payments.map((p) => ({ allowsChange: byCode.get(p.method)!.allows_change, amount: p.amount })));
    if (cents(priced.totals.grand_total) > ZERO && tender.problem) fail("VALIDATION_FAILED", tender.problem, 422);

    // Stock: only what is allocated to this terminal.
    const usage = new Map<string, bigint>();
    for (const line of priced.lines) {
      if (!line.item.stock.tracked) continue;
      usage.set(line.item.id, (usage.get(line.item.id) ?? ZERO) + parse(baseQuantity(line.quantity, line.unit.factor)));
    }
    if (!settings.pos.allow_over_allocation) {
      for (const [skuId, quantity] of usage) {
        const available = await this.available(skuId);
        if (quantity > available) {
          const name = priced.lines.find((l) => l.item.id === skuId)!.item.name;
          fail("INSUFFICIENT_STOCK", `Not enough ${name} allocated to this terminal: ${formatUnits(available > ZERO ? available : ZERO)} left. Sync to get more stock.`, 422, { sku_id: skuId });
        }
      }
    }

    const terminal = await this.terminal();
    const sequence = await this.nextReceiptSequence();
    const receiptNumber = `${terminal.code}-${String(sequence).padStart(6, "0")}`;
    const at = this.now().toISOString();
    const operationId = uuidv7();
    const lineIds = priced.lines.map(() => uuidv7());

    // Change from the last cash tenders, exactly as TenderCalculator does on the server.
    let change = cents(tender.change);
    const tenders = input.payments.map((p) => ({ ...p, change: ZERO })).reverse().map((p) => {
      if (change > ZERO && byCode.get(p.method)!.allows_change) {
        const take = cents(p.amount) < change ? cents(p.amount) : change;
        change -= take;
        return { ...p, change: take };
      }
      return p;
    }).reverse();

    const payload = {
      id: input.id,
      receipt_number: receiptNumber,
      receipt_sequence: sequence,
      shift_id: shift!.id,
      cashier_id: user.id,
      occurred_at: at,
      customer_name: input.customerName || null,
      customer_id: input.customer?.id ?? null,
      approved_by: approver,
      lines: priced.lines.map((line, i) => ({
        id: lineIds[i],
        sku_id: line.item.id,
        unit_id: line.unit.unit.id,
        quantity: line.quantity,
        factor: line.unit.factor,
        regular_unit_price: line.unit.price,
        unit_price: line.unitPrice,
        product_name: line.item.name,
        sku_code: line.item.code,
        unit_name: line.unit.unit.name,
        barcode: line.barcode,
        tax: line.item.tax,
        discount: line.discount,
      })),
      discount: input.discount === null ? null : input.discount.kind === "preset"
        ? { discount_id: input.discount.preset.id, name: input.discount.preset.name, kind: input.discount.preset.kind, type: input.discount.preset.type,
            value: input.discount.preset.value, is_vat_exempt: input.discount.preset.is_vat_exempt, max_amount: input.discount.preset.max_amount,
            customer_id_number: input.discount.customerIdNumber, requires_approval: input.discount.preset.requires_approval }
        : { discount_id: null, name: "Manual discount", kind: "manual", type: input.discount.type, value: input.discount.value, is_vat_exempt: false, max_amount: null, customer_id_number: null },
      payments: input.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference ?? null })),
      totals: priced.totals,
    };

    const sale = this.receipt(payload, priced, tenders, terminal, user, settings, lineIds, input.customer ?? null);
    const op = enqueue("sale.completed", payload, operationId, this.now());
    await this.commit([
      { sql: "INSERT INTO sales (id, receipt_number, receipt_sequence, shift_id, status, grand_total, occurred_at, data) VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7)",
        params: [sale.id, receiptNumber, sequence, shift!.id, priced.totals.grand_total, at, JSON.stringify(sale)] },
      ...[...usage].map(([skuId, quantity]): SqlStatement => ({
        sql: "INSERT INTO sale_consumption (sale_id, operation_id, sku_id, base_quantity) VALUES ($1, $2, $3, $4)", params: [sale.id, operationId, skuId, formatUnits(quantity)],
      })),
      op.statement,
    ]);
    return sale;
  }

  async shiftSales(q?: string): Promise<Sale[]> {
    const shift = await this.openShiftRow();
    const rows = q
      ? await this.db.select<{ data: string }>("SELECT data FROM sales WHERE receipt_number LIKE $1 ORDER BY occurred_at DESC LIMIT 30", [`%${q}%`])
      : await this.db.select<{ data: string }>("SELECT data FROM sales WHERE shift_id = $1 ORDER BY occurred_at DESC LIMIT 30", [shift?.id ?? ""]);
    return rows.map((r) => JSON.parse(r.data) as Sale);
  }

  async fetchSale(id: string): Promise<Sale> {
    const [row] = await this.db.select<{ data: string }>("SELECT data FROM sales WHERE id = $1", [id]);
    return row ? (JSON.parse(row.data) as Sale) : fail("NOT_FOUND", "This sale is not on this terminal.", 404);
  }

  /** Voids a sale of the open shift; its stock goes back to this terminal. */
  async voidSale(id: string, reason: string, approval?: Approval | null): Promise<Sale> {
    const user = this.signedIn();
    const [row] = await this.db.select<{ data: string; status: string; shift_id: string }>("SELECT data, status, shift_id FROM sales WHERE id = $1", [id]);
    if (!row) fail("NOT_FOUND", "This sale is not on this terminal.", 404);
    const sale = JSON.parse(row.data) as Sale;
    if (row.status === "voided") fail("CONFLICT", `${sale.receipt_number} is already voided.`, 409);
    const shift = await this.openShiftRow();
    if (shift?.id !== row.shift_id) fail("CONFLICT", `${sale.receipt_number} belongs to a closed shift. Process a return instead (online).`, 409, { reason: "shift_closed" });
    const approver = await this.approve(["sales.void"], approval ?? null);

    const at = this.now().toISOString();
    const voided: Sale = { ...sale, status: "voided", void: { voided_at: at, voided_by: approver ? await this.nameOf(approver) : user.name, reason } };
    const operationId = uuidv7();
    const consumed = await this.db.select<{ sku_id: string; base_quantity: string }>("SELECT sku_id, base_quantity FROM sale_consumption WHERE sale_id = $1", [id]);
    const op = enqueue("sale.voided", { sale_id: id, requested_by: user.id, approved_by: approver, reason, voided_at: at }, operationId, this.now());
    await this.commit([
      { sql: "UPDATE sales SET status = 'voided', data = $2 WHERE id = $1 AND status = 'completed'", params: [id, JSON.stringify(voided)] },
      // Until the void syncs, give the goods back to this terminal's local allocation.
      ...consumed.map((c): SqlStatement => ({
        sql: "INSERT INTO sale_consumption (sale_id, operation_id, sku_id, base_quantity) VALUES ($1, $2, $3, $4)", params: [id, operationId, c.sku_id, formatUnits(-parse(c.base_quantity))],
      })),
      op.statement,
    ]);
    return voided;
  }

  // --- Helpers -------------------------------------------------------------------

  private async commit(statements: SqlStatement[]): Promise<void> {
    await this.db.transaction(statements);
    this.deps.onChange?.();
  }

  /**
   * Manager approval on the terminal: the cashier's own permissions, or a
   * manager's username and PIN checked against the cached (bcrypt) PIN hashes.
   * Returns the approver's user ID, or null when the cashier may do it.
   */
  private async approve(permissions: string[], approval: Approval | null): Promise<string | null> {
    const user = this.signedIn();
    const missing = permissions.filter((p) => !user.permissions.includes(p));
    if (missing.length === 0) return null;
    if (!approval?.login.trim() || !approval.secret) {
      fail("APPROVAL_REQUIRED", "This needs a manager's approval.", 403, { permission: missing[0] });
    }
    const [row] = await this.db.select<{ id: string; pin_hash: string; permissions: string }>(
      "SELECT id, pin_hash, permissions FROM cashiers WHERE username = $1", [approval!.login.trim().toLowerCase()]);
    const valid = row ? await this.deps.verifyPin(approval!.secret, row.pin_hash) : false;
    const allowed = row ? missing.every((p) => (JSON.parse(row.permissions) as string[]).includes(p)) : false;
    if (!valid || !allowed) {
      fail("APPROVAL_REQUIRED", "Approval refused: wrong username or PIN, or this user may not approve it.", 403, { permission: missing[0], reason: "invalid_approver" });
    }
    return row!.id;
  }

  private async nameOf(userId: string): Promise<string> {
    const [row] = await this.db.select<{ name: string }>("SELECT name FROM cashiers WHERE id = $1", [userId]);
    return row?.name ?? "Manager";
  }

  private async nextReceiptSequence(): Promise<number> {
    const [row] = await this.db.select<{ last: number | null }>("SELECT MAX(receipt_sequence) AS last FROM sales");
    const floor = Number((await getMeta(this.db, META.receiptFloor)) ?? 0);
    return Math.max(Number(row?.last ?? 0), floor) + 1;
  }

  /** Offline for too long (prices and cashiers may be stale): stop selling until the terminal syncs. */
  private async assertWithinOfflineLimit(settings: TerminalSettings): Promise<void> {
    const last = await getMeta(this.db, META.lastSuccess);
    if (last && this.now().getTime() - new Date(last).getTime() > settings.pos.max_offline_hours * 3_600_000) {
      fail("BUSINESS_RULE_VIOLATION", `This terminal has not synced for over ${settings.pos.max_offline_hours} hours. Connect to the internet and sync before selling.`, 409, { reason: "offline_limit" });
    }
  }

  /** The receipt, built from the same snapshot that is synced. */
  private receipt(
    payload: { id: string; receipt_number: string; shift_id: string; occurred_at: string; customer_name: string | null; discount: Record<string, unknown> | null },
    priced: ReturnType<typeof priceCart>,
    tenders: { method: string; amount: string; reference?: string | null; change: bigint }[],
    terminal: Terminal,
    user: LocalUser,
    settings: TerminalSettings,
    lineIds: string[],
    customer: PosCustomer | null = null,
  ): Sale {
    const t = priced.totals;
    const items: SaleItem[] = priced.lines.map((line, i) => ({
      id: lineIds[i], line_number: i + 1, sku_id: line.item.id, product_name: line.item.name, sku_code: line.item.code, barcode: line.barcode,
      unit_name: lineUnit(line).unit.name, quantity: line.quantity, regular_unit_price: line.unit.price, unit_price: line.unitPrice,
      price_overridden: line.priceOverride !== null, gross_amount: line.amounts.gross, discount_amount: line.amounts.discount,
      tax_code: line.item.tax.code, tax_type: line.amounts.vat_exempted ? "vat_exempt" : line.item.tax.type, tax_amount: line.amounts.tax,
      line_total: line.amounts.total, returned_quantity: "0",
    }));
    const vatExemption = priced.lines.filter((l) => l.amounts.vat_exempted)
      .reduce((total, l) => total + cents(l.amounts.gross) - cents(l.amounts.discount) - cents(l.amounts.total), ZERO);
    const saleDiscount = payload.discount;

    return {
      id: payload.id,
      receipt_number: payload.receipt_number,
      status: "completed",
      terminal: { id: terminal.id, code: terminal.code, name: terminal.name },
      cashier: { id: user.id, name: user.name },
      cashier_shift_id: payload.shift_id,
      occurred_at: payload.occurred_at,
      business_date: payload.occurred_at.slice(0, 10),
      // The same snapshot the server stores (SaleCustomer): name, TIN, a business's address.
      customer_id: customer?.id ?? null,
      customer_name: payload.customer_name ?? customer?.name ?? null,
      customer_tin: customer?.tin ?? null,
      customer_address: customer?.type === "business" ? customer.address : null,
      customer_id_number: (saleDiscount?.customer_id_number as string | null | undefined) ?? null,
      gross_amount: t.gross_amount,
      discount_total: t.discount_total,
      vat_exemption: format(vatExemption),
      vatable_sales: t.vatable_sales,
      vat_amount: t.vat_amount,
      vat_exempt_sales: t.vat_exempt_sales,
      zero_rated_sales: t.zero_rated_sales,
      grand_total: t.grand_total,
      amount_paid: format(sum(tenders.map((p) => cents(p.amount)))),
      change_due: format(sum(tenders.map((p) => p.change))),
      items_count: items.length,
      items,
      discounts: [
        ...priced.lines.filter((l) => l.discount).map((l) => ({
          id: `${lineIds[priced.lines.indexOf(l)]}-d`, sale_item_id: lineIds[priced.lines.indexOf(l)], name: "Item discount", kind: "manual", type: l.discount!.type, value: l.discount!.value,
          amount: l.amounts.item_discount, customer_id_number: null,
        })),
        ...(saleDiscount ? [{
          id: `${payload.id}-d`, sale_item_id: null, name: String(saleDiscount.name), kind: String(saleDiscount.kind), type: saleDiscount.type as "percentage" | "fixed_amount",
          value: String(saleDiscount.value), amount: format(sum(priced.lines.map((l) => cents(l.amounts.sale_discount)))),
          customer_id_number: (saleDiscount.customer_id_number as string | null) ?? null,
        }] : []),
      ],
      payments: tenders.map((p, i) => ({
        id: `${payload.id}-p${i}`, method: p.method, amount: format(cents(p.amount) - p.change), tendered_amount: format(cents(p.amount)),
        change_amount: format(p.change), reference_number: p.reference ?? null,
      })),
      returns: [],
      void: null,
      store: settings.store ? { ...settings.store } : undefined,
      receipt: settings.receipt,
      notes: null,
    };
  }
}
