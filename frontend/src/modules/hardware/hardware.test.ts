import { describe, expect, it } from "vitest";

import type { Sale } from "../pos/types";
import { COMMANDS, drawerPulse, encodeDrawerPulse, encodeReceipt, encodeText } from "./escpos";
import { amount, columns, PAPER_WIDTH, receiptLines, receiptText, wrap } from "./receipt-layout";
import { ScanDetector } from "./scanner";

const sale: Sale = {
  id: "s1", receipt_number: "T01-000042", status: "completed",
  terminal: { id: "t", code: "T01", name: "Lane 1" }, cashier: { id: "u", name: "Juan Dela Cruz" },
  cashier_shift_id: "sh", occurred_at: "2026-10-31T02:15:00Z", business_date: "2026-10-31",
  customer_name: null, customer_id_number: null,
  gross_amount: "1234.5000", discount_total: "0.0000", vat_exemption: "0.00", vatable_sales: "1102.2300", vat_amount: "132.2700",
  vat_exempt_sales: "0.0000", zero_rated_sales: "0.0000", grand_total: "1234.5000", amount_paid: "1500.0000", change_due: "265.5000",
  items: [{
    id: "i1", line_number: 1, sku_id: "k", product_name: "Lucky Me! Pancit Canton Original 80g Family Pack Extra", sku_code: "SKU-1", barcode: null,
    unit_name: "Piece", quantity: "3.0000", regular_unit_price: "411.5000", unit_price: "411.5000", price_overridden: false,
    gross_amount: "1234.5000", discount_amount: "0.0000", tax_code: "VAT12", tax_type: "vat", tax_amount: "132.27", line_total: "1234.5000", returned_quantity: "0",
  }],
  discounts: [],
  payments: [{ id: "p", method: "gcash", amount: "1234.5000", tendered_amount: "1500.0000", change_amount: "0", reference_number: "GC-998877" }],
  void: null,
  store: { name: "Compriva Grocery", legal_name: null, tin: "123-456-789-000", address: "Malolos, Bulacan", phone: null, is_vat_registered: true },
  receipt: { header_lines: [], footer_text: "Salamat po!", show_vat_breakdown: true, paper_size: "80mm" },
  notes: null,
};

describe("receipt layout", () => {
  it("fits every line within the paper width, for 58 mm and 80 mm", () => {
    for (const width of Object.values(PAPER_WIDTH)) {
      const text = receiptText(receiptLines(sale, width), width);
      expect(text.split("\n").every((line) => line.length <= width)).toBe(true);
      expect(text).toContain("T01-000042");
      expect(text).toContain("1,234.50");
      expect(text).toContain("Ref GC-998877");
    }
    const narrow = receiptText(receiptLines(sale, 32), 32);
    expect(narrow).toContain(columns("TOTAL", "PHP 1,234.50", 32));
    expect(narrow.split("\n")).toEqual(expect.arrayContaining(["Lucky Me! Pancit Canton Original", "80g Family Pack Extra"])); // long name wrapped
  });

  it("marks reprints and voids", () => {
    const text = receiptText(receiptLines({ ...sale, status: "voided", void: { voided_at: "2026-10-31T03:00:00Z", voided_by: "Maria", reason: "Mistake" } }, 48, { reprint: true }), 48);
    expect(text).toMatch(/\*\*\* VOID \*\*\*/);
    expect(text).toMatch(/REPRINT/);
    expect(text).toMatch(/Voided .* by Maria: Mistake/);
  });

  it("formats amounts and wraps text without floating point", () => {
    expect(amount("1234567.505")).toBe("1,234,567.51");
    expect(amount("0.0049")).toBe("0.00");
    expect(amount("-15")).toBe("-15.00");
    expect(wrap("a verylongwordthatdoesnotfit here", 10)).toEqual(["a", "verylongwo", "rdthatdoes", "notfit", "here"]);
    expect(columns("A long label that is too long", "999.00", 20)).toBe("A long label  999.00"); // shortened, value right-aligned
    expect(columns("Cash", "1,500.00", 20)).toHaveLength(20);
  });
});

describe("ESC/POS encoding", () => {
  const bytes = (array: Uint8Array) => Array.from(array);
  const includes = (haystack: number[], needle: readonly number[]) =>
    haystack.some((_, i) => needle.every((b, j) => haystack[i + j] === b));

  it("starts with init and code page, cuts each copy and pulses the drawer last", () => {
    const data = bytes(encodeReceipt(receiptLines(sale, 48), { width: 48, copies: 2, openDrawer: true, drawerPin: 1 }));
    expect(data.slice(0, 5)).toEqual([...COMMANDS.init, ...COMMANDS.codePage437]);
    const cuts = data.reduce((count, _, i) => count + (COMMANDS.feedAndCut.every((b, j) => data[i + j] === b) ? 1 : 0), 0);
    expect(cuts).toBe(2);
    expect(data.slice(-5)).toEqual(drawerPulse(1));
  });

  it("maps text to code page 437 and never sends unsupported bytes", () => {
    expect(encodeText("Niño ₱5")).toEqual([0x4e, 0x69, 0xa4, 0x6f, 0x20, 0x50, 0x35]);
    expect(encodeText("日本")).toEqual([0x3f, 0x3f]);
    expect(bytes(encodeDrawerPulse())).toEqual([0x1b, 0x40, 0x1b, 0x70, 0x00, 0x19, 0xfa]);
  });

  it("prints bold and large lines with their on/off commands", () => {
    const data = bytes(encodeReceipt([{ kind: "text", text: "TOTAL", bold: true, large: true }], { width: 32, cut: false }));
    expect(includes(data, [...COMMANDS.boldOn, ...COMMANDS.largeOn, ...encodeText("TOTAL"), 0x0a, ...COMMANDS.largeOff, ...COMMANDS.boldOff])).toBe(true);
  });
});

describe("USB scanner detection", () => {
  const type = (detector: ScanDetector, text: string, start: number, gap: number) => {
    let at = start;
    for (const char of text) detector.key(char, (at += gap));
    return detector.key("Enter", at + gap);
  };

  it("recognises a fast burst ending in Enter as a scan", () => {
    expect(type(new ScanDetector(), "4800016644290", 0, 5)).toEqual({ kind: "scan", code: "4800016644290" });
  });

  it("ignores a person typing and codes that are too short", () => {
    expect(type(new ScanDetector(), "4800016644290", 0, 120)).toEqual({ kind: "none" });
    expect(type(new ScanDetector(), "12", 0, 5)).toEqual({ kind: "none" });
  });

  it("drops a double read of the same barcode, but not a deliberate second scan", () => {
    const detector = new ScanDetector();
    expect(type(detector, "4800016644290", 0, 5).kind).toBe("scan");
    expect(type(detector, "4800016644290", 100, 5).kind).toBe("duplicate"); // within 500 ms
    expect(type(detector, "4800016644290", 1_000, 5).kind).toBe("scan");
    expect(type(detector, "4800000000019", 1_100, 5).kind).toBe("scan"); // a different item right away
  });

  it("restarts the burst when a slow key comes first", () => {
    const detector = new ScanDetector();
    detector.key("x", 0);
    expect(type(detector, "12345678", 500, 5)).toEqual({ kind: "scan", code: "12345678" });
  });
});
