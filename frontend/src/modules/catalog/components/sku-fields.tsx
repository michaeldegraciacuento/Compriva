"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { z } from "zod";

import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { moneyField } from "@/lib/schemas";

import type { NewSkuInput, Unit } from "../types";

const optionalMoney = (label: string) => z.union([z.literal(""), moneyField(label)]);

export const skuSchema = z.object({
  variant: z.string().trim().max(100),
  code: z.string().trim().max(50),
  base_unit_id: z.string().min(1, "Choose the unit stock is counted in."),
  price: moneyField("Price"),
  cost_price: optionalMoney("Cost"),
  reorder_level: optionalMoney("Reorder level"),
  reorder_quantity: optionalMoney("Reorder quantity"),
  barcode: z.string().trim().max(64),
  barcode_type: z.enum(["ean13", "ean8", "upca", "code128", "internal"]),
});

export type SkuValues = z.infer<typeof skuSchema>;

export const EMPTY_SKU: SkuValues = {
  variant: "", code: "", base_unit_id: "", price: "", cost_price: "", reorder_level: "", reorder_quantity: "", barcode: "", barcode_type: "ean13",
};

export const SKU_FIELDS = ["variant", "code", "base_unit_id", "price", "cost_price", "reorder_level", "reorder_quantity", "barcode", "barcode_type"] as const;

export function skuInput(values: SkuValues): NewSkuInput {
  return {
    variant: values.variant || null,
    code: values.code || null,
    base_unit_id: values.base_unit_id,
    price: values.price,
    ...(values.cost_price ? { cost_price: values.cost_price } : {}),
    ...(values.reorder_level ? { reorder_level: values.reorder_level } : {}),
    ...(values.reorder_quantity ? { reorder_quantity: values.reorder_quantity } : {}),
    barcode: values.barcode || null,
    barcode_type: values.barcode_type,
  };
}

export const BARCODE_TYPES = [
  { value: "ean13", label: "EAN-13" },
  { value: "ean8", label: "EAN-8" },
  { value: "upca", label: "UPC-A" },
  { value: "code128", label: "Code 128" },
  { value: "internal", label: "Store code" },
] as const;

/**
 * Fields of one SKU. `prefix` is the field path ("skus.0." in the new-product
 * form) so server errors such as "skus.0.price" land on the right input.
 */
export function SkuFields({ prefix = "", register, errors, units, idPrefix = "sku" }: {
  prefix?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- used by forms with different value shapes
  register: UseFormRegister<any>;
  errors: FieldErrors<SkuValues> | undefined;
  units: Unit[];
  idPrefix?: string;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const reg = (name: keyof SkuValues) => register(`${prefix}${name}`);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={id("variant")} label="Variant" placeholder="e.g. 1.5 L, 500 g, Spicy" hint="Leave empty for a single-variant product."
          error={errors?.variant?.message} {...reg("variant")} />
        <FormField id={id("code")} label="SKU code" placeholder="Automatic" hint="Leave empty to number it automatically."
          error={errors?.code?.message} {...reg("code")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField id={id("base_unit_id")} label="Stock unit" hint="Stock is counted in this unit." error={errors?.base_unit_id?.message} {...reg("base_unit_id")}>
          <option value="">Choose…</option>
          {units.filter((u) => u.is_active).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
        </SelectField>
        <FormField id={id("price")} label="Selling price (₱)" inputMode="decimal" placeholder="0.00" error={errors?.price?.message} {...reg("price")} />
        <FormField id={id("cost_price")} label="Cost (₱)" inputMode="decimal" placeholder="0.00" error={errors?.cost_price?.message} {...reg("cost_price")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <FormField id={id("barcode")} label="Barcode" placeholder="Scan or type" autoComplete="off" error={errors?.barcode?.message} {...reg("barcode")} />
        <SelectField id={id("barcode_type")} label="Barcode type" error={errors?.barcode_type?.message} {...reg("barcode_type")}>
          {BARCODE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </SelectField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={id("reorder_level")} label="Reorder level" inputMode="decimal" placeholder="0" hint="Low-stock alert at or below this quantity."
          error={errors?.reorder_level?.message} {...reg("reorder_level")} />
        <FormField id={id("reorder_quantity")} label="Reorder quantity" inputMode="decimal" placeholder="0" hint="Suggested quantity to order."
          error={errors?.reorder_quantity?.message} {...reg("reorder_quantity")} />
      </div>
    </div>
  );
}
