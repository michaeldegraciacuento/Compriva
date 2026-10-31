"use client";

import { Plus, Search, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { notify } from "@/lib/notify";
import { useCan } from "@/modules/auth/hooks";
import { CustomerFields, customerPayload, customerProblem } from "@/modules/customers/components/customer-fields";
import { customerTypeLabel, type CustomerInput } from "@/modules/customers/types";

import { usePos } from "../backend-context";
import type { PosCustomer } from "../types";

/** One line about a customer: code, type and the number that matters for the sale. */
export function customerDetail(c: PosCustomer): string {
  const parts = [c.code, c.type === "regular" ? null : customerTypeLabel(c.type), c.id_number, c.type === "business" ? c.tin && `TIN ${c.tin}` : null, c.phone];
  return parts.filter(Boolean).join(" · ");
}

/**
 * Chooses the sale's customer: search by name, code, phone or ID number (the
 * terminal's cached list on desktop, so it works offline), or add one.
 */
export function CustomerPicker({ value, onChange }: { value: PosCustomer | null; onChange: (customer: PosCustomer | null) => void }) {
  const pos = usePos();
  const canCreate = useCan("customers.manage");
  const [searching, setSearching] = useState(value === null);
  // What is typed (used at once by "New") and what is searched (after a pause).
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    if (typed.trim() === q) return;
    const timer = window.setTimeout(() => setQ(typed.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [typed, q]);
  const [adding, setAdding] = useState<CustomerInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const results = useApiQuery(["pos-customers", pos.kind, searching, q], () => (searching ? pos.customers(q) : Promise.resolve([])));

  const choose = (customer: PosCustomer | null) => {
    onChange(customer);
    setSearching(customer === null);
    setAdding(null);
    setError(null);
  };

  const add = async () => {
    if (!adding) return;
    const problem = customerProblem(adding);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await pos.createCustomer(customerPayload(adding));
      notify.success("Customer added", created.name);
      choose(created);
    } catch (caught) {
      const apiError = toApiError(caught);
      setError(apiError.code === "NETWORK_ERROR" || apiError.code === "TIMEOUT"
        ? "New customers need a connection to the server. Type the name in the field below for now."
        : apiError.message);
    } finally {
      setBusy(false);
    }
  };

  // The picker sits inside the discount dialog's form: Enter here must not apply the dialog.
  const keepEnter = (action?: () => void) => (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      action?.();
    }
  };

  if (value && !searching) {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <UserRound className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{value.name}</p>
          <p className="truncate text-xs text-muted-foreground">{customerDetail(value)}</p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => setSearching(true)}>Change</Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove customer" onClick={() => choose(null)}><X aria-hidden /></Button>
      </div>
    );
  }

  if (adding) {
    // Not a nested <form>: this sits inside the discount dialog's form.
    return (
      <div className="grid gap-3 rounded-lg border p-3" role="group" aria-label="New customer" onKeyDown={keepEnter(() => void add())}>
        <CustomerFields form={adding} set={(patch) => setAdding({ ...adding, ...patch })} idPrefix="pos-customer" compact />
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => { setAdding(null); setError(null); }}>Cancel</Button>
          <Button type="button" onClick={() => void add()} disabled={busy}>{busy ? "Saving…" : "Save customer"}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-2" onKeyDown={keepEnter()}>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            aria-label="Find a customer"
            placeholder="Name, phone, code or ID number"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setQ(typed.trim())}
            className="pl-8"
          />
        </div>
        {canCreate && (
          <Button type="button" variant="outline" onClick={() => setAdding({ name: typed.trim(), type: "regular" })}><Plus aria-hidden /> New</Button>
        )}
        {value && <Button type="button" variant="ghost" onClick={() => setSearching(false)}>Cancel</Button>}
      </div>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {results.error ? (
        <p className="text-sm text-danger">{results.error.message}</p>
      ) : results.loading ? (
        <Skeleton className="h-10" />
      ) : results.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">{q ? "No customer found." : pos.kind === "local" ? "No customers on this terminal yet. They arrive with the next sync." : "No customers yet."}</p>
      ) : (
        <ul className="grid max-h-48 gap-1 overflow-y-auto" aria-label="Customers">
          {results.data?.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => choose(c)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{customerDetail(c)}</span>
                </span>
                {(c.type === "senior_citizen" || c.type === "pwd") && <StatusBadge tone="info">{customerTypeLabel(c.type)}</StatusBadge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
