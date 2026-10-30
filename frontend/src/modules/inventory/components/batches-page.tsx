"use client";

import { CalendarCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { SegmentedControl } from "@/components/segmented-control";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, formatQuantity } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { useCan } from "@/modules/auth/hooks";

import { fetchBatches } from "../api";
import { expiryStatus } from "../status";

type Status = "all" | "expiring" | "expired";

/** Batches with stock left, in FEFO order (the batch that leaves first is on top). */
export function BatchesPage() {
  const params = useSearchParams();
  const canAdjust = useCan("inventory.adjust");
  const [skuId, setSkuId] = useState(params.get("sku_id") ?? undefined);
  const [status, setStatus] = useState<Status>("all");
  const [page, setPage] = useState(1);
  const batches = useApiQuery(["batches", skuId, status, page], () =>
    fetchBatches({ sku_id: skuId, status: status === "all" ? undefined : status, page }));
  const windowDays = batches.data?.meta?.expiry_warning_days;
  const scoped = skuId ? batches.data?.data[0]?.sku : undefined;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Batches & expiry"
        description={scoped ? `${scoped.name} (${scoped.code})` : "Stock by batch, earliest expiry first. Sales and stock-outs take from the top (FEFO)."}
        actions={
          <>
            {skuId && <LinkButton variant="outline" href="/inventory/batches" onClick={() => setSkuId(undefined)}>Show all products</LinkButton>}
            {canAdjust && <LinkButton variant="outline" href="/inventory/stock-out">Remove expired stock</LinkButton>}
          </>
        }
      />
      <Panel
        title="Batches"
        flush
        action={
          <SegmentedControl
            label="Expiry"
            value={status}
            onChange={(value) => { setStatus(value as Status); setPage(1); }}
            options={[
              { value: "all", label: "All" },
              { value: "expiring", label: windowDays ? `Next ${windowDays} days` : "Expiring" },
              { value: "expired", label: "Expired" },
            ]}
          />
        }
      >
        {batches.error ? (
          <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{batches.error.message}</AlertDescription></Alert>
        ) : batches.loading ? (
          <div className="grid gap-3 px-5" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : batches.data?.data.length === 0 ? (
          <EmptyState icon={CalendarCheck} title={status === "expired" ? "No expired stock" : "No batches"}>
            {status === "all" ? "Batches are created when stock is received." : "Nothing in this range."}
          </EmptyState>
        ) : (
          <Table className="numeric" aria-busy={batches.fetching}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Product · batch</TableHead>
                <TableHead className="hidden sm:table-cell">Expiry</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead className="hidden text-right md:table-cell">Unit cost</TableHead>
                <TableHead className="hidden lg:table-cell">Received</TableHead>
                <TableHead className="pr-5 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.data?.data.map((b) => {
                const badge = expiryStatus(b.days_left);
                return (
                  <TableRow key={b.id}>
                    <TableCell className="max-w-0 pl-5 sm:max-w-none">
                      <span className="block truncate font-medium">{b.sku.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{b.sku.code} · batch {b.batch_number}</span>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap sm:table-cell">{b.expiry_date ? formatDate(b.expiry_date) : "—"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {formatQuantity(b.remaining_quantity, b.sku.unit ?? undefined)}
                      <span className="block text-xs text-muted-foreground">of {formatQuantity(b.initial_quantity)}</span>
                    </TableCell>
                    <TableCell className="hidden text-right md:table-cell">{formatMoney(b.unit_cost)}</TableCell>
                    <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDate(b.received_at)}</TableCell>
                    <TableCell className="pr-5 text-right"><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pagination meta={batches.data?.meta} onPage={setPage} />
      </Panel>
    </div>
  );
}
