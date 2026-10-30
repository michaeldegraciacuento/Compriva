"use client";

import { Ban, PackageCheck, Pencil, Send } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { LinkButton } from "@/components/link-button";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toApiError } from "@/lib/api";
import { formatDate, formatMoney, formatQuantity, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { useCan } from "@/modules/auth/hooks";
import { trimDecimal } from "@/modules/catalog/sku";
import { parse, ZERO } from "@/modules/pos/fixed-point";

import { approveOrder, cancelOrder, fetchOrder, receiveOrder } from "../api";
import type { PurchaseOrder } from "../types";
import { ORDER_STATUS, PurchasingNav } from "./purchasing-nav";

/** One purchase order: its lines, ordering, cancelling and receiving deliveries. */
export function OrderViewPage() {
  const id = useSearchParams().get("id") ?? "";
  const order = useApiQuery(["purchase-order", id], () => fetchOrder(id));
  const canManage = useCan("purchasing.manage");
  const canApprove = useCan("purchasing.approve");
  const canReceive = useCan("purchasing.receive");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (order.error) return <Alert variant="destructive"><AlertDescription>{order.error.message}</AlertDescription></Alert>;
  if (!order.data) return <Skeleton className="h-96" aria-busy="true" />;
  const data = order.data;
  const status = ORDER_STATUS[data.status];
  const receivable = data.status === "ordered" || data.status === "partially_received";

  const act = async (action: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await action();
      setMessage(done);
      await order.reload();
    } catch (caught) {
      setError(toApiError(caught).message);
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Purchase order ${data.number}`}
        description={`${data.supplier?.name} · ordered ${formatDate(data.order_date)}${data.expected_date ? ` · expected ${formatDate(data.expected_date)}` : ""}`}
        actions={
          <>
            {data.status === "draft" && canManage && <LinkButton variant="outline" href={`/purchasing/orders/edit?id=${data.id}`}><Pencil aria-hidden /> Edit</LinkButton>}
            {data.status === "draft" && canApprove && (
              <ConfirmDialog
                trigger={<Button><Send aria-hidden /> Place order</Button>}
                title={`Place ${data.number}?`}
                description="The order is sent to the supplier and can no longer be edited. Deliveries can then be received."
                confirmLabel="Place order"
                onConfirm={() => act(() => approveOrder(data.id), `${data.number} is ordered.`)}
              />
            )}
            {(data.status === "draft" || data.status === "ordered") && canManage && (
              <ConfirmDialog
                trigger={<Button variant="outline"><Ban aria-hidden /> Cancel order</Button>}
                title={`Cancel ${data.number}?`}
                description="Only possible before anything has been delivered."
                confirmLabel="Cancel order"
                destructive
                onConfirm={() => act(() => cancelOrder(data.id), `${data.number} was cancelled.`)}
              />
            )}
          </>
        }
      />
      <PurchasingNav />
      {message && <Alert><AlertDescription>{message}</AlertDescription></Alert>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <Panel title="Order" action={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>} flush>
        <Table className="numeric">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Product</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Received</TableHead>
              <TableHead className="hidden text-right md:table-cell">Unit cost</TableHead>
              <TableHead className="pr-5 text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items?.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-0 pl-5 sm:max-w-none">
                  <span className="block font-medium break-words">{item.sku.name}</span>
                  <Link href={`/purchasing/costs?sku_id=${item.sku.id}`} className="text-xs text-muted-foreground hover:underline">{item.sku.code} · cost history</Link>
                </TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {formatQuantity(item.quantity_ordered, item.unit.code)}
                  <span className="block text-xs text-muted-foreground sm:hidden">{trimDecimal(item.quantity_received)} received</span>
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">{trimDecimal(item.quantity_received)}</TableCell>
                <TableCell className="hidden text-right md:table-cell">{formatMoney(item.unit_cost)}</TableCell>
                <TableCell className="pr-5 text-right">{formatMoney(item.line_total)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="pl-5 font-semibold" colSpan={2}>Total</TableCell>
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden md:table-cell" />
              <TableCell className="pr-5 text-right font-semibold">{formatMoney(data.total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="px-5 pt-3 text-xs text-muted-foreground">
          Created by {data.created_by}{data.approved_by && ` · ordered by ${data.approved_by}`}{data.notes && ` · ${data.notes}`}
        </p>
      </Panel>

      {receivable && canReceive && (
        // Keyed by what has arrived, so the form starts again from the new remaining quantities after each delivery.
        <ReceivePanel key={data.items?.map((i) => i.quantity_received).join("|")} order={data} onReceived={(text) => act(async () => undefined, text)} />
      )}

      {(data.receipts ?? []).length > 0 && (
        <Panel title="Deliveries">
          <ul className="grid gap-2 text-sm">
            {data.receipts!.map((r) => (
              <li key={r.id} className="flex justify-between gap-3">
                <span>
                  <Link href={`/purchasing/deliveries/view?id=${r.id}`} className="font-medium hover:underline">{r.number}</Link>
                  <span className="text-muted-foreground"> · {formatDate(r.received_at)} {formatTime(r.received_at)} · {r.received_by}{r.supplier_reference && ` · ref ${r.supplier_reference}`}</span>
                </span>
                <span className="numeric">{formatMoney(r.total_cost)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/** Record a delivery: what arrived per line (defaults to everything still expected), its cost, and batch/expiry when tracked. */
function ReceivePanel({ order, onReceived }: { order: PurchaseOrder; onReceived: (message: string) => Promise<void> }) {
  const open = (order.items ?? []).filter((item) => parse(item.quantity_remaining) > ZERO);
  const [rows, setRows] = useState(() =>
    Object.fromEntries(open.map((item) => [item.id, { quantity: trimDecimal(item.quantity_remaining), cost: trimDecimal(item.unit_cost), batch: "", expiry: "" }])),
  );
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (id: string, patch: Partial<(typeof rows)[string]>) => setRows({ ...rows, [id]: { ...rows[id], ...patch } });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const receipt = await receiveOrder(order.id, {
        supplier_reference: reference.trim() || null,
        lines: open
          .filter((item) => rows[item.id].quantity.trim() !== "" && rows[item.id].quantity.trim() !== "0")
          .map((item) => ({
            purchase_order_item_id: item.id,
            quantity: rows[item.id].quantity.trim(),
            unit_cost: rows[item.id].cost.trim() || null,
            batch_number: rows[item.id].batch.trim() || null,
            expiry_date: rows[item.id].expiry || null,
          })),
      });
      await onReceived(`${receipt.number} received: stock added, ${formatMoney(receipt.total_cost)} at cost.`);
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Receive a delivery" description="Enter what actually arrived. Leave a line at 0 if it did not come; the rest stays open for the next delivery.">
      <form className="grid gap-4" onSubmit={submit}>
        <ul className="grid gap-3">
          {open.map((item) => (
            <li key={item.id} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[1fr_7rem_7rem_8rem_9rem] md:items-end">
              <div className="min-w-0">
                <p className="truncate font-medium">{item.sku.name}</p>
                <p className="text-xs text-muted-foreground">{trimDecimal(item.quantity_remaining)} {item.unit.code} still expected</p>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`rcv-qty-${item.id}`} className="text-xs">Qty ({item.unit.code})</Label>
                <Input id={`rcv-qty-${item.id}`} inputMode="decimal" value={rows[item.id].quantity} onChange={(e) => set(item.id, { quantity: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`rcv-cost-${item.id}`} className="text-xs">Cost / {item.unit.code}</Label>
                <Input id={`rcv-cost-${item.id}`} inputMode="decimal" value={rows[item.id].cost} onChange={(e) => set(item.id, { cost: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`rcv-batch-${item.id}`} className="text-xs">Batch{item.sku.tracks.batches ? "" : " (optional)"}</Label>
                <Input id={`rcv-batch-${item.id}`} value={rows[item.id].batch} onChange={(e) => set(item.id, { batch: e.target.value })} required={item.sku.tracks.batches} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`rcv-exp-${item.id}`} className="text-xs">Expiry{item.sku.tracks.expiry ? "" : " (optional)"}</Label>
                <Input id={`rcv-exp-${item.id}`} type="date" value={rows[item.id].expiry} onChange={(e) => set(item.id, { expiry: e.target.value })} required={item.sku.tracks.expiry} />
              </div>
            </li>
          ))}
        </ul>
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="rcv-reference">Supplier invoice / DR number</Label>
          <Input id="rcv-reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={50} />
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div>
          <Button type="submit" disabled={busy}><PackageCheck aria-hidden /> {busy ? "Receiving…" : "Receive into stock"}</Button>
        </div>
      </form>
    </Panel>
  );
}
