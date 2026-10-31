"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { normalizeAmount, parse } from "../fixed-point";
import type { PosCustomer, PresetDiscount, SaleDiscount } from "../types";
import { CustomerPicker } from "./customer-picker";

type Choice = { kind: "none" } | { kind: "preset"; id: string } | { kind: "percentage" } | { kind: "fixed_amount" };

const describe = (d: PresetDiscount) => (d.type === "percentage" ? `${Number(d.value)}% off` : `₱${d.value} off`) + (d.is_vat_exempt ? ", VAT-exempt" : "");

/**
 * The sale's customer and whole-sale discount: a preset such as Senior Citizen
 * or PWD (VAT-exempt, needs the customer's ID number) or a manual percentage or
 * amount. Choosing an SC or PWD customer picks their discount and ID number.
 */
export function SaleDiscountDialog({ open, onOpenChange, presets, value, customerName, customer: initialCustomer, onSave }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: PresetDiscount[];
  value: SaleDiscount | null;
  customerName: string;
  customer: PosCustomer | null;
  onSave: (discount: SaleDiscount | null, customerName: string, customer: PosCustomer | null) => void;
}) {
  const initial: Choice = value === null ? { kind: "none" } : value.kind === "preset" ? { kind: "preset", id: value.preset.id } : { kind: value.type };
  const [choice, setChoice] = useState<Choice>(initial);
  const [amount, setAmount] = useState(value?.kind === "manual" ? value.value : "");
  const [idNumber, setIdNumber] = useState(value?.kind === "preset" ? (value.customerIdNumber ?? "") : "");
  const [name, setName] = useState(customerName);
  const [customer, setCustomer] = useState(initialCustomer);

  const chooseCustomer = (next: PosCustomer | null) => {
    setCustomer(next);
    setName(next?.name ?? "");
    if (next?.type !== "senior_citizen" && next?.type !== "pwd") return;
    const statutory = presets.find((p) => p.kind === next.type);
    if (statutory && choice.kind === "none") setChoice({ kind: "preset", id: statutory.id });
    if (next.id_number) setIdNumber(next.id_number);
  };

  const preset = choice.kind === "preset" ? presets.find((p) => p.id === choice.id) : undefined;
  const manualAmount = normalizeAmount(amount);
  const problem =
    choice.kind === "percentage" || choice.kind === "fixed_amount"
      ? manualAmount === null || parse(manualAmount) <= BigInt(0) ? "Enter an amount." : choice.kind === "percentage" && parse(manualAmount) > parse("100") ? "At most 100%." : null
      : preset?.requires_customer_id && idNumber.trim() === "" ? `Enter the customer's ${preset.name.replace(/\s*\d+%$/, "")} ID number.` : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (problem) return;
    const discount: SaleDiscount | null =
      choice.kind === "none" ? null : preset ? { kind: "preset", preset, customerIdNumber: idNumber.trim() || null } : { kind: "manual", type: choice.kind as "percentage" | "fixed_amount", value: manualAmount! };
    onSave(discount, name.trim(), customer);
    onOpenChange(false);
  };

  const option = (key: string, selected: boolean, onSelect: () => void, title: string, detail?: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn("rounded-lg border p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", selected ? "border-primary bg-primary/5" : "hover:bg-muted")}
    >
      <span className="block font-medium">{title}</span>
      {detail && <span className="block text-xs text-muted-foreground">{detail}</span>}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sale discount and customer</DialogTitle>
          <DialogDescription>One discount applies to the whole sale. Manual discounts need a manager.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Customer</legend>
            <CustomerPicker value={customer} onChange={chooseCustomer} />
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            {option("none", choice.kind === "none", () => setChoice({ kind: "none" }), "No discount")}
            {presets.map((p) => option(p.id, choice.kind === "preset" && choice.id === p.id, () => setChoice({ kind: "preset", id: p.id }), p.name, describe(p)))}
            {option("pct", choice.kind === "percentage", () => setChoice({ kind: "percentage" }), "Manual %", "Manager approval")}
            {option("amt", choice.kind === "fixed_amount", () => setChoice({ kind: "fixed_amount" }), "Manual ₱", "Manager approval")}
          </div>

          {(choice.kind === "percentage" || choice.kind === "fixed_amount") && (
            <div className="grid gap-1.5">
              <Label htmlFor="sale-discount-value">{choice.kind === "percentage" ? "Percent off" : "Pesos off"}</Label>
              <Input id="sale-discount-value" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
          )}
          {preset?.requires_customer_id && (
            <div className="grid gap-1.5">
              <Label htmlFor="sale-discount-id">Customer ID number</Label>
              <Input id="sale-discount-id" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} maxLength={50} autoFocus />
            </div>
          )}
          {!customer && (
            <div className="grid gap-1.5">
              <Label htmlFor="customer-name">Or just a name (optional, printed on the receipt)</Label>
              <Input id="customer-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
            </div>
          )}
          {problem && <p className="text-sm text-danger">{problem}</p>}
          <DialogFooter>
            <Button type="submit" disabled={problem !== null}>Apply</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
