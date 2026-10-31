"use client";

import { LogOut } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";

import { usePos } from "../backend-context";
import { cents, format, normalizeAmount, ZERO } from "../fixed-point";
import type { Shift } from "../types";
import { methodName } from "./receipt";

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4", strong && "font-semibold")}>
      <dt>{label}</dt>
      <dd className="numeric">{value}</dd>
    </div>
  );
}

/**
 * Closing a shift: the cashier counts the drawer; the server compares it with
 * the expected cash (opening cash + cash sales − cash refunds) and stores the
 * difference. A closed shift can no longer be changed.
 */
export function CloseShiftDialog({ shift: initial, onClosed, trigger }: { shift: Shift; onClosed: () => Promise<void> | void; trigger?: React.ReactElement }) {
  const pos = usePos();
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState<Shift>(initial);
  const [counted, setCounted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<Shift | null>(null);

  const amount = counted === "" ? null : normalizeAmount(counted);
  const summary = shift.summary;
  const variance = amount !== null && summary ? cents(amount) - cents(summary.expected_cash) : null;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    setError(null);
    if (next) {
      setClosed(null);
      setCounted("");
      void pos.fetchShift().then((fresh) => fresh && setShift(fresh)).catch((caught) => setError(toApiError(caught).message));
    } else if (closed) {
      void onClosed();
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (amount === null) return;
    setBusy(true);
    setError(null);
    try {
      const closedShift = await pos.closeShift(amount);
      notify.success("Shift closed", closedShift.cash_variance && closedShift.cash_variance !== "0.00" && closedShift.cash_variance !== "0.0000" ? `Cash difference: ${formatMoney(closedShift.cash_variance)}.` : "The drawer count matches.");
      setClosed(closedShift);
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  const shown = closed ?? shift;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger ?? <Button variant="outline" />}>
        {!trigger && (<><LogOut aria-hidden /> Close shift</>)}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{closed ? "Shift closed" : `Close ${shift.cashier.name}'s shift`}</DialogTitle>
          <DialogDescription>
            {closed ? "The count is saved. This shift can no longer change." : "Count the cash in the drawer and enter the total."}
          </DialogDescription>
        </DialogHeader>

        {shown.summary && (
          <dl className="grid gap-1 rounded-lg bg-muted/60 p-3 text-sm">
            <Line label={`Sales (${shown.summary.sales_count})`} value={formatMoney(shown.summary.sales_total)} />
            {Object.entries(shown.summary.payments).map(([method, row]) => (
              <Line key={method} label={`  ${methodName(method)}`} value={formatMoney(row.total)} />
            ))}
            {shown.summary.voided_count > 0 && <Line label="Voided sales" value={String(shown.summary.voided_count)} />}
            <div className="my-1 border-t" />
            <Line label="Opening cash" value={formatMoney(shown.summary.opening_float)} />
            <Line label="+ Cash sales" value={formatMoney(shown.summary.cash_sales)} />
            {cents(shown.summary.cash_in) > ZERO && <Line label="+ Cash in" value={formatMoney(shown.summary.cash_in)} />}
            {cents(shown.summary.cash_refunds) > ZERO && <Line label="− Cash refunds" value={formatMoney(shown.summary.cash_refunds)} />}
            {cents(shown.summary.cash_out) > ZERO && <Line label="− Cash out and drops" value={formatMoney(shown.summary.cash_out)} />}
            <Line label="Expected cash in drawer" value={formatMoney(shown.summary.expected_cash)} strong />
            {closed && <Line label="Counted" value={formatMoney(closed.counted_cash ?? "0")} strong />}
            {closed && <Line label="Difference" value={formatMoney(closed.cash_variance ?? "0")} strong />}
          </dl>
        )}

        {closed ? (
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </DialogFooter>
        ) : (
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-1.5">
              <Label htmlFor="counted-cash">Cash counted (₱)</Label>
              <Input id="counted-cash" inputMode="decimal" placeholder="0.00" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
              {variance !== null && (
                <p className={cn("text-xs", variance === ZERO ? "text-success" : "text-warning")}>
                  {variance === ZERO ? "Matches the expected cash." : variance > ZERO ? `₱${format(variance)} over` : `₱${format(-variance)} short`}
                </p>
              )}
            </div>
            {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
            <DialogFooter>
              <Button type="submit" disabled={busy || amount === null}>{busy ? "Closing…" : "Close shift"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
