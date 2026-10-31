"use client";

import { useState, type FormEvent, type ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toApiError } from "@/lib/api";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { notify } from "@/lib/notify";
import { SAMPLE_SALE } from "@/modules/hardware/sample-sale";
import { Receipt } from "@/modules/pos/components/receipt";

import { fetchSettings, updateSettings, updateStore } from "../api";
import type { SettingsGroup, StoreSettings } from "../types";

/**
 * Store details and the settings the whole store shares (docs/README.md).
 * Each section saves on its own; every change is audited and reaches desktop
 * terminals with their next sync. Printer and scanner settings are per computer,
 * on the Hardware page.
 */
export function SettingsPage() {
  const settings = useApiQuery(["settings"], fetchSettings);
  const [saved, setSaved] = useState<StoreSettings | null>(null);
  const data = saved ?? settings.data;

  if (settings.error) return <Alert variant="destructive"><AlertDescription>{settings.error.message}</AlertDescription></Alert>;
  if (!data) return <Skeleton className="h-96" aria-busy="true" />;

  return (
    <div className="grid gap-6">
      <PageHeader title="Settings" description="Store details, receipts, checkout rules and offline terminals. Printers and scanners are set per computer on the Hardware page." />
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="grid gap-6">
          <StoreSection data={data} onSaved={setSaved} />
          <ReceiptSection data={data} onSaved={setSaved} />
          <PosSection data={data} onSaved={setSaved} />
          <SyncSection data={data} onSaved={setSaved} />
          <InventorySection data={data} onSaved={setSaved} />
          <Panel title="Fixed in this version">
            <ul className="grid gap-1 text-sm text-muted-foreground">
              <li>Prices include VAT (12%); VAT-exempt items and SC/PWD sales are handled per sale.</li>
              <li>Stock is costed at weighted average cost.</li>
              <li>Time zone {data.store.timezone}, currency {data.store.currency}.</li>
            </ul>
          </Panel>
        </div>
        <div className="grid content-start gap-2 xl:sticky xl:top-20">
          <p className="text-sm font-medium">Receipt preview</p>
          <Receipt
            sale={{ ...SAMPLE_SALE, store: { ...data.store }, receipt: { ...data.settings.receipt, paper_size: "80mm" } }}
            paper="80mm"
          />
        </div>
      </div>
    </div>
  );
}

type SectionProps = { data: StoreSettings; onSaved: (data: StoreSettings) => void };

