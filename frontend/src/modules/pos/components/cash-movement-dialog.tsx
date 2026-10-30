"use client";

import { ArrowLeftRight } from "lucide-react";
import { useState, type FormEvent } from "react";

import { SegmentedControl } from "@/components/segmented-control";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { useCan } from "@/modules/auth/hooks";

import { usePos } from "../backend-context";
import { cents, normalizeAmount, ZERO } from "../fixed-point";
import type { Approval, CashMovementType } from "../types";
import { ApprovalFields, emptyApproval, hasApproval } from "./approval-fields";

const TYPES: { value: CashMovementType; label: string; hint: string }[] = [
  { value: "cash_in", label: "Cash in", hint: "Money added to the drawer, e.g. coins for change." },
  { value: "cash_out", label: "Cash out", hint: "Money paid out of the drawer, e.g. a small expense." },
  { value: "cash_drop", label: "Cash drop", hint: "Excess cash moved from the drawer to the safe." },
];

/** Cash put into or taken out of the drawer outside a sale. Needs a manager unless the user may do it. */
export function CashMovementDialog({ onRecorded }: { onRecorded: (message: string) => void }) {
  const canMove = useCan("cashier.cash_movements");
  const pos = usePos();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CashMovementType>("cash_in");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [approval, setApproval] = useState<Approval>(emptyApproval());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const value = normalizeAmount(amount || "x");
  const ready = value !== null && cents(value) > ZERO && reason.trim().length >= 3 && (canMove || hasApproval(approval));

  const reset = () => {
    setAmount("");
    setReason("");
    setApproval(emptyApproval());
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const shift = await pos.cashMovement({ type, amount: value!, reason: reason.trim(), approval: canMove ? null : approval });
      onRecorded(`${TYPES.find((t) => t.value === type)!.label} of ${formatMoney(value!)} recorded. Expected cash in the drawer: ${formatMoney(shift.summary?.expected_cash ?? "0")}.`);
      setOpen(false);
      reset();
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger render={<Button variant="outline" />}>
        <ArrowLeftRight aria-hidden /> Cash in/out
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cash in or out</DialogTitle>
          <DialogDescription>{TYPES.find((t) => t.value === type)!.hint}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <SegmentedControl label="Type" value={type} onChange={setType} options={TYPES} />
          <div className="grid gap-1.5">
            <Label htmlFor="cash-amount">Amount (₱)</Label>
            <Input id="cash-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cash-reason">Reason</Label>
            <Input id="cash-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder="e.g. Coins from the office" />
          </div>
          {!canMove && <ApprovalFields idPrefix="cash-approval" permissions={["cashier.cash_movements"]} value={approval} onChange={setApproval} />}
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <Button type="submit" disabled={busy || !ready}>{busy ? "Recording…" : "Record"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
