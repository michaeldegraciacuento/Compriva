"use client";

import { Controller, useWatch, type Control, type FieldErrors, type Path, type UseFormRegister } from "react-hook-form";
import { z } from "zod";

import { FormField } from "@/components/form-field";
import { SelectField } from "@/components/select-field";
import { SwitchField } from "@/components/switch-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { Brand, Category, TaxRate } from "../types";

export const productSchema = z.object({
  name: z.string().trim().min(1, "Enter the product name.").max(255),
  description: z.string().trim().max(2000),
  category_id: z.string(),
  brand_id: z.string(),
  tax_rate_id: z.string().min(1, "Choose a tax rate."),
  track_inventory: z.boolean(),
  track_batches: z.boolean(),
  track_expiry: z.boolean(),
});

export type ProductValues = z.infer<typeof productSchema>;

export const PRODUCT_FIELDS = ["name", "description", "category_id", "brand_id", "tax_rate_id", "track_inventory", "track_batches", "track_expiry"] as const;

/** Request body for the product fields ("" → null). */
export function productInput(values: ProductValues) {
  return {
    name: values.name,
    description: values.description || null,
    category_id: values.category_id || null,
    brand_id: values.brand_id || null,
    tax_rate_id: values.tax_rate_id,
    track_inventory: values.track_inventory,
    track_batches: values.track_inventory && values.track_batches,
    track_expiry: values.track_inventory && values.track_expiry,
  };
}

/** Category label with its parent: "Beverages › Soft drinks". */
export function categoryOptions(categories: Category[]) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return categories
    .map((c) => ({ id: c.id, label: c.parent_id && byId.get(c.parent_id) ? `${byId.get(c.parent_id)!.name} › ${c.name}` : c.name, active: c.is_active }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Product-level fields shared by the new and edit forms. */
export function ProductDetailsFields<T extends ProductValues>({ register, control, errors, categories, brands, taxRates }: {
  register: UseFormRegister<T>;
  control: Control<T>;
  errors: FieldErrors<ProductValues>;
  categories: Category[];
  brands: Brand[];
  taxRates: TaxRate[];
}) {
  const watchTrack = useWatch({ control, name: "track_inventory" as Path<T> }) as boolean;

  return (
    <div className="grid gap-4">
      <FormField id="name" label="Product name" placeholder="e.g. Coca-Cola Regular" error={errors.name?.message} {...register("name" as Path<T>)} />
      <div className="grid gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" rows={2} aria-invalid={errors.description ? true : undefined} {...register("description" as Path<T>)} />
        {errors.description && <p role="alert" className="text-sm text-destructive">{errors.description.message}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField id="category_id" label="Category" error={errors.category_id?.message} {...register("category_id" as Path<T>)}>
          <option value="">No category</option>
          {categoryOptions(categories).map((c) => (
            <option key={c.id} value={c.id}>{c.label}{c.active ? "" : " (inactive)"}</option>
          ))}
        </SelectField>
        <SelectField id="brand_id" label="Brand" error={errors.brand_id?.message} {...register("brand_id" as Path<T>)}>
          <option value="">No brand</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </SelectField>
        <SelectField id="tax_rate_id" label="Tax" error={errors.tax_rate_id?.message} {...register("tax_rate_id" as Path<T>)}>
          <option value="">Choose…</option>
          {taxRates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectField>
      </div>
      <div className="grid gap-4 rounded-lg border p-4">
        <Controller control={control} name={"track_inventory" as Path<T>} render={({ field }) => (
          <SwitchField id="track_inventory" label="Track stock" description="Count stock for this product. Turn off for services and made-to-order items."
            checked={field.value as boolean} onCheckedChange={field.onChange} />
        )} />
        <Controller control={control} name={"track_batches" as Path<T>} render={({ field }) => (
          <SwitchField id="track_batches" label="Track batches" description="Record a batch or lot number when stock is received."
            checked={watchTrack && (field.value as boolean)} onCheckedChange={field.onChange} disabled={!watchTrack} />
        )} />
        <Controller control={control} name={"track_expiry" as Path<T>} render={({ field }) => (
          <SwitchField id="track_expiry" label="Track expiry dates" description="Require an expiry date on stock-in and sell the earliest-expiring stock first (FEFO)."
            checked={watchTrack && (field.value as boolean)} onCheckedChange={field.onChange} disabled={!watchTrack} />
        )} />
      </div>
    </div>
  );
}
