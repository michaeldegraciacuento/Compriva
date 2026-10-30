"use client";

import { Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { SegmentedControl } from "@/components/segmented-control";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/format";

import { lineUnit, quantityProblem } from "../cart";
import { normalizeAmount, parse } from "../fixed-point";
import type { CartLine, ItemDiscount } from "../types";

type DiscountMode = "none" | "percentage" | "fixed_amount";

/**
 * Edit one cart line: quantity, unit, an item discount or a price change.
 * Discounts and price changes need a manager's approval at payment unless the
 * cashier may give them; the POS asks for it then.
 */
export function LineDialog({ line, open, onOpenChange, onSave, onRemove }: {
  line: CartLine;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: { quantity: string; unitId: string; discount: ItemDiscount | null; priceOverride: string | null }) => void;
  onRemove: () => void;
}) {
  const [quantity, setQuantity] = useState(line.quantity);
  const [unitId, setUnitId] = useState(line.unitId);
  const [mode, setMode] = useState<DiscountMode>(line.discount?.type ?? "none");
  const [discountValue, setDiscountValue] = useState(line.discount?.value ?? "");
  const [price, setPrice] = useState(line.priceOverride ?? "");

  const unit = lineUnit({ ...line, unitId });
  const qtyProblem = quantityProblem(quantity, unit);
  const discountAmount = mode === "none" ? null : normalizeAmount(discountValue);
  const discountProblem =
    mode === "none" ? null : discountAmount === null || parse(discountAmount) <= BigInt(0) ? "Enter an amount." : mode === "percentage" && parse(discountAmount) > parse("100") ? "At most 100%." : null;
  const priceAmount = price.trim() === "" ? null : normalizeAmount(price);
  const priceProblem = price.trim() !== "" && priceAmount === null ? "Enter a price like 45 or 45.50." : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (qtyProblem || discountProblem || priceProblem) return;
    onSave({
      quantity,
      unitId,
      discount: mode === "none" ? null : { type: mode, value: discountAmount! },
      priceOverride: priceAmount !== null && priceAmount !== normalizeAmount(unit.price) ? priceAmount : null,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{line.item.name}</DialogTitle>
          <DialogDescription>{line.item.code} · {formatMoney(unit.price)} per {unit.unit.name.toLowerCase()}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="line-qty">Quantity</Label>
              <Input id="line-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={qtyProblem ? true : undefined} autoFocus />
              {qtyProblem && <p className="text-xs text-danger">{qtyProblem}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="line-unit">Unit</Label>
              <select
                id="line-unit"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className="h-9 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {line.item.units.map((u) => (
                  <option key={u.unit.id} value={u.unit.id}>{u.unit.name} · {formatMoney(u.price)}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Item discount</span>
            <SegmentedControl<DiscountMode>
              label="Item discount type"
              value={mode}
              onChange={setMode}
              options={[{ value: "none", label: "None" }, { value: "percentage", label: "Percent" }, { value: "fixed_amount", label: "Amount" }]}
            />
            {mode !== "none" && (
              <>
                <Input aria-label={mode === "percentage" ? "Discount percent" : "Discount amount in pesos"} inputMode="decimal" placeholder={mode === "percentage" ? "10" : "5.00"} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} />
                {discountProblem && <p className="text-xs text-danger">{discountProblem}</p>}
              </>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="line-price">Price per {unit.unit.name.toLowerCase()} (leave empty for the list price)</Label>
            <Input id="line-price" inputMode="decimal" placeholder={formatMoney(unit.price)} value={price} onChange={(e) => setPrice(e.target.value)} />
            {priceProblem && <p className="text-xs text-danger">{priceProblem}</p>}
          </div>

          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" className="text-danger" onClick={() => { onRemove(); onOpenChange(false); }}>
              <Trash2 aria-hidden /> Remove item
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
