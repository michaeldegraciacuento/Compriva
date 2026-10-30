import type { CashierSnapshot } from "@/modules/auth/types";

import type { CachedItem, Snapshot } from "../types";

const piece = { id: "u-pc", code: "pc", name: "Piece", allows_decimal: false };
const box = { id: "u-box", code: "box", name: "Box", allows_decimal: false };

export const CORNED_BEEF: CachedItem = {
  id: "sku-cb", product_id: "p-cb", name: "Corned Beef 150g", code: "SKU-0001", category_id: "cat-canned", image_url: null, base_unit_id: "u-pc",
  units: [{ unit: piece, factor: "1.000000", price: "50.0000" }, { unit: box, factor: "12.000000", price: "550.0000" }],
  matched_unit_id: null,
  tax: { id: "tax-vat", code: "VAT12", type: "vat", rate: "12.0000", inclusive: true },
  stock: { tracked: true, on_hand: "100.0000", available: "100.0000" },
  barcodes: [{ barcode: "4800000000019", unit_id: null }, { barcode: "BOX-CB", unit_id: "u-box" }],
};

export const JUAN = { id: "u-juan", name: "Juan Dela Cruz", permissions: ["pos.access", "cashier.shift", "sales.reprint"] };
export const MARIA_ID = "u-maria";

export const CASHIERS: CashierSnapshot = {
  cashiers: [
    { id: JUAN.id, name: JUAN.name, username: "cashier1", pin_hash: "hash:482916", roles: ["cashier"], permissions: JUAN.permissions, updated_at: null },
    { id: MARIA_ID, name: "Maria Santos", username: "maria", pin_hash: "hash:246810", roles: ["manager"],
      permissions: ["pos.access", "pos.apply_discount", "pos.price_override", "sales.void", "cashier.shift", "cashier.cash_movements", "cashier.manage_shifts"], updated_at: null },
  ],
  generated_at: "2026-10-30T00:00:00Z",
  valid_until: "2026-11-02T00:00:00Z",
};

/** A small but complete snapshot: one item with a box unit, 20 pieces allocated to the terminal. */
export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    terminal: { id: "dev-t01", code: "T01", name: "Lane 1", status: "active", last_receipt_sequence: 0 },
    items: [CORNED_BEEF],
    categories: [{ id: "cat-canned", name: "Canned Goods" }],
    payment_methods: [
      { id: "pm-cash", code: "cash", name: "Cash", type: "cash", requires_reference: false, allows_change: true, is_active: true, account_name: null, account_number: null, qr_url: null },
      { id: "pm-gcash", code: "gcash", name: "GCash", type: "e_wallet", requires_reference: true, allows_change: false, is_active: true, account_name: null, account_number: null, qr_url: null },
    ],
    discounts: [],
    cashiers: CASHIERS,
    settings: {
      receipt: { header_lines: [], footer_text: "Thank you!", show_vat_breakdown: true, paper_size: "80mm" },
      store: { name: "Compriva Grocery", legal_name: null, tin: null, address: null, phone: null, is_vat_registered: true, timezone: "Asia/Manila" },
      pos: { allow_over_allocation: false, max_offline_hours: 72 },
    },
    allocations: [{ sku_id: CORNED_BEEF.id, remaining: "20.0000" }],
    ...overrides,
  };
}

/** Offline PIN check stand-in for the native bcrypt verification. */
export const verifyPin = async (pin: string, hash: string) => hash === `hash:${pin}`;
