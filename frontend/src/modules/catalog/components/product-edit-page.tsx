"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DialogForm } from "@/components/dialog-form";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { applyApiError } from "@/lib/form-errors";
import { useApiQuery } from "@/lib/use-api-query";
import { notify } from "@/lib/notify";
import { useCan } from "@/modules/auth/hooks";

import { addSku, fetchProduct, setProductActive, updateProduct } from "../api";
import { useCatalogRefs } from "../hooks";
import type { Product } from "../types";
import { PRODUCT_FIELDS, ProductDetailsFields, productInput, productSchema, type ProductValues } from "./product-details-fields";
import { ProductImages } from "./product-images";
import { ProductThumb } from "./product-thumb";
import { EMPTY_SKU, SKU_FIELDS, SkuFields, skuInput, skuSchema, type SkuValues } from "./sku-fields";
import { SkuCard } from "./sku-card";

type Refs = NonNullable<ReturnType<typeof useCatalogRefs>["data"]>;

function DetailsForm({ product, refs, onSaved }: { product: Product; refs: Refs; onSaved: () => Promise<void> }) {
  const canManage = useCan("products.manage");
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const { register, control, handleSubmit, setError, formState } = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: product.name,
      description: product.description ?? "",
      category_id: product.category?.id ?? "",
      brand_id: product.brand?.id ?? "",
      tax_rate_id: product.tax_rate.id,
      track_inventory: product.track_inventory,
      track_batches: product.track_batches,
      track_expiry: product.track_expiry,
    },
  });

  const submit = handleSubmit(async (values) => {
    setMessage(null);
    try {
      await updateProduct(product.id, productInput(values));
      setMessage(null);
      notify.success("Product saved", product.name);
      await onSaved();
    } catch (error) {
      const text = applyApiError(error, setError, PRODUCT_FIELDS);
      if (text) setMessage({ tone: "error", text });
    }
  });

  return (
    <Panel title="Details">
      <form onSubmit={submit} noValidate className="grid gap-4">
        {message && (
          <Alert variant={message.tone === "error" ? "destructive" : "default"}>
            <AlertDescription role="status">{message.text}</AlertDescription>
          </Alert>
        )}
        <fieldset disabled={!canManage} className="grid gap-4">
          <ProductDetailsFields register={register} control={control} errors={formState.errors}
            categories={refs.categories} brands={refs.brands} taxRates={refs.taxRates} />
        </fieldset>
        {canManage && (
          <div className="flex justify-end">
            <Button type="submit" disabled={formState.isSubmitting}>{formState.isSubmitting ? "Saving…" : "Save details"}</Button>
          </div>
        )}
      </form>
    </Panel>
  );
}

function AddSkuDialog({ product, refs, onSaved }: { product: Product; refs: Refs; onSaved: () => Promise<void> }) {
  const form = useForm<SkuValues>({
    resolver: zodResolver(skuSchema),
    defaultValues: { ...EMPTY_SKU, base_unit_id: product.skus[0]?.base_unit.id ?? "" },
  });

  return (
    <DialogForm
      trigger={<Button size="sm"><Plus aria-hidden /> Add SKU</Button>}
      title={`Add SKU · ${product.name}`}
      description="A new variant or size, with its own stock, barcode and price."
      submitLabel="Add SKU"
      form={form}
      fields={SKU_FIELDS}
      wide
      onSubmit={async (values) => {
        await addSku(product.id, skuInput(values));
        notify.success("Variant added", product.name);
        await onSaved();
      }}
    >
      <SkuFields register={form.register} errors={form.formState.errors} units={refs.units} idPrefix="new-sku" />
    </DialogForm>
  );
}

function ProductEditor({ id }: { id: string }) {
  const canManage = useCan("products.manage");
  const refs = useCatalogRefs();
  const product = useApiQuery(["product", id], () => fetchProduct(id));
  const [tab, setTab] = useState("skus");

  if (product.error || refs.error) {
    return <Alert variant="destructive"><AlertDescription>{(product.error ?? refs.error)?.message}</AlertDescription></Alert>;
  }
  if (!product.data || !refs.data) return <Skeleton className="h-96 w-full" />;

  const p = product.data;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {p.is_active ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="neutral">Inactive</StatusBadge>}
            {[p.category?.name, p.brand?.name, p.tax_rate.name].filter(Boolean).join(" · ")}
          </span>
        }
        actions={
          <>
            <ProductThumb url={p.image_url} name={p.name} className="size-12" />
            {canManage && (
              <ConfirmDialog
                trigger={<Button variant="outline">{p.is_active ? "Deactivate" : "Activate"}</Button>}
                title={p.is_active ? "Deactivate product?" : "Activate product?"}
                description={p.is_active
                  ? "It disappears from the point of sale and new stock documents. Its history and stock are kept."
                  : "It can be sold and stocked again."}
                confirmLabel={p.is_active ? "Deactivate" : "Activate"}
                destructive={p.is_active}
                onConfirm={async () => { await setProductActive(p.id, !p.is_active); notify.success(p.is_active ? "Product deactivated" : "Product activated", p.name); await product.reload(); }}
              />
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList>
          <TabsTrigger value="skus">SKUs & prices</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
        </TabsList>
        <TabsContent value="skus" className="grid gap-4 pt-2">
          {canManage && (
            <div className="flex justify-end">
              <AddSkuDialog product={p} refs={refs.data} onSaved={product.reload} />
            </div>
          )}
          {p.skus.map((sku) => (
            <SkuCard key={sku.id} sku={sku} units={refs.data!.units} tracked={p.track_inventory} onChanged={product.reload} />
          ))}
        </TabsContent>
        <TabsContent value="details" className="pt-2">
          <DetailsForm key={p.updated_at} product={p} refs={refs.data} onSaved={product.reload} />
        </TabsContent>
        <TabsContent value="images" className="pt-2">
          <ProductImages product={p} onChanged={product.reload} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** /products/edit?id=… (a query string, not a route segment, so the desktop static export works). */
export function ProductEditPage() {
  const id = useSearchParams().get("id");
  if (!id) return <Alert variant="destructive"><AlertDescription>No product selected.</AlertDescription></Alert>;
  return <ProductEditor key={id} id={id} />;
}
