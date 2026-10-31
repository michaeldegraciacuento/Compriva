"use client";

import { formatDate, formatMoney, formatQuantity, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { Sale } from "../types";

const METHOD_NAMES: Record<string, string> = { cash: "Cash", gcash: "GCash", maya: "Maya" };
export const methodName = (code: string) => METHOD_NAMES[code] ?? code;

const isZero = (amount: string | undefined) => !amount || /^0+(\.0+)?$/.test(amount);

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "text-base font-bold")}>
      <span>{label}</span>
      <span className="numeric">{value}</span>
    </div>
  );
}

/**
 * Printable receipt from a sale's stored snapshot (never recalculated), for
 * the print dialog: only `.receipt-print` prints, sized for 58 mm, 80 mm or A4.
 * Thermal printers on desktop get the same receipt as ESC/POS text instead
 * (modules/hardware/receipt-layout.ts).
 */
export function Receipt({ sale, className, paper = "80mm" }: { sale: Sale; className?: string; paper?: "58mm" | "80mm" | "a4" }) {
  const store = sale.store;
  const settings = sale.receipt;
  const itemDiscounts = new Map((sale.discounts ?? []).filter((d) => d.sale_item_id).map((d) => [d.sale_item_id, d]));
  const saleDiscount = (sale.discounts ?? []).find((d) => !d.sale_item_id);

  return (
    <div
      data-paper={paper}
      className={cn(
        "receipt-print relative mx-auto w-full rounded-md border bg-white p-4 font-mono leading-relaxed text-black",
        paper === "58mm" ? "max-w-[16rem] text-[11px]" : paper === "a4" ? "max-w-2xl p-8 text-sm" : "max-w-[22rem] text-xs",
        className,
      )}
    >
      {sale.status === "voided" && (
        <p className="mb-2 rounded border-2 border-black py-1 text-center text-sm font-bold tracking-widest">VOID</p>
      )}

      <header className="text-center">
        <p className="text-sm font-bold">{store?.name}</p>
        {store?.legal_name && <p>{store.legal_name}</p>}
        {store?.address && <p>{store.address}</p>}
        {store?.tin && <p>{store.is_vat_registered ? "VAT Reg TIN" : "Non-VAT TIN"} {store.tin}</p>}
        {store?.phone && <p>{store.phone}</p>}
        {settings?.header_lines.map((line) => <p key={line}>{line}</p>)}
      </header>

      <div className="my-2 border-t border-dashed border-black" />
      <Row label="Receipt" value={sale.receipt_number} />
      <Row label="Date" value={`${formatDate(sale.occurred_at)} ${formatTime(sale.occurred_at)}`} />
      {sale.terminal && <Row label="Terminal" value={sale.terminal.code} />}
      {sale.cashier && <Row label="Cashier" value={sale.cashier.name} />}
      {sale.customer_name && <Row label="Customer" value={sale.customer_name} />}
      {sale.customer_tin && <Row label="Customer TIN" value={sale.customer_tin} />}
      {sale.customer_address && <Row label="Address" value={sale.customer_address} />}
      <div className="my-2 border-t border-dashed border-black" />

      <ul className="grid gap-1.5">
        {sale.items?.map((item) => {
          const discount = itemDiscounts.get(item.id);
          return (
            <li key={item.id}>
              <p className="break-words">{item.product_name}</p>
              <div className="flex justify-between gap-3 pl-2">
                <span>
                  {formatQuantity(item.quantity, item.unit_name)} × {formatMoney(item.unit_price)}
                  {item.tax_type !== "vat" && <span> ({item.tax_type === "zero_rated" ? "Z" : "E"})</span>}
                </span>
                <span className="numeric">{formatMoney(item.gross_amount)}</span>
              </div>
              {discount && (
                <div className="flex justify-between gap-3 pl-2">
                  <span>Less discount</span>
                  <span className="numeric">-{formatMoney(discount.amount)}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="my-2 border-t border-dashed border-black" />
      <Row label="Subtotal" value={formatMoney(sale.gross_amount)} />
      {!isZero(sale.vat_exemption) && <Row label="Less VAT (exempt)" value={`-${formatMoney(sale.vat_exemption!)}`} />}
      {saleDiscount && <Row label={`Less ${saleDiscount.name}`} value={`-${formatMoney(saleDiscount.amount)}`} />}
      <Row label="TOTAL" value={formatMoney(sale.grand_total)} strong />
      {sale.payments?.map((payment) => (
        <div key={payment.id}>
          <Row label={methodName(payment.method)} value={formatMoney(payment.tendered_amount)} />
          {payment.reference_number && <p className="pl-2">Ref {payment.reference_number}</p>}
        </div>
      ))}
      <Row label="Change" value={formatMoney(sale.change_due)} />

      {settings?.show_vat_breakdown !== false && (
        <>
          <div className="my-2 border-t border-dashed border-black" />
          <Row label="VATable sales" value={formatMoney(sale.vatable_sales)} />
          <Row label="VAT 12%" value={formatMoney(sale.vat_amount)} />
          <Row label="VAT-exempt sales" value={formatMoney(sale.vat_exempt_sales)} />
          <Row label="Zero-rated sales" value={formatMoney(sale.zero_rated_sales)} />
        </>
      )}
      {sale.customer_id_number && <p className="mt-2">SC/PWD ID: {sale.customer_id_number}</p>}

      {sale.void && (
        <p className="mt-2">
          Voided {formatDate(sale.void.voided_at)} by {sale.void.voided_by}: {sale.void.reason}
        </p>
      )}
      {settings?.footer_text && <p className="mt-3 text-center">{settings.footer_text}</p>}
    </div>
  );
}

export function printReceipt() {
  window.print();
}
