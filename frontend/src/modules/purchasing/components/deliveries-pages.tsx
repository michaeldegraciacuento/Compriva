"use client";

import { History, PackageSearch } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { SearchInput } from "@/components/search-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, formatQuantity, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { trimDecimal } from "@/modules/catalog/sku";
import { SkuPicker } from "@/modules/inventory/components/sku-picker";

import { fetchCostHistory, fetchReceipt, fetchReceipts } from "../api";
import { PurchasingNav } from "./purchasing-nav";

/** Purchase history: every delivery received, newest first. */
export function DeliveriesPage() {
  const [filters, setFilters] = useState<{ q?: string; from?: string; to?: string; page: number }>({ page: 1 });
  const receipts = useApiQuery(["goods-receipts", filters], () => fetchReceipts(filters));

  return (
    <div className="grid gap-6">
      <PageHeader title="Purchase history" description="Every delivery received into stock, with its cost." />
      <PurchasingNav />
      <Panel title="Deliveries" flush>
        <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row">
          <SearchInput label="Search deliveries" placeholder="GR number or supplier reference" value={filters.q ?? ""} onChange={(q) => setFilters({ ...filters, q: q || undefined, page: 1 })} />
          <Input type="date" aria-label="From date" value={filters.from ?? ""} onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined, page: 1 })} className="sm:w-40" />
          <Input type="date" aria-label="To date" value={filters.to ?? ""} onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined, page: 1 })} className="sm:w-40" />
        </div>
        {receipts.error ? (
          <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{receipts.error.message}</AlertDescription></Alert>
        ) : receipts.loading ? (
          <div className="grid gap-3 px-5" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : receipts.data?.data.length === 0 ? (
          <EmptyState icon={History} title="No deliveries yet">Deliveries appear here when a purchase order is received.</EmptyState>
        ) : (
          <Table className="numeric">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Delivery</TableHead>
                <TableHead className="hidden md:table-cell">Supplier</TableHead>
                <TableHead className="hidden lg:table-cell">Order</TableHead>
                <TableHead className="pr-5 text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.data?.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-0 pl-5 sm:max-w-none">
                    <Link href={`/purchasing/deliveries/view?id=${r.id}`} className="font-medium hover:underline">{r.number}</Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span className="md:hidden">{r.supplier?.name} · </span>{formatDate(r.received_at)} {formatTime(r.received_at)}{r.supplier_reference && ` · ref ${r.supplier_reference}`}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{r.supplier?.name}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {r.purchase_order ? <Link href={`/purchasing/orders/view?id=${r.purchase_order.id}`} className="hover:underline">{r.purchase_order.number}</Link> : "—"}
                  </TableCell>
                  <TableCell className="pr-5 text-right">{formatMoney(r.total_cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination meta={receipts.data?.meta} onPage={(page) => setFilters({ ...filters, page })} />
      </Panel>
    </div>
  );
}

/** One delivery and what it added to stock. */
export function DeliveryViewPage() {
  const id = useSearchParams().get("id") ?? "";
  const receipt = useApiQuery(["goods-receipt", id], () => fetchReceipt(id));

  if (receipt.error) return <Alert variant="destructive"><AlertDescription>{receipt.error.message}</AlertDescription></Alert>;
  if (!receipt.data) return <Skeleton className="h-96" aria-busy="true" />;
  const r = receipt.data;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Delivery ${r.number}`}
        description={`${r.supplier?.name} · ${formatDate(r.received_at)} ${formatTime(r.received_at)} · received by ${r.received_by}${r.supplier_reference ? ` · ref ${r.supplier_reference}` : ""}`}
      />
      <PurchasingNav />
      <Panel title="Items received" description={r.purchase_order ? `Against ${r.purchase_order.number}` : undefined} flush>
        <Table className="numeric">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Product</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Unit cost</TableHead>
              <TableHead className="hidden md:table-cell">Batch / expiry</TableHead>
              <TableHead className="pr-5 text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.items?.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-0 pl-5 sm:max-w-none"><span className="block font-medium break-words">{item.sku.name}</span><span className="text-xs text-muted-foreground">{item.sku.code}</span></TableCell>
                <TableCell className="text-right whitespace-nowrap">{formatQuantity(item.quantity, item.unit.code)}</TableCell>
                <TableCell className="hidden text-right sm:table-cell">{formatMoney(item.unit_cost)}</TableCell>
                <TableCell className="hidden md:table-cell">{item.batch_number ?? "—"}{item.expiry_date && ` · ${formatDate(item.expiry_date)}`}</TableCell>
                <TableCell className="pr-5 text-right">{formatMoney(item.line_total)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="pl-5 font-semibold">Total</TableCell>
              <TableCell />
              <TableCell className="hidden sm:table-cell" />
              <TableCell className="hidden md:table-cell" />
              <TableCell className="pr-5 text-right font-semibold">{formatMoney(r.total_cost)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}

/** Cost tracking: what each delivery of a product cost, against the order and the current costs. */
export function CostHistoryPage() {
  const skuId = useSearchParams().get("sku_id");
  const router = useRouter();
  const history = useApiQuery(["cost-history", skuId], () => (skuId ? fetchCostHistory(skuId) : Promise.resolve(null)));
  const data = history.data;

  return (
    <div className="grid gap-6">
      <PageHeader title="Cost history" description="Purchase cost of a product per delivery, per base unit, with its latest and average cost." />
      <PurchasingNav />
      <Panel title="Product">
        <SkuPicker exclude={new Set()} onPick={(sku) => router.push(`/purchasing/costs?sku_id=${sku.id}`)} />
      </Panel>
      {history.error && <Alert variant="destructive"><AlertDescription>{history.error.message}</AlertDescription></Alert>}
      {!skuId ? (
        <EmptyState icon={PackageSearch} title="Pick a product">Its purchase costs appear here.</EmptyState>
      ) : !data ? (
        <Skeleton className="h-48" aria-busy="true" />
      ) : (
        <Panel
          title={data.sku.name}
          description={`${data.sku.code} · latest cost ${formatMoney(data.last_cost)} / ${data.sku.base_unit} · average cost ${data.average_cost ? formatMoney(data.average_cost) : "—"} / ${data.sku.base_unit}`}
          flush
        >
          {data.history.length === 0 ? (
            <EmptyState icon={History} title="Not purchased yet" />
          ) : (
            <Table className="numeric">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Delivery</TableHead>
                  <TableHead className="hidden md:table-cell">Supplier</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Cost / unit</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Ordered at</TableHead>
                  <TableHead className="pr-5 text-right">Per {data.sku.base_unit}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.history.map((h) => (
                  <TableRow key={`${h.receipt_id}-${h.unit}-${h.quantity}`}>
                    <TableCell className="pl-5">
                      <Link href={`/purchasing/deliveries/view?id=${h.receipt_id}`} className="font-medium hover:underline">{h.receipt_number}</Link>
                      <span className="block text-xs text-muted-foreground">{formatDate(h.received_at)}<span className="md:hidden"> · {h.supplier}</span></span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{h.supplier}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{trimDecimal(h.quantity)} {h.unit}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">{formatMoney(h.unit_cost)}</TableCell>
                    <TableCell className="hidden text-right lg:table-cell">{h.ordered_unit_cost ? formatMoney(h.ordered_unit_cost) : "—"}</TableCell>
                    <TableCell className="pr-5 text-right font-medium">{formatMoney(h.cost_per_base_unit)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      )}
    </div>
  );
}
