"use client";

import { Banknote, QrCode, Smartphone, X } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/modules/auth/store";
import { can } from "@/modules/auth/permissions";

import { usePos } from "../backend-context";
import { cents, normalizeAmount, ZERO } from "../fixed-point";
import { useCartStore } from "../store";
import { applyTenders } from "../tender";
import type { Approval, PaymentInput, PaymentMethod, PricedCart, Sale } from "../types";
import { ApprovalFields, emptyApproval, hasApproval } from "./approval-fields";

const ICONS: Record<string, typeof Banknote> = { cash: Banknote, gcash: Smartphone, maya: Smartphone };
const BILLS = ["20", "50", "100", "200", "500", "1000"];

/**
 * Taking payment. Cash may be more than due (change is given); GCash and Maya
 * are paid by scanning the store's QR code, for an exact amount, and need the
 * reference number from the customer's confirmation. Payments can be split.
 * The server validates everything again and records the sale once.
 */
export function PaymentDialog({ open, onOpenChange, priced, methods, onPaid, onPricesChanged }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  priced: PricedCart;
  methods: PaymentMethod[];
  onPaid: (sale: Sale) => void;
  onPricesChanged: () => Promise<void>;
}) {
  const session = useAuthStore((s) => s.session);
  const pos = usePos();
  const cart = useCartStore();
  const total = priced.totals.grand_total;

  const [tenders, setTenders] = useState<PaymentInput[]>([]);
  const [methodCode, setMethodCode] = useState(methods[0]?.code ?? "cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [approval, setApproval] = useState<Approval>(emptyApproval());
  const [askApproval, setAskApproval] = useState<string[]>(() => priced.permissions.filter((p) => !can(session, p)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const method = methods.find((m) => m.code === methodCode) ?? methods[0];
  const byCode = new Map(methods.map((m) => [m.code, m]));
  const paidSoFar = applyTenders(total, tenders.map((t) => ({ allowsChange: byCode.get(t.method)?.allows_change ?? false, amount: t.amount })));
  const remaining = paidSoFar.due;
  const typed = amount.trim() === "" ? null : normalizeAmount(amount);
  // The amount being entered counts as a payment when Complete is pressed (one-step cash sales).
  const pending: PaymentInput | null =
    typed !== null && cents(typed) > ZERO ? { method: method.code, amount: typed, reference: method.requires_reference ? reference.trim() : null } : null;
  const all = pending ? [...tenders, pending] : tenders;
  const result = applyTenders(total, all.map((t) => ({ allowsChange: byCode.get(t.method)?.allows_change ?? false, amount: t.amount })));
  const missingReference = all.find((t) => byCode.get(t.method)?.requires_reference && !t.reference);
  const freeSale = cents(total) === ZERO;

  const addPending = () => {
    if (!pending) return;
    if (method.requires_reference && !pending.reference) {
      setError(`Enter the ${method.name} reference number.`);
      return;
    }
    setTenders([...tenders, pending]);
    setAmount("");
    setReference("");
    setError(null);
  };

  const complete = async () => {
    if (missingReference) {
      setError(`Enter the ${byCode.get(missingReference.method)?.name} reference number.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sale = await pos.checkout({
        id: cart.saleId,
        lines: cart.lines,
        discount: cart.discount,
        payments: freeSale ? [] : all,
        expectedTotal: total,
        customerName: cart.customerName,
        approval: askApproval.length > 0 && hasApproval(approval) ? approval : null,
      });
      onPaid(sale);
    } catch (caught) {
      const apiError = toApiError(caught);
      if (apiError.code === "APPROVAL_REQUIRED") {
        const permission = typeof apiError.details.permission === "string" ? apiError.details.permission : "pos.apply_discount";
        setAskApproval((current) => (current.includes(permission) ? current : [...current, permission]));
      }
      if (apiError.code === "TOTAL_MISMATCH") await onPricesChanged();
      setError(apiError.message);
    } finally {
      setBusy(false);
    }
  };

  const canComplete = !busy && (freeSale || result.problem === null) && (askApproval.length === 0 || hasApproval(approval));
  const MethodIcon = ICONS[method.code] ?? QrCode;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
          <DialogDescription>Total due {formatMoney(total)}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_15rem]">
          <div className="grid content-start gap-4">
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Payment method">
              {methods.map((m) => {
                const Icon = ICONS[m.code] ?? QrCode;
                return (
                  <button
                    key={m.code}
                    type="button"
                    aria-pressed={m.code === method.code}
                    onClick={() => {
                      setMethodCode(m.code);
                      setAmount(m.allows_change ? "" : remaining);
                      setReference("");
                    }}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border p-3 font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      m.code === method.code ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted",
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    {m.name}
                  </button>
                );
              })}
            </div>

            {!method.allows_change && (
              <div className="grid justify-items-center gap-2 rounded-lg border bg-muted/40 p-3 text-center">
                {method.qr_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- QR served by the API, static export
                  <img src={method.qr_url} alt={`${method.name} QR code`} className="size-48 rounded bg-white object-contain p-1" />
                ) : (
                  <p className="py-6 text-sm text-muted-foreground">No {method.name} QR code yet. A manager can upload it under Payment methods.</p>
                )}
                {(method.account_name || method.account_number) && (
                  <p className="text-sm">
                    {method.account_name}
                    {method.account_number && <span className="block font-mono">{method.account_number}</span>}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Ask the customer to scan, pay {formatMoney(remaining)} and show the confirmation.</p>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="pay-amount">{method.allows_change ? "Cash received (₱)" : `${method.name} amount (₱)`}</Label>
              <Input
                id="pay-amount"
                inputMode="decimal"
                className="h-12 text-lg"
                placeholder={remaining}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
                aria-invalid={amount.trim() !== "" && typed === null ? true : undefined}
              />
              {method.allows_change && (
                <div className="flex flex-wrap gap-1.5">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setAmount(remaining)}>Exact</Button>
                  {BILLS.filter((bill) => cents(bill) >= cents(remaining) || bill === "1000").slice(0, 4).map((bill) => (
                    <Button key={bill} type="button" size="sm" variant="secondary" onClick={() => setAmount(bill)}>₱{bill}</Button>
                  ))}
                </div>
              )}
            </div>
            {method.requires_reference && (
              <div className="grid gap-1.5">
                <Label htmlFor="pay-reference">{method.name} reference number</Label>
                <Input id="pay-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} autoComplete="off" />
              </div>
            )}
            <Button type="button" variant="outline" onClick={addPending} disabled={!pending}>
              <MethodIcon aria-hidden /> Add {method.name} payment and split
            </Button>
          </div>

          <aside className="grid content-start gap-3 rounded-lg bg-muted/50 p-3" aria-label="Payment summary">
            <dl className="grid gap-1 text-sm">
              <div className="flex justify-between"><dt>Total</dt><dd className="numeric font-semibold">{formatMoney(total)}</dd></div>
              <div className="flex justify-between"><dt>Paid</dt><dd className="numeric">{formatMoney(result.paid)}</dd></div>
              <div className="flex justify-between"><dt>Still due</dt><dd className="numeric">{formatMoney(result.due)}</dd></div>
            </dl>
            <div className="rounded-md bg-card p-3 text-center">
              <p className="text-xs text-muted-foreground">Change</p>
              <p className="numeric text-3xl font-bold" aria-live="polite">{formatMoney(result.change)}</p>
            </div>
            {tenders.length > 0 && (
              <ul className="grid gap-1 text-sm" aria-label="Payments added">
                {tenders.map((t, i) => (
                  <li key={`${t.method}-${i}`} className="flex items-center justify-between gap-2">
                    <span>{byCode.get(t.method)?.name}{t.reference && <span className="block text-xs text-muted-foreground">Ref {t.reference}</span>}</span>
                    <span className="flex items-center gap-1">
                      <span className="numeric">{formatMoney(t.amount)}</span>
                      <Button size="icon-xs" variant="ghost" aria-label={`Remove ${byCode.get(t.method)?.name} payment`} onClick={() => setTenders(tenders.filter((_, j) => j !== i))}>
                        <X aria-hidden />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>

        {askApproval.length > 0 && <ApprovalFields idPrefix="pay-approval" permissions={askApproval} value={approval} onChange={setApproval} />}
        {(error || (all.length > 0 && result.problem)) && (
          <Alert variant="destructive"><AlertDescription>{error ?? result.problem}</AlertDescription></Alert>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Back to cart</Button>
          <Button size="lg" onClick={() => void complete()} disabled={!canComplete}>
            {busy ? "Completing…" : cents(result.change) > ZERO ? `Complete · change ${formatMoney(result.change)}` : "Complete sale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
