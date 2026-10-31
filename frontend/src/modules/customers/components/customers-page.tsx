"use client";

import { Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { SearchInput } from "@/components/search-input";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { useCan } from "@/modules/auth/hooks";

import { fetchCustomers, type CustomerFilters } from "../api";
import { CUSTOMER_TYPES, customerTypeLabel, type CustomerType } from "../types";
import { CustomerDialog } from "./customer-dialog";

/** Customers with what they bought: search, filter by type, add. */
export function CustomersPage() {
  const router = useRouter();
  const canManage = useCan("customers.manage");
  const [filters, setFilters] = useState<CustomerFilters>({ status: "active", page: 1 });
  const [adding, setAdding] = useState(false);
  const customers = useApiQuery(["customers", filters], () => fetchCustomers(filters));
  const update = (patch: CustomerFilters) => setFilters({ ...filters, ...patch, page: 1 });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Customers"
        description="Regular buyers, senior citizens and PWDs (with their ID numbers), and businesses that need their TIN on receipts."
        actions={canManage && <Button onClick={() => setAdding(true)}><Plus aria-hidden /> Add customer</Button>}
      />

      <Panel title="Customers" flush>
        <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row sm:flex-wrap">
          <SearchInput label="Search customers" placeholder="Name, phone, code, ID or TIN" value={filters.q ?? ""} onChange={(q) => update({ q: q || undefined })} />
          <NativeSelect aria-label="Type" value={filters.type ?? ""} onChange={(e) => update({ type: (e.target.value || undefined) as CustomerType | undefined })} className="sm:w-44">
            <option value="">All types</option>
            {CUSTOMER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Status" value={filters.status ?? ""} onChange={(e) => update({ status: (e.target.value || undefined) as CustomerFilters["status"] })} className="sm:w-36">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="">All</option>
          </NativeSelect>
          <NativeSelect aria-label="Sort" value={filters.sort ?? "name"} onChange={(e) => update({ sort: e.target.value as CustomerFilters["sort"] })} className="sm:w-44">
            <option value="name">By name</option>
            <option value="recent">Recent buyers first</option>
            <option value="top">Top buyers first</option>
          </NativeSelect>
        </div>
        {customers.error ? (
          <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{customers.error.message}</AlertDescription></Alert>
        ) : customers.loading ? (
          <div className="grid gap-3 px-5" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : customers.data?.data.length === 0 ? (
          <EmptyState icon={UserRound} title="No customers found">{filters.q && "Try another name, phone or ID number."}</EmptyState>
        ) : (
          <Table className="numeric">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Customer</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead className="hidden lg:table-cell">ID / TIN</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Purchases</TableHead>
                <TableHead className="pr-5 text-right">Spent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.data?.data.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/customers/view?id=${c.id}`)}>
                  <TableCell className="max-w-0 pl-5 sm:max-w-none">
                    <Link href={`/customers/view?id=${c.id}`} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{c.name}</Link>
                    <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {c.code}
                      {c.type !== "regular" && <StatusBadge tone={c.type === "business" ? "neutral" : "info"}>{customerTypeLabel(c.type)}</StatusBadge>}
                      {!c.is_active && <StatusBadge tone="neutral">Inactive</StatusBadge>}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {c.phone ?? "—"}
                    {c.email && <span className="block text-xs text-muted-foreground">{c.email}</span>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{c.id_number ?? (c.tin ? `TIN ${c.tin}` : "—")}</TableCell>
                  <TableCell className="hidden text-right sm:table-cell">{c.purchases_count ?? 0}</TableCell>
                  <TableCell className="pr-5 text-right whitespace-nowrap">
                    {formatMoney(c.purchases_total ?? "0")}
                    {c.last_purchase_at && <span className="block text-xs text-muted-foreground">last {formatDate(c.last_purchase_at)}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination meta={customers.data?.meta} onPage={(page) => setFilters({ ...filters, page })} />
      </Panel>

      {adding && <CustomerDialog customer={null} onClose={() => setAdding(false)} onSaved={(c) => router.push(`/customers/view?id=${c.id}`)} />}
    </div>
  );
}
