"use client";

import { useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toApiError } from "@/lib/api";
import { notify } from "@/lib/notify";

import { createCustomer, updateCustomer } from "../api";
import type { Customer, CustomerInput } from "../types";
import { CustomerFields, customerPayload, customerProblem } from "./customer-fields";

/** Adds a customer, or edits one. */
export function CustomerDialog({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: (customer: Customer) => void | Promise<void> }) {
  const [form, setForm] = useState<CustomerInput>(
    customer
      ? { name: customer.name, type: customer.type, phone: customer.phone, email: customer.email, address: customer.address, tin: customer.tin, id_number: customer.id_number, birth_date: customer.birth_date, notes: customer.notes }
      : { name: "", type: "regular" },
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = customerProblem(form);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = customer ? await updateCustomer(customer.id, customerPayload(form)) : await createCustomer(customerPayload(form));
      notify.success(customer ? "Customer saved" : "Customer added", saved.code ? `${saved.name} · ${saved.code}` : saved.name);
      await onSaved(saved);
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
          <DialogTitle>{customer ? `Edit ${customer.name}` : "Add customer"}</DialogTitle>
          <DialogDescription>{customer ? customer.code : "A code (C-0001) is given automatically. Senior citizens and PWDs need their ID number."}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <CustomerFields form={form} set={(patch) => setForm({ ...form, ...patch })} idPrefix="customer" />
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save customer"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
