"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ReactElement } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DialogForm } from "@/components/dialog-form";
import { FormField } from "@/components/form-field";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { SelectField } from "@/components/select-field";
import { StatusBadge } from "@/components/status-badge";
import { SwitchField } from "@/components/switch-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCan } from "@/modules/auth/hooks";
import { notify } from "@/lib/notify";

import { deleteBrand, deleteCategory, saveBrand, saveCategory, saveUnit } from "../api";
import { useCatalogRefs } from "../hooks";
import type { Brand, Category, Unit } from "../types";
import { categoryOptions } from "./product-details-fields";

const activeBadge = (active: boolean) => (active ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="neutral">Inactive</StatusBadge>);

// --- Categories ------------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100),
  parent_id: z.string(),
  description: z.string().trim().max(255),
  is_active: z.boolean(),
});

function CategoryDialog({ category, categories, trigger, onSaved }: { category: Category | null; categories: Category[]; trigger: ReactElement; onSaved: () => Promise<void> }) {
  const form = useForm<z.infer<typeof categorySchema>>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: category?.name ?? "", parent_id: category?.parent_id ?? "", description: category?.description ?? "", is_active: category?.is_active ?? true },
  });
  const { register, control, formState: { errors } } = form;

  return (
    <DialogForm trigger={trigger} title={category ? "Edit category" : "New category"} submitLabel="Save" form={form}
      fields={["name", "parent_id", "description", "is_active"]}
      onSubmit={async (values) => {
        await saveCategory(category?.id ?? null, { ...values, parent_id: values.parent_id || null, description: values.description || null });
        notify.success(category ? "Category saved" : "Category added", values.name);
        await onSaved();
      }}
    >
      <FormField id="category-name" label="Name" autoFocus error={errors.name?.message} {...register("name")} />
      <SelectField id="category-parent" label="Parent category" error={errors.parent_id?.message} {...register("parent_id")}>
        <option value="">None (top level)</option>
        {categoryOptions(categories.filter((c) => c.id !== category?.id)).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </SelectField>
      <FormField id="category-description" label="Description" error={errors.description?.message} {...register("description")} />
      <Controller control={control} name="is_active" render={({ field }) => (
        <SwitchField id="category-active" label="Active" description="Inactive categories are hidden from pickers." checked={field.value} onCheckedChange={field.onChange} />
      )} />
    </DialogForm>
  );
}