/** A section's form: Save, the result, and who changed it last. */
function Section({ title, description, group, data, onSubmit, children, dirty }: {
  title: string;
  description: string;
  group?: SettingsGroup;
  data: StoreSettings;
  onSubmit: () => Promise<void>;
  children: ReactNode;
  dirty: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const updated = group ? data.updated[group] : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      await onSubmit();
      notify.success(`${title} saved`, group ? "Desktop terminals get the change at their next sync." : undefined);
    } catch (caught) {
      setResult({ ok: false, text: toApiError(caught).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={title} description={description}>
      <form className="grid gap-4" onSubmit={submit}>
        {children}
        {result && <Alert variant={result.ok ? "default" : "destructive"}><AlertDescription>{result.text}</AlertDescription></Alert>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {updated?.at && `Last changed ${formatDate(updated.at)} ${formatTime(updated.at)}${updated.by ? ` by ${updated.by}` : ""}`}
          </span>
          <Button type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Panel>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function StoreSection({ data, onSaved }: SectionProps) {
  const initial = { name: data.store.name, legal_name: data.store.legal_name ?? "", tin: data.store.tin ?? "", address: data.store.address ?? "", phone: data.store.phone ?? "", email: data.store.email ?? "", is_vat_registered: data.store.is_vat_registered };
  const [form, setForm] = useState(initial);
  const text = (key: "name" | "legal_name" | "tin" | "address" | "phone" | "email", label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <Field id={`store-${key}`} label={label}>
      <Input id={`store-${key}`} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
    </Field>
  );

  return (
    <Section
      title="Store"
      description="Printed at the top of every receipt."
      data={data}
      dirty={!same(form, initial)}
      onSubmit={async () => {
        const nullIfBlank = (v: string) => v.trim() || null;
        onSaved(await updateStore({ name: form.name.trim(), legal_name: nullIfBlank(form.legal_name), tin: nullIfBlank(form.tin), address: nullIfBlank(form.address), phone: nullIfBlank(form.phone), email: nullIfBlank(form.email), is_vat_registered: form.is_vat_registered }));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {text("name", "Store name", { required: true, maxLength: 255 })}
        {text("legal_name", "Registered business name", { maxLength: 255 })}
        {text("tin", "TIN", { maxLength: 20, placeholder: "123-456-789-000", pattern: "[0-9-]*", title: "Digits and dashes" })}
        {text("phone", "Phone", { maxLength: 30, inputMode: "tel" })}
        {text("email", "Email", { type: "email", maxLength: 255 })}
        {text("address", "Address", { maxLength: 255 })}
      </div>
      <Toggle id="store-vat" label="VAT-registered" hint="Receipts label the store's TIN “VAT Reg TIN” (on) or “Non-VAT TIN” (off)." checked={form.is_vat_registered} onChange={(v) => setForm({ ...form, is_vat_registered: v })} />
    </Section>
  );
}

function ReceiptSection({ data, onSaved }: SectionProps) {
  const initial = { header: data.settings.receipt.header_lines.join("\n"), footer_text: data.settings.receipt.footer_text ?? "", show_vat_breakdown: data.settings.receipt.show_vat_breakdown };
  const [form, setForm] = useState(initial);
  const lines = form.header.split("\n").map((l) => l.trim()).filter(Boolean);
  const tooMany = lines.length > 5;
  const tooLong = lines.some((l) => l.length > 48);

  return (
    <Section
      title="Receipts"
      description="Extra lines under the store details, and the closing message. The preview shows the result."
      group="receipt"
      data={data}
      dirty={!same(form, initial) && !tooMany && !tooLong}
      onSubmit={async () => onSaved(await updateSettings("receipt", { header_lines: lines, footer_text: form.footer_text.trim() || null, show_vat_breakdown: form.show_vat_breakdown }))}
    >
      <Field id="receipt-header" label="Header lines (one per line, up to 5)" hint={tooMany ? "At most 5 lines." : tooLong ? "Keep each line to 48 characters (80 mm paper)." : "e.g. opening hours, a branch name, or a permit number."}>
        <Textarea id="receipt-header" rows={3} value={form.header} onChange={(e) => setForm({ ...form, header: e.target.value })} aria-invalid={tooMany || tooLong ? true : undefined} />
      </Field>
      <Field id="receipt-footer" label="Footer message">
        <Input id="receipt-footer" value={form.footer_text} onChange={(e) => setForm({ ...form, footer_text: e.target.value })} maxLength={200} />
      </Field>
      <Toggle id="receipt-vat" label="Show the VAT breakdown" hint="VATable sales, VAT, VAT-exempt and zero-rated amounts at the bottom of the receipt." checked={form.show_vat_breakdown} onChange={(v) => setForm({ ...form, show_vat_breakdown: v })} />
    </Section>
  );
}

function PosSection({ data, onSaved }: SectionProps) {
  const pos = data.settings.pos;
  const initial = { max_cash_in_drawer: String(Number(pos.max_cash_in_drawer)), allocation_share_percent: String(pos.allocation_share_percent), allow_over_allocation: pos.allow_over_allocation };
  const [form, setForm] = useState(initial);

  return (
    <Section
      title="Checkout and terminal stock"
      description="Rules for the point of sale and how stock is shared with desktop terminals."
      group="pos"
      data={data}
      dirty={!same(form, initial)}
      onSubmit={async () => onSaved(await updateSettings("pos", { max_cash_in_drawer: form.max_cash_in_drawer, allocation_share_percent: Number(form.allocation_share_percent), allow_over_allocation: form.allow_over_allocation }))}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pos-cash-limit" label="Cash drawer limit (₱)" hint={`The register asks for a cash drop when the drawer holds more than ${formatMoney(form.max_cash_in_drawer || "0")}. 0 turns the reminder off.`}>
          <Input id="pos-cash-limit" inputMode="decimal" value={form.max_cash_in_drawer} onChange={(e) => setForm({ ...form, max_cash_in_drawer: e.target.value })} required pattern="\d+(\.\d{1,2})?" />
        </Field>
        <Field id="pos-share" label="Stock shared with terminals (%)" hint="Of the stock not yet allocated, terminals together may hold this much to sell offline (10–100). The rest stays for the web POS.">
          <Input id="pos-share" type="number" min={10} max={100} value={form.allocation_share_percent} onChange={(e) => setForm({ ...form, allocation_share_percent: e.target.value })} required />
        </Field>
      </div>
      <Toggle
        id="pos-over"
        label="Let terminals sell beyond their allocation"
        hint="Off (recommended): a terminal refuses a sale when its allocated stock runs out, so stock never goes negative. On: the sale goes through and a conflict is raised for a manager to review."
        checked={form.allow_over_allocation}
        onChange={(v) => setForm({ ...form, allow_over_allocation: v })}
      />
    </Section>
  );
}

function SyncSection({ data, onSaved }: SectionProps) {
  const initial = String(data.settings.sync.max_offline_hours);
  const [hours, setHours] = useState(initial);

  return (
    <Section
      title="Offline terminals"
      description="Desktop terminals keep selling without internet, for a limited time."
      group="sync"
      data={data}
      dirty={hours !== initial}
      onSubmit={async () => onSaved(await updateSettings("sync", { max_offline_hours: Number(hours) }))}
    >
      <Field id="sync-hours" label="Maximum hours without syncing" hint="After this, a terminal stops selling until it syncs, and offline PIN sign-in expires. 1–168 hours (7 days).">
        <Input id="sync-hours" type="number" min={1} max={168} value={hours} onChange={(e) => setHours(e.target.value)} required className="sm:max-w-40" />
      </Field>
    </Section>
  );
}

function InventorySection({ data, onSaved }: SectionProps) {
  const initial = String(data.settings.inventory.expiry_warning_days);
  const [days, setDays] = useState(initial);

  return (
    <Section
      title="Inventory"
      description="Alerts on the dashboard and in reports."
      group="inventory"
      data={data}
      dirty={days !== initial}
      onSubmit={async () => onSaved(await updateSettings("inventory", { expiry_warning_days: Number(days) }))}
    >
      <Field id="inventory-expiry" label="Expiry warning (days)" hint="Batches expiring within this many days are flagged as expiring soon. 1–365.">
        <Input id="inventory-expiry" type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} required className="sm:max-w-40" />
      </Field>
    </Section>
  );
}
