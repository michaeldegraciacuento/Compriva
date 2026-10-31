"use client";

import { BadgePercent, Minus, PauseCircle, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

import { addOne, quantityProblem } from "../cart";
import { cents, format, ZERO } from "../fixed-point";
import { useCartStore } from "../store";
import type { PricedCart, PresetDiscount } from "../types";
import { LineDialog } from "./line-dialog";
import { SaleDiscountDialog } from "./sale-discount-dialog";

/** "3" → "2"; never below 1 (use Remove for that). Count units only. */
function minusOne(quantity: string): string {
  const [whole, fraction] = quantity.split(".");
  const next = BigInt(whole || "0") - BigInt(1);
  if (next < BigInt(1)) return quantity;
  return fraction ? `${next}.${fraction}` : next.toString();
}

function TotalRow({ label, value, strong = false, muted = false }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "text-lg font-semibold", muted && "text-muted-foreground")}>
      <dt>{label}</dt>
      <dd className="numeric">{value}</dd>
    </div>
  );
}

/** The cart: lines with quantity and unit, discounts, totals and the Pay button. */
export function CartPanel({ priced, presets, problems, onPay, onHold }: {
  priced: PricedCart;
  presets: PresetDiscount[];
  problems: string[];
  onPay: () => void;
  onHold: () => void;
}) {
  const cart = useCartStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const editingLine = cart.lines.find((line) => line.key === editing);
  const { totals } = priced;
  const empty = cart.lines.length === 0;
  const hasDiscount = cents(totals.discount_total) > ZERO;
  // VAT removed by a Senior Citizen / PWD discount: what exempted lines lost besides the discount itself.
  const vatExemption = priced.lines
    .filter((line) => line.amounts.vat_exempted)
    .reduce((total, line) => total + cents(line.amounts.gross) - cents(line.amounts.discount) - cents(line.amounts.total), ZERO);

  return (
    <section aria-label="Cart" className="flex min-h-0 flex-col rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <ShoppingCart className="size-4" aria-hidden /> Cart
          <span className="text-sm font-normal text-muted-foreground">({cart.lines.length} {cart.lines.length === 1 ? "line" : "lines"})</span>
        </h2>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onHold} disabled={empty}>
            <PauseCircle aria-hidden /> Hold
          </Button>
          <ConfirmDialog
            trigger={<Button size="sm" variant="ghost" disabled={empty} aria-label="Clear cart"><Trash2 aria-hidden /></Button>}
            title="Clear the cart?"
            description="Every item in this cart is removed. Nothing is recorded."
            confirmLabel="Clear cart"
            destructive
            onConfirm={async () => cart.clear()}
          />
        </div>
      </header>

      {empty ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState icon={ShoppingCart} title="The cart is empty">Scanned items appear here.</EmptyState>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
          {priced.lines.map((line) => {
            const problem = quantityProblem(line.quantity, line.unit);
            return (
              <li key={line.key} className="grid gap-1.5 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => setEditing(line.key)} aria-label={`Edit ${line.item.name}`} className="min-w-0 text-left font-medium hover:underline">
                    <span className="line-clamp-2">{line.item.name}</span>
                  </button>
                  <span className="numeric shrink-0 font-semibold">{formatMoney(line.amounts.total)}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    {!line.unit.unit.allows_decimal && (
                      <Button size="icon-sm" variant="outline" aria-label={`One less ${line.item.name}`} onClick={() => cart.setQuantity(line.key, minusOne(line.quantity))}>
                        <Minus aria-hidden />
                      </Button>
                    )}
                    <Input
                      aria-label={`Quantity of ${line.item.name}`}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(e) => cart.setQuantity(line.key, e.target.value)}
                      aria-invalid={problem ? true : undefined}
                      className="h-8 w-16 text-center"
                    />
                    {!line.unit.unit.allows_decimal && (
                      <Button size="icon-sm" variant="outline" aria-label={`One more ${line.item.name}`} onClick={() => cart.setQuantity(line.key, addOne(line.quantity))}>
                        <Plus aria-hidden />
                      </Button>
                    )}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {line.unit.unit.code} × {formatMoney(line.unitPrice)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 text-xs">
                    {line.priceOverride && <span className="rounded bg-warning-soft px-1.5 py-0.5 text-warning">Price changed</span>}
                    {line.discount && <span className="rounded bg-info-soft px-1.5 py-0.5 text-info">-{formatMoney(line.amounts.item_discount)}</span>}
                  </div>
                </div>
                {problem && <p className="text-xs text-danger">{problem}</p>}
                {line.item.stock.tracked && cents(line.item.stock.available) <= ZERO && (
                  <p className="text-xs text-warning">System stock shows none left of this item.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <footer className="grid gap-3 border-t px-4 py-3">
        <Button variant="outline" size="sm" className="justify-start" onClick={() => setDiscountOpen(true)} disabled={empty}>
          <BadgePercent aria-hidden />
          {cart.discount === null ? "Sale discount or customer" : cart.discount.kind === "preset" ? cart.discount.preset.name : "Manual discount"}
          {cart.customerName && <span className="truncate text-muted-foreground">· {cart.customerName}</span>}
        </Button>

        <dl className="grid gap-1 text-sm">
          <TotalRow label="Subtotal" value={formatMoney(totals.gross_amount)} />
          {hasDiscount && <TotalRow label="Discounts" value={`-${formatMoney(totals.discount_total)}`} />}
          {vatExemption > ZERO && <TotalRow label="Less VAT (exempt)" value={`-${formatMoney(format(vatExemption))}`} />}
          <TotalRow label="VAT included" value={formatMoney(totals.vat_amount)} muted />
          <TotalRow label="Total" value={formatMoney(totals.grand_total)} strong />
        </dl>

        {problems.length > 0 && !empty && (
          <ul className="grid gap-0.5 text-xs text-danger">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}

        <Button size="lg" className="h-14 text-lg" onClick={onPay} disabled={empty || problems.length > 0}>
          Pay {formatMoney(totals.grand_total)}
        </Button>
      </footer>

      {editingLine && (
        <LineDialog
          key={editingLine.key}
          line={editingLine}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onRemove={() => cart.remove(editingLine.key)}
          onSave={(patch) => {
            if (patch.unitId !== editingLine.unitId) cart.setUnit(editingLine.key, patch.unitId);
            cart.setQuantity(editingLine.key, patch.quantity);
            cart.setLineDiscount(editingLine.key, patch.discount);
            cart.setPriceOverride(editingLine.key, patch.priceOverride);
          }}
        />
      )}
      {discountOpen && (
        <SaleDiscountDialog
          open
          onOpenChange={setDiscountOpen}
          presets={presets}
          value={cart.discount}
          customerName={cart.customerName}
          customer={cart.customer}
          onSave={(discount, name, customer) => {
            cart.setDiscount(discount);
            cart.setCustomerName(name);
            cart.setCustomer(customer);
          }}
        />
      )}
    </section>
  );
}
