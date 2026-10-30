"use client";

import { Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { SearchInput } from "@/components/search-input";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { fetchSales, type SaleFilters } from "@/modules/pos/api";
import { methodName } from "@/modules/pos/components/receipt";

/** Sales history: every completed and voided sale, newest first. */
export function SalesPage() {
  const [filters, setFilters] = useState<SaleFilters>({ page: 1 });
  const sales = useApiQuery(["sales", filters], () => fetchSales(filters));
  const update = (patch: Partial<SaleFilters>) => setFilters((current) => ({ ...current, page: 1, ...patch }));

  return (
    <div className="grid gap-6">
      <PageHeader title="Sales" description="Completed sales are never edited. Voids and returns are recorded on the sale." />

      <Panel title="Sales" flush>
        <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row sm:flex-wrap">
          <SearchInput label="Search sales" placeholder="Receipt number or customer" value={filters.q ?? ""} onChange={(q) => update({ q: q || undefined })} />
          <NativeSelect aria-label="Status" value={filters.status ?? ""} onChange={(e) => update({ status: (e.target.value || undefined) as SaleFilters["status"] })} className="sm:w-40">
            <option value="">Any status</option>
            <option value="completed">Completed</option>
            <option value="voided">Voided</option>
          </NativeSelect>
          <Input type="date" aria-label="From date" value={filters.from ?? ""} onChange={(e) => update({ from: e.target.value || undefined })} className="sm:w-40" />
          <Input type="date" aria-label="To date" value={filters.to ?? ""} onChange={(e) => update({ to: e.target.value || undefined })} className="sm:w-40" />
        </div>

        {sales.error ? (
          <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{sales.error.message}</AlertDescription></Alert>
        ) : sales.loading ? (
          <div className="grid gap-3 px-5" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : sales.data?.data.length === 0 ? (
          <EmptyState icon={Receipt} title="No sales found">Sales appear here once they are completed at the POS.</EmptyState>
        ) : (
          <Table className="numeric" aria-busy={sales.fetching}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Receipt</TableHead>
                <TableHead className="hidden md:table-cell">Cashier</TableHead>
                <TableHead className="hidden lg:table-cell">Paid with</TableHead>
                <TableHead className="pr-5 text-right sm:pr-2">Total</TableHead>
                <TableHead className="hidden pr-5 text-right sm:table-cell">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.data?.data.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="pl-5">
                    <Link href={`/sales/view?id=${sale.id}`} className="block rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      {sale.receipt_number}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{formatDate(sale.occurred_at)} {formatTime(sale.occurred_at)} · {sale.items_count} lines</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{sale.cashier?.name}</TableCell>
                  <TableCell className="hidden lg:table-cell">{[...new Set(sale.payments?.map((p) => methodName(p.method)))].join(" + ")}</TableCell>
                  <TableCell className="pr-5 text-right whitespace-nowrap sm:pr-2">
                    {formatMoney(sale.grand_total)}
                    {sale.status === "voided" && <span className="block text-xs font-medium text-danger sm:hidden">Voided</span>}
                  </TableCell>
                  <TableCell className="hidden pr-5 text-right sm:table-cell">
                    {sale.status === "voided" ? <StatusBadge tone="danger">Voided</StatusBadge> : <StatusBadge tone="success">Completed</StatusBadge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination meta={sales.data?.meta} onPage={(page) => setFilters((current) => ({ ...current, page }))} />
      </Panel>
    </div>
  );
}
