"use client";

import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, CalendarClock, ClipboardCheck, FileText, History, PackageX, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { SearchInput } from "@/components/search-input";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCount, formatDate, formatMoney, formatQuantity } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { useCan } from "@/modules/auth/hooks";
import { useCatalogRefs } from "@/modules/catalog/hooks";

import { fetchStock, type StockFilters } from "../api";
import { STOCK_STATUS } from "../status";

/** Stock overview: totals, filters and one row per stocked SKU. */
export function InventoryPage() {
  const canAdjust = useCan("inventory.adjust");
  const [filters, setFilters] = useState<StockFilters>({ page: 1 });
  const refs = useCatalogRefs();
  const stock = useApiQuery(["stock", filters], () => fetchStock(filters));
  const update = (patch: Partial<StockFilters>) => setFilters((current) => ({ ...current, page: 1, ...patch }));
  const summary = stock.data?.summary;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Inventory"
        description="Stock on hand per SKU. Every change is a posted document with its own movements."
        actions={
          <>
            {canAdjust && (
              <>
                <LinkButton href="/inventory/stock-in"><ArrowDownToLine aria-hidden /> Stock in</LinkButton>
                <LinkButton variant="outline" href="/inventory/stock-out"><ArrowUpFromLine aria-hidden /> Stock out</LinkButton>
                <LinkButton variant="outline" href="/inventory/count"><ClipboardCheck aria-hidden /> Count</LinkButton>
              </>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {summary ? (
          <>
            <StatCard label="SKUs in stock list" value={formatCount(summary.skus)} icon={Boxes} />
            <StatCard label="Low stock" value={formatCount(summary.low_stock)} icon={AlertTriangle} footnote="At or below the reorder level" />
            <StatCard label="Out of stock" value={formatCount(summary.out_of_stock)} icon={PackageX} />
            <StatCard label="Stock value" value={formatMoney(summary.stock_value)} icon={Wallet} footnote="At average cost" />
          </>
        ) : (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)
        )}
      </div>

      <nav aria-label="Inventory records" className="flex flex-wrap gap-2">
        <LinkButton size="sm" variant="ghost" href="/inventory/documents"><FileText aria-hidden /> Documents</LinkButton>
        <LinkButton size="sm" variant="ghost" href="/inventory/movements"><History aria-hidden /> Stock history</LinkButton>
        <LinkButton size="sm" variant="ghost" href="/inventory/batches"><CalendarClock aria-hidden /> Batches & expiry</LinkButton>
      </nav>

      <Panel title="Stock levels" flush>
        <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row">
          <SearchInput label="Search stock" placeholder="Name, SKU or barcode" value={filters.q ?? ""} onChange={(q) => update({ q: q || undefined })} />
          <NativeSelect aria-label="Category" value={filters.category_id ?? ""} onChange={(e) => update({ category_id: e.target.value || undefined })} className="sm:w-48">
            <option value="">All categories</option>
            {refs.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Stock status" value={filters.status ?? ""} onChange={(e) => update({ status: (e.target.value || undefined) as StockFilters["status"] })} className="sm:w-40">
            <option value="">Any stock level</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
            <option value="ok">In stock</option>
          </NativeSelect>
        </div>

        {stock.error ? (
          <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{stock.error.message}</AlertDescription></Alert>
        ) : stock.loading ? (
          <div className="grid gap-3 px-5" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : stock.data?.data.length === 0 ? (
          <EmptyState icon={Boxes} title="No stock found">Try a different search or filter.</EmptyState>
        ) : (
          <Table className="numeric" aria-busy={stock.fetching}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Product</TableHead>
                <TableHead className="pr-5 text-right sm:pr-2">On hand</TableHead>
                <TableHead className="hidden text-right md:table-cell">Reorder at</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Value</TableHead>
                <TableHead className="hidden lg:table-cell">Nearest expiry</TableHead>
                <TableHead className="hidden pr-5 text-right sm:table-cell">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stock.data?.data.map((row) => {
                const status = STOCK_STATUS[row.status];
                return (
                  <TableRow key={row.sku_id}>
                    <TableCell className="max-w-0 pl-5 sm:max-w-none">
                      <Link href={`/inventory/movements?sku_id=${row.sku_id}`} className="block min-w-0 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                        <span className="block truncate font-medium hover:underline">{row.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{row.sku_code}{row.category && ` · ${row.category}`}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="pr-5 text-right whitespace-nowrap sm:pr-2">
                      {formatQuantity(row.quantity_on_hand, row.unit)}
                      {row.status !== "ok" && (
                        <span className={`block text-xs font-medium sm:hidden ${row.status === "out" ? "text-danger" : "text-warning"}`}>{status.label}</span>
                      )}
                      {Number(row.quantity_allocated) > 0 && (
                        <span className="block text-xs text-muted-foreground">{formatQuantity(row.quantity_available)} available</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-right whitespace-nowrap text-muted-foreground md:table-cell">{formatQuantity(row.reorder_level, row.unit)}</TableCell>
                    <TableCell className="hidden text-right whitespace-nowrap lg:table-cell">{formatMoney(row.stock_value)}</TableCell>
                    <TableCell className="hidden whitespace-nowrap lg:table-cell">{row.nearest_expiry ? formatDate(row.nearest_expiry) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="hidden pr-5 text-right sm:table-cell"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pagination meta={stock.data?.meta} onPage={(page) => setFilters((current) => ({ ...current, page }))} />
      </Panel>
    </div>
  );
}
