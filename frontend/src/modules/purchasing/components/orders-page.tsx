"use client";

import { ClipboardList, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { SearchInput } from "@/components/search-input";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { useCan } from "@/modules/auth/hooks";

import { fetchOrders } from "../api";
import type { OrderStatus } from "../types";
import { ORDER_STATUS, PurchasingNav } from "./purchasing-nav";

/** Purchase orders, newest first. */
export function OrdersPage() {
  const canManage = useCan("purchasing.manage");
  const [filters, setFilters] = useState<{ q?: string; status?: OrderStatus; page: number }>({ page: 1 });
  const orders = useApiQuery(["purchase-orders", filters], () => fetchOrders(filters));

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Purchasing"
        description="Order from suppliers, receive deliveries (in parts if needed) and track what stock costs."
        actions={canManage && <LinkButton href="/purchasing/orders/new"><Plus aria-hidden /> New purchase order</LinkButton>}
      />
      <PurchasingNav />

      <Panel title="Purchase orders" flush>
        <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row">
          <SearchInput label="Search orders" placeholder="PO number" value={filters.q ?? ""} onChange={(q) => setFilters({ ...filters, q: q || undefined, page: 1 })} />
          <NativeSelect aria-label="Status" value={filters.status ?? ""} onChange={(e) => setFilters({ ...filters, status: (e.target.value || undefined) as OrderStatus, page: 1 })} className="sm:w-48">
            <option value="">Any status</option>
            {Object.entries(ORDER_STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
          </NativeSelect>
        </div>
        {orders.error ? (
          <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{orders.error.message}</AlertDescription></Alert>
        ) : orders.loading ? (
          <div className="grid gap-3 px-5" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : orders.data?.data.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No purchase orders yet">Create one to order stock from a supplier.</EmptyState>
        ) : (
          <Table className="numeric" aria-busy={orders.fetching}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Order</TableHead>
                <TableHead className="hidden md:table-cell">Supplier</TableHead>
                <TableHead className="hidden lg:table-cell">Expected</TableHead>
                <TableHead className="pr-5 text-right sm:pr-2">Total</TableHead>
                <TableHead className="hidden pr-5 text-right sm:table-cell">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.data?.data.map((order) => {
                const status = ORDER_STATUS[order.status];
                return (
                  <TableRow key={order.id}>
                    <TableCell className="max-w-0 pl-5 sm:max-w-none">
                      <Link href={`/purchasing/orders/view?id=${order.id}`} className="block rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50">
                        {order.number}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="md:hidden">{order.supplier?.name} · </span>{formatDate(order.order_date)} · {order.items_count} lines
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{order.supplier?.name}</TableCell>
                    <TableCell className="hidden lg:table-cell">{order.expected_date ? formatDate(order.expected_date) : "—"}</TableCell>
                    <TableCell className="pr-5 text-right whitespace-nowrap sm:pr-2">
                      {formatMoney(order.total)}
                      <span className="block text-xs text-muted-foreground sm:hidden">{status.label}</span>
                    </TableCell>
                    <TableCell className="hidden pr-5 text-right sm:table-cell"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Pagination meta={orders.data?.meta} onPage={(page) => setFilters({ ...filters, page })} />
      </Panel>
    </div>
  );
}
