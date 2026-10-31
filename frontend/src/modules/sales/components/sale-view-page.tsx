"use client";

import { Ban, Undo2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQuantity, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { notify } from "@/lib/notify";
import { useCan } from "@/modules/auth/hooks";
import { AuditTrail } from "@/modules/system/components/audit-trail";
import { fetchSaleAnywhere, voidSaleAnywhere } from "@/modules/offline/runtime";
import { addCustomerToSale, fetchPaymentMethods, reprintSale, returnItems, type ReturnInput } from "@/modules/pos/api";
import { CustomerPicker } from "@/modules/pos/components/customer-picker";
import { ApprovalFields, emptyApproval, hasApproval } from "@/modules/pos/components/approval-fields";
import { PrintControls } from "@/modules/hardware/components/print-controls";
import { useHardware } from "@/modules/hardware/settings";
import { methodName, Receipt } from "@/modules/pos/components/receipt";
import { formatUnits, parse, ZERO } from "@/modules/pos/fixed-point";
import type { Approval, PosCustomer, Sale } from "@/modules/pos/types";

/** One sale: its receipt, and reprint, void and return. */
export function SaleViewPage() {
  const id = useSearchParams().get("id") ?? "";
  const found = useApiQuery(["sale", id], () => fetchSaleAnywhere(id));
  const canReprint = useCan("sales.reprint");
  const canViewCustomers = useCan("customers.view");
  const canManageCustomers = useCan("customers.manage");
  const paper = useHardware((s) => s.settings.paper);
  const [action, setAction] = useState<"void" | "return" | "customer" | null>(null);

  if (found.error) return <Alert variant="destructive"><AlertDescription>{found.error.message}</AlertDescription></Alert>;
  if (!found.data) return <Skeleton className="h-96" aria-busy="true" />;

  const data = found.data.sale;
  const local = found.data.local;
  const returnable = data.status === "completed" && (data.items ?? []).some((item) => parse(item.quantity) > parse(item.returned_quantity ?? "0"));


  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Sale ${data.receipt_number}`}
        description={`${formatDate(data.occurred_at)} ${formatTime(data.occurred_at)} · ${data.terminal?.code} · ${data.cashier?.name}`}
        actions={
          <>
            {returnable && !local && <Button variant="outline" onClick={() => setAction("return")}><Undo2 aria-hidden /> Return items</Button>}
            {data.status === "completed" && (data.returns ?? []).length === 0 && (
              <Button variant="destructive" onClick={() => setAction("void")}><Ban aria-hidden /> Void sale</Button>
            )}
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="grid content-start gap-3">
          <Receipt sale={data} paper={paper} />
          {/* Reprints are always possible; online ones are recorded in the audit log first. */}
          {canReprint && <PrintControls sale={data} reprint onReprint={local ? undefined : async () => { await reprintSale(data.id); notify.info("Reprint recorded", data.receipt_number); }} />}
        </div>
        <div className="grid gap-6">
          <Panel title="Status">
            <div className="grid gap-2 text-sm">
              <div>{data.status === "voided" ? <StatusBadge tone="danger">Voided</StatusBadge> : <StatusBadge tone="success">Completed</StatusBadge>}</div>
              {data.void && <p>Voided {formatDate(data.void.voided_at)} {formatTime(data.void.voided_at)}, approved by {data.void.voided_by}. Reason: {data.void.reason}</p>}
              <p className="text-muted-foreground">Paid {formatMoney(data.amount_paid)} with {data.payments?.map((p) => methodName(p.method)).join(" + ")}.</p>
              {data.customer_id && canViewCustomers && (
                <p>Customer: <Link href={`/customers/view?id=${data.customer_id}`} className="font-medium hover:underline">{data.customer_name ?? "View customer"}</Link></p>
              )}
              {data.customer_added && (
                <p>
                  Customer (added later by {data.customer_added.added_by}, {formatDate(data.customer_added.added_at)}):{" "}
                  {canViewCustomers ? <Link href={`/customers/view?id=${data.customer_added.customer_id}`} className="font-medium hover:underline">{data.customer_added.customer_name}</Link> : data.customer_added.customer_name}
                  <span className="block text-xs text-muted-foreground">Not on the printed receipt. The sale counts in the customer&apos;s purchase history.</span>
                </p>
              )}
              {!data.customer_id && !data.customer_added && data.status === "completed" && !local && canManageCustomers && (
                <div>
                  <Button size="sm" variant="outline" onClick={() => setAction("customer")}><UserPlus aria-hidden /> Add customer</Button>
                  <span className="mt-1 block text-xs text-muted-foreground">Forgot to choose the customer? Add them to this sale&apos;s record.</span>
                </div>
              )}
            </div>
          </Panel>
          {(data.returns ?? []).length > 0 && (
            <Panel title="Returns">
              <ul className="grid gap-2 text-sm">
                {data.returns!.map((r) => (
                  <li key={r.id} className="flex justify-between gap-3">
                    <span>
                      <span className="font-medium">{r.return_number}</span> · {formatDate(r.occurred_at)} · {r.reason}
                      <span className="block text-xs text-muted-foreground">by {r.processed_by} · refunded by {r.refunds.map((f) => methodName(f.method)).join(", ") || "—"}</span>
                    </span>
                    <span className="numeric">-{formatMoney(r.total_refund)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {!local && <AuditTrail type="sale" id={data.id} version={`${data.status}-${data.customer_added?.added_at ?? ""}-${data.returns?.length ?? 0}`} />}
        </div>
      </div>

      {action === "void" && <VoidDialog sale={data} local={local} onClose={() => setAction(null)} onDone={async (text) => { setAction(null); notify.success("Sale voided", text); await found.reload(); }} />}
      {action === "return" && <ReturnDialog sale={data} onClose={() => setAction(null)} onDone={async (text) => { setAction(null); notify.success("Return recorded", text); await found.reload(); }} />}
      {action === "customer" && <AddCustomerDialog sale={data} onClose={() => setAction(null)} onDone={async (text) => { setAction(null); notify.success("Customer added", text); await found.reload(); }} />}
    </div>
  );
}

/**
 * A customer forgotten at checkout. Completed sales never change, so the
 * customer is recorded beside the sale: it joins their purchase history, the
 * printed receipt stays as it is.
 */
function AddCustomerDialog({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!customer) return;
    setBusy(true);
    setError(null);
    try {
      await addCustomerToSale(sale.id, customer.id, reason.trim() || null);
      await onDone(`${customer.name} was added to sale ${sale.receipt_number}.`);
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add customer to {sale.receipt_number}</DialogTitle>
          <DialogDescription>
            The sale counts in the customer&apos;s purchase history. The sale itself and its printed receipt do not change.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <CustomerPicker value={customer} onChange={setCustomer} />
          <div className="grid gap-1.5">
            <Label htmlFor="add-customer-reason">Note (optional)</Label>
            <Input id="add-customer-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder="e.g. Forgot to choose the customer" />
          </div>
          <Alert>
            <AlertDescription>
              A senior citizen or PWD discount, or a business TIN on the receipt, cannot be added afterwards: void this sale and ring it up again with the customer.
            </AlertDescription>
          </Alert>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button onClick={() => void save()} disabled={!customer || busy}>{busy ? "Saving…" : "Add customer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({ sale, local, onClose, onDone }: { sale: Sale; local: boolean; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const canVoid = useCan("sales.void");
  const [reason, setReason] = useState("");
  const [approval, setApproval] = useState<Approval>(emptyApproval());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsApproval = !canVoid;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await voidSaleAnywhere(sale.id, local, reason.trim(), needsApproval ? approval : null);
      await onDone(`${sale.receipt_number} was voided and its stock returned.`);
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Void {sale.receipt_number}?</DialogTitle>
          <DialogDescription>
            Cancels the whole sale ({formatMoney(sale.grand_total)}): give the money back and the items go back to stock. Only possible while its shift is open; later, use a return.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="void-reason">Reason</Label>
          <Textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} rows={2} />
        </div>
        {needsApproval && <ApprovalFields idPrefix="void-approval" permissions={["sales.void"]} value={approval} onChange={setApproval} pinOnly={local} />}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          <Button variant="destructive" disabled={busy || reason.trim().length < 3 || (needsApproval && !hasApproval(approval))} onClick={() => void submit()}>
            {busy ? "Voiding…" : "Void sale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Condition = ReturnInput["items"][number]["condition"];

function ReturnDialog({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const canReturn = useCan("sales.return");
  const methods = useApiQuery(["payment-methods"], fetchPaymentMethods);
  const items = (sale.items ?? []).map((item) => ({ item, left: (parse(item.quantity) - parse(item.returned_quantity ?? "0")) }));
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [conditions, setConditions] = useState<Record<string, Condition>>({});
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [approval, setApproval] = useState<Approval>(emptyApproval());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = items.filter(({ item }) => (quantities[item.id] ?? "").trim() !== "");
  const selectedMethod = methods.data?.find((m) => m.code === method);
  const ready = chosen.length > 0 && reason.trim().length >= 3 && (canReturn || hasApproval(approval)) && (!selectedMethod?.requires_reference || reference.trim() !== "");

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await returnItems(sale.id, {
        reason: reason.trim(),
        items: chosen.map(({ item }) => ({ sale_item_id: item.id, quantity: quantities[item.id].trim(), condition: conditions[item.id] ?? "resellable" })),
        refund_method: method,
        refund_reference: reference.trim() || null,
        approval: canReturn ? null : approval,
      });
      await onDone(`${result.return_number}: refund ${formatMoney(result.total_refund)} by ${methodName(method)}.`);
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Return items from {sale.receipt_number}</DialogTitle>
          <DialogDescription>The refund is what the customer paid for those items, after discounts. Resellable items go back to stock.</DialogDescription>
        </DialogHeader>

        <ul className="grid gap-3">
          {items.map(({ item, left }) => (
            <li key={item.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_6rem_8rem] sm:items-end">
              <div className="min-w-0">
                <p className="font-medium">{item.product_name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatQuantity(item.quantity, item.unit_name)} sold for {formatMoney(item.line_total)}
                  {left > ZERO ? ` · up to ${formatUnits(left)} returnable` : " · fully returned"}
                </p>
              </div>
              <Input
                aria-label={`Quantity of ${item.product_name} to return`}
                inputMode="decimal"
                placeholder="0"
                disabled={left <= ZERO}
                value={quantities[item.id] ?? ""}
                onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value })}
              />
              <select
                aria-label={`Condition of ${item.product_name}`}
                disabled={left <= ZERO}
                value={conditions[item.id] ?? "resellable"}
                onChange={(e) => setConditions({ ...conditions, [item.id]: e.target.value as Condition })}
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
              >
                <option value="resellable">Resellable</option>
                <option value="damaged">Damaged</option>
                <option value="expired">Expired</option>
              </select>
            </li>
          ))}
        </ul>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="refund-method">Refund by</Label>
            <select id="refund-method" value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-md border bg-transparent px-2 text-sm">
              {(methods.data ?? []).filter((m) => m.is_active).map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
            </select>
          </div>
          {selectedMethod?.requires_reference && (
            <div className="grid gap-1.5">
              <Label htmlFor="refund-reference">{selectedMethod.name} reference number</Label>
              <Input id="refund-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
            </div>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="return-reason">Reason</Label>
          <Input id="return-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder="e.g. Dented can, wrong item" />
        </div>
        {!canReturn && <ApprovalFields idPrefix="return-approval" permissions={["sales.return"]} value={approval} onChange={setApproval} />}
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          <Button disabled={busy || !ready} onClick={() => void submit()}>{busy ? "Processing…" : "Process return"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
