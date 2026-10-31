import { formatDate, formatTime } from "@/lib/format";

import type { Sale } from "../pos/types";

/**
 * The receipt as lines of fixed-width text: what a thermal printer prints and
 * what the preview shows, character for character. Built from the sale's
 * stored snapshot (never recalculated). Widths: 58 mm paper = 32 characters,
 * 80 mm = 48 (Font A).
 */
export type ReceiptLine =
  | { kind: "text"; text: string; align?: "left" | "center"; bold?: boolean; large?: boolean }
  | { kind: "rule" }
  | { kind: "feed" };

export const PAPER_WIDTH = { "58mm": 32, "80mm": 48 } as const;
export type ThermalPaper = keyof typeof PAPER_WIDTH;

const METHOD = { cash: "Cash", gcash: "GCash", maya: "Maya" } as Record<string, string>;
const isZero = (value: string | undefined) => !value || /^-?0+(\.0+)?$/.test(value);

/** "1234.5000" → "1,234.50" (string arithmetic only). */
export function amount(value: string): string {
  const negative = value.trim().startsWith("-");
  const [whole, fraction = ""] = value.trim().replace("-", "").split(".");
  // Round half up to centavos on the decimal string.
  const digits = `${whole}${fraction.padEnd(4, "0").slice(0, 2)}`;
  const up = Number(fraction.padEnd(4, "0")[2] ?? "0") >= 5;
  const cents = (BigInt(digits) + (up ? BigInt(1) : BigInt(0))).toString().padStart(3, "0");
  const grouped = cents.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${cents.slice(-2)}`;
}

function quantity(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** Word-wraps to the width; long words are cut. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (let piece = word; piece.length > 0; piece = piece.slice(width)) {
      const chunk = piece.slice(0, width);
      if (line === "") line = chunk;
      else if (line.length + 1 + chunk.length <= width) line = `${line} ${chunk}`;
      else {
        lines.push(line);
        line = chunk;
      }
      if (piece.length <= width) break;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Label on the left, value on the right; the label is shortened if both do not fit. */
export function columns(left: string, right: string, width: number): string {
  const room = width - right.length - 1;
  const label = left.length > room ? left.slice(0, Math.max(0, room)) : left;
  return `${label}${" ".repeat(Math.max(1, width - label.length - right.length))}${right}`;
}

export function receiptLines(sale: Sale, width: number, options: { reprint?: boolean } = {}): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const text = (t: string, extra: Partial<Extract<ReceiptLine, { kind: "text" }>> = {}) => lines.push({ kind: "text", text: t, ...extra });
  const row = (label: string, value: string, bold = false) => text(columns(label, value, width), { bold });
  const centered = (t: string, extra: Partial<Extract<ReceiptLine, { kind: "text" }>> = {}) => wrap(t, width).forEach((l) => text(l, { align: "center", ...extra }));
  const rule = () => lines.push({ kind: "rule" });

  const store = sale.store;
  if (sale.status === "voided") centered("*** VOID ***", { bold: true, large: true });
  if (options.reprint) centered("REPRINT", { bold: true });
  if (store) {
    centered(store.name, { bold: true, large: true });
    if (store.legal_name) centered(store.legal_name);
    if (store.address) centered(store.address);
    if (store.tin) centered(`${store.is_vat_registered ? "VAT Reg TIN" : "Non-VAT TIN"} ${store.tin}`);
    if (store.phone) centered(store.phone);
  }
  sale.receipt?.header_lines.forEach((l) => centered(l));

  rule();
  row("Receipt", sale.receipt_number);
  row("Date", `${formatDate(sale.occurred_at)} ${formatTime(sale.occurred_at)}`);
  if (sale.terminal) row("Terminal", sale.terminal.code);
  if (sale.cashier) row("Cashier", sale.cashier.name);
  if (sale.customer_name) row("Customer", sale.customer_name);
  if (sale.customer_tin) row("Customer TIN", sale.customer_tin);
  if (sale.customer_address) wrap(`Address: ${sale.customer_address}`, width).forEach((l) => text(l));
  rule();

  const itemDiscounts = new Map((sale.discounts ?? []).filter((d) => d.sale_item_id).map((d) => [d.sale_item_id, d]));
  for (const item of sale.items ?? []) {
    wrap(item.product_name, width).forEach((l) => text(l));
    const flag = item.tax_type === "vat" ? "" : item.tax_type === "zero_rated" ? " Z" : " E";
    row(`  ${quantity(item.quantity)} ${item.unit_name} x ${amount(item.unit_price)}${flag}`, amount(item.gross_amount));
    const discount = itemDiscounts.get(item.id);
    if (discount) row("  Less discount", `-${amount(discount.amount)}`);
  }
  rule();

  row("Subtotal", amount(sale.gross_amount));
  if (!isZero(sale.vat_exemption)) row("Less VAT (exempt)", `-${amount(sale.vat_exemption!)}`);
  const saleDiscount = (sale.discounts ?? []).find((d) => !d.sale_item_id);
  if (saleDiscount) row(`Less ${saleDiscount.name}`, `-${amount(saleDiscount.amount)}`);
  text(columns("TOTAL", `PHP ${amount(sale.grand_total)}`, width), { bold: true });
  for (const payment of sale.payments ?? []) {
    row(METHOD[payment.method] ?? payment.method, amount(payment.tendered_amount));
    if (payment.reference_number) text(`  Ref ${payment.reference_number}`);
  }
  row("Change", amount(sale.change_due));

  if (sale.receipt?.show_vat_breakdown !== false) {
    rule();
    row("VATable sales", amount(sale.vatable_sales));
    row("VAT 12%", amount(sale.vat_amount));
    row("VAT-exempt sales", amount(sale.vat_exempt_sales));
    row("Zero-rated sales", amount(sale.zero_rated_sales));
  }
  if (sale.customer_id_number) text(`SC/PWD ID: ${sale.customer_id_number}`);
  if (sale.void) wrap(`Voided ${formatDate(sale.void.voided_at)} by ${sale.void.voided_by}: ${sale.void.reason}`, width).forEach((l) => text(l));

  if (sale.receipt?.footer_text) {
    lines.push({ kind: "feed" });
    centered(sale.receipt.footer_text);
  }
  return lines;
}

/** The lines as plain text, exactly as printed (for the preview and for tests). */
export function receiptText(lines: ReceiptLine[], width: number): string {
  return lines
    .map((line) => {
      if (line.kind === "rule") return "-".repeat(width);
      if (line.kind === "feed") return "";
      if (line.align !== "center") return line.text;
      const pad = Math.max(0, Math.floor((width - line.text.length) / 2));
      return `${" ".repeat(pad)}${line.text}`;
    })
    .join("\n");
}
