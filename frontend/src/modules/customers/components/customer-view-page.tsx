"use client";

import { Pencil, Receipt, UserRound } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toApiError } from "@/lib/api";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { notify } from "@/lib/notify";
import { useCan } from "@/modules/auth/hooks";
import { AuditTrail } from "@/modules/system/components/audit-trail";

import { fetchCustomer, fetchCustomerPurchases, updateCustomer } from "../api";
import { customerTypeLabel } from "../types";
import { CustomerDialog } from "./customer-dialog";

/** One customer: details, totals and purchase history. */
export function CustomerViewPage() {
  const id = useSearchParams().get("id") ?? "";
  const canManage = useCan("customers.manage");
  const canViewSales = useCan("sales.view");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const customer = useApiQuery(["customer", id], () => fetchCustomer(id));
  const purchases = useApiQuery(["customer-purchases", id, page], () => fetchCustomerPurchases(id, page));

  if (customer.error) return <Alert variant="destructive"><AlertDescription>{customer.error.message}</AlertDescription></Alert>;
  if (!customer.data) return <Skeleton className="h-96" aria-busy="true" />;
  const c = customer.data;

  const setActive = async (active: boolean) => {
    setMessage(null);
    try {
      await updateCustomer(c.id, { is_active: active });
      notify.success(active ? "Customer activated" : "Customer deactivated", c.name);
      await customer.reload();
    } catch (caught) {
      setMessage(toApiError(caught).message);
    }
  };

  const detail = (label: string, value: string | null) => (
    <div className="grid grid-cols-[8rem_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value || "—"}</dd>
    </div>
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title={c.name}
        description={[c.code, customerTypeLabel(c.type), c.is_active ? null : "Inactive"].filter(Boolean).join(" · ")}
        actions={canManage && (
          <>
            <Button variant="outline" onClick={() => void setActive(!c.is_active)}>{c.is_active ? "Deactivate" : "Activate"}</Button>
            <Button onClick={() => setEditing(true)}><Pencil aria-hidden /> Edit</Button>
          </>
        )}
      />
      {message && <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert>}
      {!c.is_active && (
        <Alert><AlertDescription>This customer is inactive: they cannot be chosen at checkout. Their purchase history is kept.</AlertDescription></Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Purchases" value={String(c.purchases_count ?? 0)} icon={Receipt} />
        <StatCard label="Total spent" value={formatMoney(c.purchases_total ?? "0")} />
        <StatCard label="Last purchase" value={c.last_purchase_at ? formatDate(c.last_purchase_at) : "—"} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="grid content-start gap-6">
        <Panel title="Details">
          <dl className="grid gap-2 text-sm">
            {detail("Type", customerTypeLabel(c.type))}
            {(c.type === "senior_citizen" || c.type === "pwd") && detail(c.type === "pwd" ? "PWD ID" : "SC ID", c.id_number)}
            {detail("Phone", c.phone)}
            {detail("Email", c.email)}
            {detail("TIN", c.tin)}
            {detail("Address", c.address)}
            {detail("Birth date", c.birth_date ? formatDate(c.birth_date) : null)}
            {detail("Notes", c.notes)}
            {detail("Customer since", c.created_at ? formatDate(c.created_at) : null)}
          </dl>
        </Panel>
        <AuditTrail type="customer" id={c.id} version={c.is_active} />
        </div>

        <Panel title="Purchase history" description="Voided sales are listed but not counted in the totals." flush>
          {purchases.error ? (
            <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{purchases.error.message}</AlertDescription></Alert>
          ) : purchases.loading ? (
            <div className="grid gap-3 px-5" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : purchases.data?.data.length === 0 ? (
            <EmptyState icon={UserRound} title="No purchases yet">Choose this customer at checkout to build their history.</EmptyState>
          ) : (
            <Table className="numeric">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Receipt</TableHead>
                  <TableHead className="hidden sm:table-cell">Date</TableHead>
                  <TableHead className="hidden md:table-cell">Cashier</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Items</TableHead>
                  <TableHead className="pr-5 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.data?.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="pl-5">
                      {canViewSales ? <Link href={`/sales/view?id=${s.id}`} className="font-medium hover:underline">{s.receipt_number}</Link> : <span className="font-medium">{s.receipt_number}</span>}
                      {s.status === "voided" && <> <StatusBadge tone="danger">Voided</StatusBadge></>}
                      {s.customer_added_later && <> <StatusBadge tone="neutral">Added later</StatusBadge></>}
                      <span className="block text-xs text-muted-foreground sm:hidden">{formatDate(s.occurred_at)}</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{formatDate(s.occurred_at)} {formatTime(s.occurred_at)}</TableCell>
                    <TableCell className="hidden md:table-cell">{s.cashier ?? "—"} · {s.terminal}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">{s.items_count ?? "—"}</TableCell>
                    <TableCell className={`pr-5 text-right ${s.status === "voided" ? "text-muted-foreground line-through" : ""}`}>{formatMoney(s.grand_total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Pagination meta={purchases.data?.meta} onPage={setPage} />
        </Panel>
      </div>

      {editing && <CustomerDialog customer={c} onClose={() => setEditing(false)} onSaved={() => customer.reload()} />}
    </div>
  );
}