function CategoriesTab({ categories, reload }: { categories: Category[]; reload: () => Promise<void> }) {
  const canManage = useCan("products.manage");
  const labels = new Map(categoryOptions(categories).map((c) => [c.id, c.label]));
  const sorted = [...categories].sort((a, b) => (labels.get(a.id) ?? "").localeCompare(labels.get(b.id) ?? ""));

  return (
    <Panel title="Categories" flush
      action={canManage && <CategoryDialog category={null} categories={categories} onSaved={reload} trigger={<Button size="sm"><Plus aria-hidden /> New category</Button>} />}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Name</TableHead>
            <TableHead className="text-right">Products</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
            <TableHead className="pr-5 text-right"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="pl-5 font-medium">{labels.get(c.id)}</TableCell>
              <TableCell className="numeric text-right">{c.products_count}</TableCell>
              <TableCell className="hidden sm:table-cell">{activeBadge(c.is_active)}</TableCell>
              <TableCell className="pr-5 text-right whitespace-nowrap">
                {canManage && (
                  <>
                    <CategoryDialog category={c} categories={categories} onSaved={reload}
                      trigger={<Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.name}`}><Pencil aria-hidden /></Button>} />
                    <ConfirmDialog
                      trigger={<Button size="icon-sm" variant="ghost" aria-label={`Delete ${c.name}`}><Trash2 aria-hidden /></Button>}
                      title={`Delete ${c.name}?`}
                      description="Only categories without products or sub-categories can be deleted. Deactivate it instead to keep its history."
                      confirmLabel="Delete" destructive
                      onConfirm={async () => { await deleteCategory(c.id); notify.success("Category deleted", c.name); await reload(); }}
                    />
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

// --- Brands ----------------------------------------------------------------------

const brandSchema = z.object({ name: z.string().trim().min(1, "Enter a name.").max(100), is_active: z.boolean() });

function BrandDialog({ brand, trigger, onSaved }: { brand: Brand | null; trigger: ReactElement; onSaved: () => Promise<void> }) {
  const form = useForm<z.infer<typeof brandSchema>>({ resolver: zodResolver(brandSchema), defaultValues: { name: brand?.name ?? "", is_active: brand?.is_active ?? true } });

  return (
    <DialogForm trigger={trigger} title={brand ? "Edit brand" : "New brand"} submitLabel="Save" form={form} fields={["name", "is_active"]}
      onSubmit={async (values) => { await saveBrand(brand?.id ?? null, values); notify.success(brand ? "Brand saved" : "Brand added", values.name); await onSaved(); }}>
      <FormField id="brand-name" label="Name" autoFocus error={form.formState.errors.name?.message} {...form.register("name")} />
      <Controller control={form.control} name="is_active" render={({ field }) => (
        <SwitchField id="brand-active" label="Active" checked={field.value} onCheckedChange={field.onChange} />
      )} />
    </DialogForm>
  );
}

function BrandsTab({ brands, reload }: { brands: Brand[]; reload: () => Promise<void> }) {
  const canManage = useCan("products.manage");

  return (
    <Panel title="Brands" flush action={canManage && <BrandDialog brand={null} onSaved={reload} trigger={<Button size="sm"><Plus aria-hidden /> New brand</Button>} />}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Name</TableHead>
            <TableHead className="text-right">Products</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
            <TableHead className="pr-5 text-right"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {brands.map((b) => (
            <TableRow key={b.id}>
              <TableCell className="pl-5 font-medium">{b.name}</TableCell>
              <TableCell className="numeric text-right">{b.products_count}</TableCell>
              <TableCell className="hidden sm:table-cell">{activeBadge(b.is_active)}</TableCell>
              <TableCell className="pr-5 text-right whitespace-nowrap">
                {canManage && (
                  <>
                    <BrandDialog brand={b} onSaved={reload} trigger={<Button size="icon-sm" variant="ghost" aria-label={`Edit ${b.name}`}><Pencil aria-hidden /></Button>} />
                    <ConfirmDialog
                      trigger={<Button size="icon-sm" variant="ghost" aria-label={`Delete ${b.name}`}><Trash2 aria-hidden /></Button>}
                      title={`Delete ${b.name}?`}
                      description="Only brands without products can be deleted."
                      confirmLabel="Delete" destructive
                      onConfirm={async () => { await deleteBrand(b.id); notify.success("Brand deleted", b.name); await reload(); }}
                    />
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

// --- Units -----------------------------------------------------------------------

const UNIT_TYPES = [
  { value: "count", label: "Count (piece, pack, box…)" },
  { value: "weight", label: "Weight (kg, g)" },
  { value: "volume", label: "Volume (L, mL)" },
  { value: "length", label: "Length (m)" },
] as const;

const unitSchema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9_]*$/i, "Letters, digits and _ only, starting with a letter.").max(20),
  name: z.string().trim().min(1, "Enter a name.").max(50),
  type: z.enum(["count", "weight", "volume", "length"]),
  allows_decimal: z.boolean(),
  is_active: z.boolean(),
});

function UnitDialog({ unit, trigger, onSaved }: { unit: Unit | null; trigger: ReactElement; onSaved: () => Promise<void> }) {
  const form = useForm<z.infer<typeof unitSchema>>({
    resolver: zodResolver(unitSchema),
    defaultValues: { code: unit?.code ?? "", name: unit?.name ?? "", type: unit?.type ?? "count", allows_decimal: unit?.allows_decimal ?? false, is_active: unit?.is_active ?? true },
  });
  const { register, control, formState: { errors } } = form;

  return (
    <DialogForm trigger={trigger} title={unit ? "Edit unit" : "New unit"} submitLabel="Save" form={form} fields={["code", "name", "type", "allows_decimal", "is_active"]}
      onSubmit={async (values) => { await saveUnit(unit?.id ?? null, values); notify.success(unit ? "Unit saved" : "Unit added", values.name); await onSaved(); }}>
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <FormField id="unit-code" label="Code" autoFocus placeholder="pc" error={errors.code?.message} {...register("code")} />
        <FormField id="unit-name" label="Name" placeholder="Piece" error={errors.name?.message} {...register("name")} />
      </div>
      <SelectField id="unit-type" label="Measures" error={errors.type?.message} {...register("type")}>
        {UNIT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </SelectField>
      <Controller control={control} name="allows_decimal" render={({ field }) => (
        <SwitchField id="unit-decimal" label="Allow fractions" description="On for weighed or measured goods (1.25 kg); off for whole items." checked={field.value} onCheckedChange={field.onChange} />
      )} />
      <Controller control={control} name="is_active" render={({ field }) => (
        <SwitchField id="unit-active" label="Active" checked={field.value} onCheckedChange={field.onChange} />
      )} />
    </DialogForm>
  );
}

function UnitsTab({ units, reload }: { units: Unit[]; reload: () => Promise<void> }) {
  const canManage = useCan("products.manage");

  return (
    <Panel title="Units of measure" description="Stock is counted in a SKU's base unit; other units convert to it per SKU." flush
      action={canManage && <UnitDialog unit={null} onSaved={reload} trigger={<Button size="sm"><Plus aria-hidden /> New unit</Button>} />}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Unit</TableHead>
            <TableHead className="hidden sm:table-cell">Measures</TableHead>
            <TableHead>Fractions</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
            <TableHead className="pr-5 text-right"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {units.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="pl-5"><span className="font-medium">{u.name}</span> <span className="text-muted-foreground">({u.code})</span></TableCell>
              <TableCell className="hidden capitalize sm:table-cell">{u.type}</TableCell>
              <TableCell>{u.allows_decimal ? "Yes" : "Whole only"}</TableCell>
              <TableCell className="hidden sm:table-cell">{activeBadge(u.is_active)}</TableCell>
              <TableCell className="pr-5 text-right">
                {canManage && <UnitDialog unit={u} onSaved={reload} trigger={<Button size="icon-sm" variant="ghost" aria-label={`Edit ${u.name}`}><Pencil aria-hidden /></Button>} />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

export function CatalogSetupPage() {
  const refs = useCatalogRefs();
  const [tab, setTab] = useState("categories");

  return (
    <div className="grid gap-6">
      <PageHeader title="Categories, brands & units" description="Reference lists used when adding products." />
      {refs.error ? (
        <Alert variant="destructive"><AlertDescription>{refs.error.message}</AlertDescription></Alert>
      ) : !refs.data ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="brands">Brands</TabsTrigger>
            <TabsTrigger value="units">Units</TabsTrigger>
          </TabsList>
          <TabsContent value="categories" className="pt-2"><CategoriesTab categories={refs.data.categories} reload={refs.reload} /></TabsContent>
          <TabsContent value="brands" className="pt-2"><BrandsTab brands={refs.data.brands} reload={refs.reload} /></TabsContent>
          <TabsContent value="units" className="pt-2"><UnitsTab units={refs.data.units} reload={refs.reload} /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
