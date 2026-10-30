"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { History, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DialogForm } from "@/components/dialog-form";
import { FormField } from "@/components/form-field";
import { LinkButton } from "@/components/link-button";
import { SelectField } from "@/components/select-field";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, formatQuantity, formatTime } from "@/lib/format";
import { factorField, moneyField } from "@/lib/schemas";
import { useApiQuery } from "@/lib/use-api-query";
import { useCan } from "@/modules/auth/hooks";

import { addBarcode, addConversion, fetchPriceHistory, removeBarcode, removeConversion, setPrice, setSkuActive, updateSku } from "../api";
import type { Sku, Unit } from "../types";
import { describeConversion, skuUnits, trimDecimal } from "../sku";
import { BARCODE_TYPES } from "./sku-fields";

const TIERS = [
  { value: "retail", label: "Retail" },
  { value: "wholesale", label: "Wholesale" },
  { value: "member", label: "Member" },
] as const;

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// --- Dialogs ---------------------------------------------------------------------

const priceSchema = z.object({
  unit_id: z.string().min(1, "Choose a unit."),
  tier: z.enum(["retail", "wholesale", "member"]),
  price: moneyField("Price"),
  effective_from: z.string(),
});

function PriceDialog({ sku, onSaved }: { sku: Sku; onSaved: () => Promise<void> }) {
  const form = useForm<z.infer<typeof priceSchema>>({
    resolver: zodResolver(priceSchema),
    defaultValues: { unit_id: sku.base_unit.id, tier: "retail", price: "", effective_from: "" },
  });
  const { register, formState: { errors } } = form;

  return (
    <DialogForm
      trigger={<Button size="sm" variant="outline"><Plus aria-hidden /> Set price</Button>}
      title={`Set price · ${sku.name}`}
      description="Prices are never edited in place: a new price starts now or at the time you choose, and the old one stays in the history."
      submitLabel="Save price"
      form={form}
      fields={["unit_id", "tier", "price", "effective_from"]}
      onSubmit={async (values) => {
        await setPrice(sku.id, {
          unit_id: values.unit_id,
          tier: values.tier,
          price: values.price,
          effective_from: values.effective_from ? new Date(values.effective_from).toISOString() : null,
        });
        await onSaved();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id={`price-unit-${sku.id}`} label="Unit" error={errors.unit_id?.message} {...register("unit_id")}>
          {skuUnits(sku).map(({ unit }) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
        </SelectField>
        <SelectField id={`price-tier-${sku.id}`} label="Price tier" error={errors.tier?.message} {...register("tier")}>
          {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </SelectField>
      </div>
      <FormField id={`price-amount-${sku.id}`} label="Price (₱)" inputMode="decimal" autoFocus error={errors.price?.message} {...register("price")} />
      <FormField id={`price-from-${sku.id}`} label="Starts" type="datetime-local" hint="Leave empty to change the price now."
        error={errors.effective_from?.message} {...register("effective_from")} />
    </DialogForm>
  );
}

function PriceHistoryDialog({ sku }: { sku: Sku }) {
  const [open, setOpen] = useState(false);
  const history = useApiQuery(["price-history", sku.id, open], () => (open ? fetchPriceHistory(sku.id) : Promise.resolve([])));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="ghost"><History aria-hidden /> History</Button>} />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Price history · {sku.name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table className="numeric">
            <TableHeader>
              <TableRow>
                <TableHead>Tier · unit</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.data?.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="capitalize">{p.tier} · {p.unit.code}</TableCell>
                  <TableCell className="text-right font-medium">{formatMoney(p.price)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(p.effective_from)} {formatTime(p.effective_from)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {p.effective_to ? `${formatDate(p.effective_to)} ${formatTime(p.effective_to)}` : "Current"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {history.loading && <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const barcodeSchema = z.object({
  barcode: z.string().trim().min(1, "Scan or type the barcode.").max(64),
  type: z.enum(["ean13", "ean8", "upca", "code128", "internal"]),
  unit_id: z.string(),
});

function BarcodeDialog({ sku, onSaved }: { sku: Sku; onSaved: () => Promise<void> }) {
  const form = useForm<z.infer<typeof barcodeSchema>>({ resolver: zodResolver(barcodeSchema), defaultValues: { barcode: "", type: "ean13", unit_id: "" } });
  const { register, formState: { errors } } = form;

  return (
    <DialogForm
      trigger={<Button size="sm" variant="outline"><Plus aria-hidden /> Add barcode</Button>}
      title={`Add barcode · ${sku.name}`}
      submitLabel="Add barcode"
      form={form}
      fields={["barcode", "type", "unit_id"]}
      onSubmit={async (values) => {
        await addBarcode(sku.id, { ...values, unit_id: values.unit_id || null });
        await onSaved();
      }}
    >
      <FormField id={`barcode-${sku.id}`} label="Barcode" autoComplete="off" autoFocus error={errors.barcode?.message} {...register("barcode")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id={`barcode-type-${sku.id}`} label="Type" error={errors.type?.message} {...register("type")}>
          {BARCODE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </SelectField>
        <SelectField id={`barcode-unit-${sku.id}`} label="Scans as" hint="e.g. the barcode on a box of 24." error={errors.unit_id?.message} {...register("unit_id")}>
          <option value="">{sku.base_unit.name} (stock unit)</option>
          {skuUnits(sku).slice(1).map(({ unit }) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
        </SelectField>
      </div>
    </DialogForm>
  );
}

const conversionSchema = z.object({ unit_id: z.string().min(1, "Choose a unit."), factor: factorField() });

function ConversionDialog({ sku, units, onSaved }: { sku: Sku; units: Unit[]; onSaved: () => Promise<void> }) {
  const form = useForm<z.infer<typeof conversionSchema>>({ resolver: zodResolver(conversionSchema), defaultValues: { unit_id: "", factor: "" } });
  const { register, formState: { errors } } = form;
  const used = new Set(skuUnits(sku).map(({ unit }) => unit.id));

  return (
    <DialogForm
      trigger={<Button size="sm" variant="outline"><Plus aria-hidden /> Add unit</Button>}
      title={`Add unit · ${sku.name}`}
      description={`How many ${sku.base_unit.name.toLowerCase()} (${sku.base_unit.code}) are in one of the new unit?`}
      submitLabel="Add unit"
      form={form}
      fields={["unit_id", "factor"]}
      onSubmit={async (values) => {
        await addConversion(sku.id, values);
        await onSaved();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id={`conversion-unit-${sku.id}`} label="Unit" error={errors.unit_id?.message} {...register("unit_id")}>
          <option value="">Choose…</option>
          {units.filter((u) => u.is_active && !used.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
        </SelectField>
        <FormField id={`conversion-factor-${sku.id}`} label={`${sku.base_unit.code} per unit`} inputMode="decimal" placeholder="e.g. 24"
          error={errors.factor?.message} {...register("factor")} />
      </div>
    </DialogForm>
  );
}

const editSkuSchema = z.object({
  variant: z.string().trim().max(100),
  code: z.string().trim().min(1, "Enter a SKU code.").max(50),
  base_unit_id: z.string().min(1),
  cost_price: moneyField("Cost"),
  reorder_level: moneyField("Reorder level"),
  reorder_quantity: moneyField("Reorder quantity"),
});

function EditSkuDialog({ sku, units, onSaved }: { sku: Sku; units: Unit[]; onSaved: () => Promise<void> }) {
  const form = useForm<z.infer<typeof editSkuSchema>>({
    resolver: zodResolver(editSkuSchema),
    defaultValues: {
      variant: sku.variant ?? "",
      code: sku.code,
      base_unit_id: sku.base_unit.id,
      cost_price: trimDecimal(sku.cost_price),
      reorder_level: trimDecimal(sku.reorder_level),
      reorder_quantity: trimDecimal(sku.reorder_quantity),
    },
  });
  const { register, formState: { errors } } = form;

  return (
    <DialogForm
      trigger={<Button size="sm" variant="ghost"><Pencil aria-hidden /> Edit</Button>}
      title={`Edit SKU · ${sku.code}`}
      description="The stock unit cannot change once the SKU has stock history."
      submitLabel="Save SKU"
      form={form}
      fields={["variant", "code", "base_unit_id", "cost_price", "reorder_level", "reorder_quantity"]}
      wide
      onSubmit={async (values) => {
        await updateSku(sku.id, {
          variant: values.variant || null,
          code: values.code,
          base_unit_id: values.base_unit_id,
          cost_price: values.cost_price,
          reorder_level: values.reorder_level,
          reorder_quantity: values.reorder_quantity,
        });
        await onSaved();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={`edit-variant-${sku.id}`} label="Variant" error={errors.variant?.message} {...register("variant")} />
        <FormField id={`edit-code-${sku.id}`} label="SKU code" error={errors.code?.message} {...register("code")} />
        <SelectField id={`edit-unit-${sku.id}`} label="Stock unit" error={errors.base_unit_id?.message} {...register("base_unit_id")}>
          {units.filter((u) => u.is_active || u.id === sku.base_unit.id).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
        </SelectField>
        <FormField id={`edit-cost-${sku.id}`} label="Cost (₱)" inputMode="decimal" error={errors.cost_price?.message} {...register("cost_price")} />
        <FormField id={`edit-reorder-${sku.id}`} label="Reorder level" inputMode="decimal" error={errors.reorder_level?.message} {...register("reorder_level")} />
        <FormField id={`edit-reorder-qty-${sku.id}`} label="Reorder quantity" inputMode="decimal" error={errors.reorder_quantity?.message} {...register("reorder_quantity")} />
      </div>
    </DialogForm>
  );
}

// --- Card ------------------------------------------------------------------------

/** One SKU: status, prices, barcodes and units, each editable by permission. */
export function SkuCard({ sku, units, tracked, onChanged }: { sku: Sku; units: Unit[]; tracked: boolean; onChanged: () => Promise<void> }) {
  const canManage = useCan("products.manage");
  const canPrice = useCan("products.manage_prices");
  const canSeeStock = useCan("inventory.view");
  const [toggleError, setToggleError] = useState<string | null>(null);
  const onHand = Number(sku.stock.quantity_on_hand);

  return (
    <Card className="gap-4" data-testid={`sku-${sku.code}`}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-[0.95rem] font-semibold">
          {sku.name}
          {!sku.is_active && <StatusBadge tone="neutral">Inactive</StatusBadge>}
        </CardTitle>
        <CardDescription className="numeric">
          {sku.code} · {sku.base_unit.name} · cost {formatMoney(sku.cost_price)}
          {tracked && <> · <span className={onHand <= 0 ? "text-danger" : undefined}>{formatQuantity(sku.stock.quantity_on_hand, sku.base_unit.code)} on hand</span></>}
        </CardDescription>
        <CardAction className="flex items-center gap-1">
          {canManage && <EditSkuDialog sku={sku} units={units} onSaved={onChanged} />}
          {canManage && (
            <label className="flex items-center gap-2 pl-2 text-sm">
              <span className="sr-only sm:not-sr-only">Active</span>
              <Switch
                checked={sku.is_active}
                aria-label={`${sku.code} active`}
                onCheckedChange={async (checked) => {
                  setToggleError(null);
                  try {
                    await setSkuActive(sku.id, checked);
                    await onChanged();
                  } catch (error) {
                    setToggleError(error instanceof Error ? error.message : "Could not change the status.");
                  }
                }}
              />
            </label>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-5">
        {toggleError && <p role="alert" className="text-sm text-danger">{toggleError}</p>}

        <Section title="Prices" action={<div className="flex gap-1"><PriceHistoryDialog sku={sku} />{canPrice && <PriceDialog sku={sku} onSaved={onChanged} />}</div>}>
          {sku.prices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No current price. The SKU cannot be sold until it has one.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {sku.prices.map((p) => (
                <li key={p.id} className="numeric flex items-center justify-between gap-3 px-3 py-2">
                  <span className="capitalize">{p.tier} · per {p.unit.name.toLowerCase()}</span>
                  <span className="text-right">
                    <span className="font-semibold">{formatMoney(p.price)}</span>
                    <span className="block text-xs text-muted-foreground">since {formatDate(p.effective_from)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="grid gap-5 md:grid-cols-2">
          <Section title="Barcodes" action={canManage && <BarcodeDialog sku={sku} onSaved={onChanged} />}>
            {sku.barcodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No barcode. Cashiers can still search by name or SKU code.</p>
            ) : (
              <ul className="divide-y rounded-lg border text-sm">
                {sku.barcodes.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="min-w-0">
                      <span className="numeric block truncate font-medium">{b.barcode}</span>
                      <span className="block text-xs text-muted-foreground">
                        {BARCODE_TYPES.find((t) => t.value === b.type)?.label} · {b.unit?.name ?? sku.base_unit.name}
                        {b.is_primary && " · primary"}
                      </span>
                    </span>
                    {canManage && (
                      <ConfirmDialog
                        trigger={<Button size="icon-sm" variant="ghost" aria-label={`Remove barcode ${b.barcode}`}><Trash2 aria-hidden /></Button>}
                        title="Remove barcode?"
                        description={`${b.barcode} will no longer scan as ${sku.name}.`}
                        confirmLabel="Remove"
                        destructive
                        onConfirm={async () => { await removeBarcode(b.id); await onChanged(); }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Units" action={canManage && <ConversionDialog sku={sku} units={units} onSaved={onChanged} />}>
            <ul className="divide-y rounded-lg border text-sm">
              {sku.conversions.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span>
                    <span className="block font-medium">{c.unit.name}</span>
                    <span className="numeric block text-xs text-muted-foreground">
                      {c.is_base ? "Stock unit" : describeConversion(c.unit, c.factor, sku.base_unit)}
                    </span>
                  </span>
                  {canManage && !c.is_base && (
                    <ConfirmDialog
                      trigger={<Button size="icon-sm" variant="ghost" aria-label={`Remove unit ${c.unit.name}`}><Trash2 aria-hidden /></Button>}
                      title="Remove unit?"
                      description={`${sku.name} will no longer be counted or sold per ${c.unit.name.toLowerCase()}. Units used by prices or barcodes cannot be removed.`}
                      confirmLabel="Remove"
                      destructive
                      onConfirm={async () => { await removeConversion(c.id); await onChanged(); }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </Section>
        </div>

        {tracked && canSeeStock && (
          <div className="flex flex-wrap gap-2">
            <LinkButton size="sm" variant="outline" href={`/inventory/movements?sku_id=${sku.id}`}>Stock history</LinkButton>
            <LinkButton size="sm" variant="outline" href={`/inventory/batches?sku_id=${sku.id}`}>Batches</LinkButton>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
