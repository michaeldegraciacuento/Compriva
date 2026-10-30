"use client";

import { History } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, formatQuantity, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";

import { fetchMovements } from "../api";
import { MOVEMENT_LABELS, type MovementType } from "../types";

type Filters = { sku_id?: string; document_id?: string; type?: MovementType; from?: string; to?: string; page: number };

/** The stock ledger: every movement, newest first. Read-only by design. */
export function MovementsPage() {
  const params = useSearchParams();
  const [filters, setFilters] = useState<Filters>({
    page: 1,
    sku_id: params.get("sku_id") ?? undefined,
    document_id: params.get("document_id") ?? undefined,
  });
  const movements = useApiQuery(["movements", filters], () => fetchMovements(filters));
  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, page: 1, ...patch }));
  const scoped = filters.sku_id ? movements.data?.data[0]?.sku : undefined;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Stock history"
        description={scoped ? `${scoped.name} (${scoped.code})` : "Every stock movement, newest first. Movements are never edited or deleted."}
        actions={(filters.sku_id || filters.document_id) && (
          <LinkButton variant="outline" href="/inventory/movements" onClick={() => update({ sku_id: undefined, document_id: undefined })}>Show all products</LinkButton>
        )}
      />
      <Panel title="Movements" flush>
        <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row sm:items-center">
          <NativeSelect aria-label="Movement type" value={filters.type ?? ""} onChange={(e) => update({ type: (e.target.value || undefined) as MovementType })} className="sm:w-48">
            <option value="">All movement types</option>
            {Object.entries(MOVEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </NativeSelect>
          <Input type="date" aria-label="From date" value={filters.from ?? ""} onChange={(e) => update({ from: e.target.value || undefined })} className="sm:w-40" />
          <Input type="date" aria-label="To date" value={filters.to ?? ""} onChange={(e) => update({ to: e.target.value || undefined })} className="sm:w-40" />
        </div>
        {movements.error ? (
          <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{movements.error.message}</AlertDescription></Alert>
        ) : movements.loading ? (
          <div className="grid gap-3 px-5" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : movements.data?.data.length === 0 ? (
          <EmptyState icon={History} title="No movements">Posted stock documents and sales create movements here.</EmptyState>
        ) : (
          <Table className="numeric" aria-busy={movements.fetching}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">When</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Unit cost</TableHead>
                <TableHead className="hidden pr-5 sm:table-cell">Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.data?.data.map((m) => {
                const n = Number(m.quantity);
                return (
                  <TableRow key={m.id}>
                    <TableCell className="pl-5 whitespace-nowrap">
                      {formatDate(m.occurred_at)}
                      <span className="block text-xs text-muted-foreground">{formatTime(m.occurred_at)}</span>
                    </TableCell>
                    <TableCell className="max-w-0 sm:max-w-none">
                      <span className="block truncate font-medium">{m.sku.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {m.sku.code}{m.batch && ` · batch ${m.batch.batch_number}`}
                        <span className="md:hidden"> · {MOVEMENT_LABELS[m.type]}</span>
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{MOVEMENT_LABELS[m.type]}</TableCell>
                    <TableCell className={`text-right font-medium whitespace-nowrap ${n < 0 ? "text-danger" : "text-success"}`}>
                      {n > 0 ? "+" : n < 0 ? "−" : ""}{formatQuantity(String(Math.abs(n)))}
                    </TableCell>
                    <TableCell className="hidden text-right lg:table-cell">{formatMoney(m.unit_cost)}</TableCell>
                    <TableCell className="hidden pr-5 sm:table-cell">
                      {m.reference?.number ? (
                        m.reference.type === "stock_adjustment"
                          ? <Link href={`/inventory/documents/view?id=${m.reference.id}`} className="hover:underline">{m.reference.number}</Link>
                          : m.reference.number
                      ) : "—"}
                      {m.created_by && <span className="block text-xs text-muted-foreground">{m.created_by.name}</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pagination meta={movements.data?.meta} onPage={(page) => setFilters((current) => ({ ...current, page }))} />
      </Panel>
    </div>
  );
}
