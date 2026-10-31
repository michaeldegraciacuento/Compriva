"use client";

import { NativeSelect } from "@/components/native-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { CUSTOMER_TYPES, type CustomerInput, type CustomerType } from "../types";

/** What the type needs: SC and PWD customers need their ID card number; businesses usually give a TIN. */
export function customerProblem(form: CustomerInput): string | null {
  if (!form.name?.trim()) return "Enter the customer's name.";
  if (form.type === "senior_citizen" && !form.id_number?.trim()) return "Enter the senior citizen ID number.";
  if (form.type === "pwd" && !form.id_number?.trim()) return "Enter the PWD ID number.";
  return null;
}

/** Empty strings become null, so cleared fields are cleared on the server. */
export const customerPayload = (form: CustomerInput): CustomerInput =>
  Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v])) as CustomerInput;

/**
 * The customer form fields, shared by the Customers page and the POS quick add.
 * `compact` (POS) shows only what a sale needs: name, type, phone and the ID or TIN.
 */
export function CustomerFields({ form, set, idPrefix, compact = false }: {
  form: CustomerInput;
  set: (patch: CustomerInput) => void;
  idPrefix: string;
  compact?: boolean;
}) {
  const field = (key: "name" | "phone" | "email" | "address" | "tin" | "id_number", label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`${idPrefix}-${key}`}>{label}</Label>
      <Input id={`${idPrefix}-${key}`} value={form[key] ?? ""} onChange={(e) => set({ [key]: e.target.value })} {...props} />
    </div>
  );
  const type = form.type ?? "regular";
  const needsId = type === "senior_citizen" || type === "pwd";

  return (
    <div className="grid gap-3">
      {field("name", "Name", { required: true, maxLength: 255, autoFocus: true })}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-type`}>Type</Label>
          <NativeSelect id={`${idPrefix}-type`} value={type} onChange={(e) => set({ type: e.target.value as CustomerType })}>
            {CUSTOMER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </NativeSelect>
        </div>
        {field("phone", "Phone", { inputMode: "tel", maxLength: 30 })}
        {needsId && field("id_number", type === "senior_citizen" ? "Senior citizen ID number" : "PWD ID number", { required: true, maxLength: 50 })}
        {(type === "business" || !compact) && field("tin", "TIN", { maxLength: 20 })}
        {!compact && field("email", "Email", { type: "email", maxLength: 255 })}
        {!compact && (
          <div className="grid gap-1.5">
            <Label htmlFor={`${idPrefix}-birth`}>Birth date</Label>
            <Input id={`${idPrefix}-birth`} type="date" value={form.birth_date ?? ""} onChange={(e) => set({ birth_date: e.target.value })} />
          </div>
        )}
      </div>
      {(type === "business" || !compact) && field("address", type === "business" ? "Business address (printed on receipts)" : "Address", { maxLength: 255 })}
      {!compact && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
          <Textarea id={`${idPrefix}-notes`} rows={2} value={form.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} maxLength={2000} />
        </div>
      )}
    </div>
  );
}
