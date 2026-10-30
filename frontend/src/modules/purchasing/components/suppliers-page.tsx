"use client";

import { Pencil, Plus, Truck } from "lucide-react";
import { useState, type FormEvent } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { SearchInput } from "@/components/search-input";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toApiError } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { useCan } from "@/modules/auth/hooks";

import { createSupplier, fetchSuppliers, updateSupplier, type SupplierInput } from "../api";
import type { Supplier } from "../types";
import { PurchasingNav } from "./purchasing-nav";

/** Suppliers with their open orders and what has been bought from them. */
export function SuppliersPage() {
  const canManage = useCan("purchasing.manage");
  const [filters, setFilters] = useState<{ q?: string; page: number }>({ page: 1 });
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const suppliers = useApiQuery(["suppliers", filters], () => fetchSuppliers(filters));

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Suppliers"
        description="Who the store buys from, payment terms and purchase totals."
        actions={canManage && <Button onClick={() => setEditing("new")}><Plus aria-hidden /> Add supplier</Button>}
      />
      <PurchasingNav />

      <Panel title="Suppliers" flush>
        <div className="px-5 pb-4">
          <SearchInput label="Search suppliers" placeholder="Name, code or contact" value={filters.q ?? ""} onChange={(q) => setFilters({ q: q || undefined, page: 1 })} />
        </div>
        {suppliers.error ? (
          <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{suppliers.error.message}</AlertDescription></Alert>
        ) : suppliers.loading ? (
          <div className="grid gap-3 px-5" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : suppliers.data?.data.length === 0 ? (
          <EmptyState icon={Truck} title="No suppliers found" />
        ) : (
          <Table className="numeric">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Supplier</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead className="hidden lg:table-cell">Terms</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Open orders</TableHead>
                <TableHead className="text-right">Purchased</TableHead>
                <TableHead className="w-12 pr-5"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.data?.data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="max-w-0 pl-5 sm:max-w-none">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {s.code}{!s.is_active && <> · <StatusBadge tone="neutral" className="align-middle">Inactive</StatusBadge></>}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {s.contact_person ?? "—"}
                    {s.phone && <span className="block text-xs text-muted-foreground">{s.phone}</span>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{s.payment_terms_days === 0 ? "Cash on delivery" : `${s.payment_terms_days} days`}</TableCell>
                  <TableCell className="hidden text-right sm:table-cell">{s.open_orders_count ?? 0}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {formatMoney(s.purchased_total ?? "0")}
                    {s.last_received_at && <span className="block text-xs text-muted-foreground">last {formatDate(s.last_received_at)}</span>}
                  </TableCell>
                  <TableCell className="pr-5">
                    {canManage && (
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Pencil aria-hidden /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination meta={suppliers.data?.meta} onPage={(page) => setFilters({ ...filters, page })} />
      </Panel>

      {editing && <SupplierDialog supplier={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={suppliers.reload} />}
    </div>
  );
}

function SupplierDialog({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<SupplierInput>(
    supplier ?? { name: "", contact_person: "", phone: "", email: "", address: "", tin: "", payment_terms_days: 0, notes: "", is_active: true },
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: SupplierInput) => setForm({ ...form, ...patch });
  const field = (key: keyof SupplierInput, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`supplier-${key}`}>{label}</Label>
      <Input id={`supplier-${key}`} value={(form[key] as string | null) ?? ""} onChange={(e) => set({ [key]: e.target.value })} {...props} />
    </div>
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data: SupplierInput = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === "" ? null : v]));
    try {
      if (supplier) await updateSupplier(supplier.id, data);
      else await createSupplier(data);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{supplier ? `Edit ${supplier.name}` : "Add supplier"}</DialogTitle>
          <DialogDescription>{supplier ? supplier.code : "A code (SUP-0001) is given automatically."}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          {field("name", "Name", { required: true, maxLength: 255, autoFocus: true })}
          <div className="grid gap-3 sm:grid-cols-2">
            {field("contact_person", "Contact person")}
            {field("phone", "Phone", { inputMode: "tel" })}
            {field("email", "Email", { type: "email" })}
            {field("tin", "TIN")}
          </div>
          {field("address", "Address")}
          <div className="grid gap-1.5">
            <Label htmlFor="supplier-terms">Payment terms (days, 0 = cash on delivery)</Label>
            <Input id="supplier-terms" type="number" min={0} max={365} value={form.payment_terms_days ?? 0} onChange={(e) => set({ payment_terms_days: Number(e.target.value) })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="supplier-notes">Notes</Label>
            <Textarea id="supplier-notes" rows={2} value={form.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.is_active ?? true} onCheckedChange={(checked) => set({ is_active: checked })} /> Active
          </label>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save supplier"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
