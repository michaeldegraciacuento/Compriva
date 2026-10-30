"use client";

import { Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toApiError } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { describeConversion, skuUnits } from "@/modules/catalog/sku";
import type { Sku } from "@/modules/catalog/types";
import { SkuPicker } from "@/modules/inventory/components/sku-picker";
import { divRound, format, parse, roundCents, SCALE, sum, ZERO } from "@/modules/pos/fixed-point";

import { createOrder, fetchOrder, fetchSuppliers, updateOrder } from "../api";
import type { PurchaseOrder } from "../types";
import { PurchasingNav } from "./purchasing-nav";

interface Line {
  key: string;
  skuId: string;
  name: string;
  code: string;
  units: { id: string; label: string; factor: string }[];
  unitId: string;
  quantity: string;
  unitCost: string;
}

function lineTotal(line: Line): bigint | null {
  try {
    return divRound(parse(line.quantity) * parse(line.unitCost), SCALE * BigInt(100));
  } catch {
    return null;
  }
}

/** A new line for a picked SKU: in its first pack unit (supplier unit) if it has one, at the latest cost. */
function fromSku(sku: Sku): Line {
  const units = skuUnits(sku).map((u, i) => ({
    id: u.unit.id,
    label: i === 0 ? u.unit.name : `${u.unit.name} (${describeConversion(u.unit, u.factor, sku.base_unit)})`,
    factor: u.factor,
  }));
  const pack = sku.conversions.find((c) => c.is_purchase_unit && !c.is_base);
  const unit = units.find((u) => u.id === pack?.unit.id) ?? units[0];
  return {
    key: `${sku.id}-${unit.id}`, skuId: sku.id, name: sku.name, code: sku.code, units, unitId: unit.id, quantity: "1",
    unitCost: format(roundCents(multiply(sku.cost_price, unit.factor))),
  };
}

/** cost × factor as an exact decimal string. */
function multiply(cost: string, factor: string): string {
  const [ci, cf = ""] = cost.split(".");
  const [fi, ff = ""] = factor.split(".");
  const places = cf.length + ff.length;
  const text = (BigInt(ci + cf) * BigInt(fi + ff)).toString().padStart(places + 1, "0");
  return places === 0 ? text : `${text.slice(0, -places)}.${text.slice(-places)}`;
}

function fromOrder(order: PurchaseOrder): Line[] {
  return (order.items ?? []).map((item) => ({
    key: item.id, skuId: item.sku.id, name: item.sku.name, code: item.sku.code,
    units: [{ id: item.unit.id, label: item.unit.name, factor: item.conversion_factor }],
    unitId: item.unit.id, quantity: item.quantity_ordered.replace(/\.?0+$/, ""), unitCost: item.unit_cost.replace(/(\.\d\d)0+$/, "$1"),
  }));
}

/** New purchase order, or edit a draft (?id=). Totals here are a preview; the server computes the real ones. */
export function OrderFormPage() {
  const id = useSearchParams().get("id");
  const order = useApiQuery(["purchase-order", id], () => (id ? fetchOrder(id) : Promise.resolve(null)));
  if (id && !order.data) {
    return order.error ? <Alert variant="destructive"><AlertDescription>{order.error.message}</AlertDescription></Alert> : <Skeleton className="h-96" />;
  }
  return <OrderForm key={order.data?.id ?? "new"} order={order.data ?? null} />;
}

function OrderForm({ order }: { order: PurchaseOrder | null }) {
  const router = useRouter();
  const suppliers = useApiQuery(["suppliers-active"], () => fetchSuppliers({ status: "active", per_page: 200 }));
  const [supplierId, setSupplierId] = useState(order?.supplier?.id ?? "");
  const [expected, setExpected] = useState(order?.expected_date ?? "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(order ? fromOrder(order) : []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totals = lines.map(lineTotal);
  const total = sum(totals.map((t) => t ?? ZERO));
  const invalid = lines.some((line, i) => totals[i] === null || parse(line.quantity || "0") <= ZERO);
  const update = (key: string, patch: Partial<Line>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const input = {
      supplier_id: supplierId,
      expected_date: expected || null,
      notes: notes.trim() || null,
      items: lines.map((l) => ({ sku_id: l.skuId, unit_id: l.unitId, quantity: l.quantity, unit_cost: l.unitCost })),
    };
    try {
      const saved = order ? await updateOrder(order.id, input) : await createOrder(input);
      router.push(`/purchasing/orders/view?id=${saved.id}`);
    } catch (caught) {
      setError(toApiError(caught).message);
      setBusy(false);
    }
  };

  return (
    <form className="grid gap-6" onSubmit={submit}>
      <PageHeader title={order ? `Edit ${order.number}` : "New purchase order"} description="Saved as a draft. Order it when it is ready to send to the supplier." />
      <PurchasingNav />

      <Panel title="Supplier">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="po-supplier">Supplier</Label>
            <select id="po-supplier" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="h-9 rounded-md border bg-transparent px-2 text-sm">
              <option value="">Choose a supplier…</option>
              {suppliers.data?.data.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="po-expected">Expected delivery</Label>
            <Input id="po-expected" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="po-notes">Notes</Label>
            <Textarea id="po-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </Panel>

      <Panel title="Items" description="Order in the supplier's unit (box, case); cost is per that unit.">
        <div className="grid gap-4">
          <SkuPicker exclude={new Set(lines.map((l) => l.skuId))} onPick={(sku) => setLines([...lines, fromSku(sku)])} />
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Search for products to add them.</p>
          ) : (
            <ul className="grid gap-3">
              {lines.map((line, i) => (
                <li key={line.key} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_9rem_6rem_8rem_7rem_auto] sm:items-end">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{line.name}</p>
                    <p className="text-xs text-muted-foreground">{line.code}</p>
                  </div>
                  <select aria-label={`Unit for ${line.name}`} value={line.unitId} onChange={(e) => update(line.key, { unitId: e.target.value })} className="h-9 rounded-md border bg-transparent px-2 text-sm">
                    {line.units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                  <Input aria-label={`Quantity of ${line.name}`} inputMode="decimal" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} />
                  <Input aria-label={`Unit cost of ${line.name}`} inputMode="decimal" value={line.unitCost} onChange={(e) => update(line.key, { unitCost: e.target.value })} />
                  <p className="numeric text-right font-medium sm:pb-2">{totals[i] === null ? "—" : formatMoney(format(totals[i]!))}</p>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${line.name}`} onClick={() => setLines(lines.filter((l) => l.key !== line.key))}>
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-right text-lg font-semibold">Total {formatMoney(format(total))}</p>
        </div>
      </Panel>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={busy || !supplierId || lines.length === 0 || invalid}>{busy ? "Saving…" : order ? "Save draft" : "Create draft"}</Button>
      </div>
    </form>
  );
}
