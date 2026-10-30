"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { LinkButton } from "@/components/link-button";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { applyApiError } from "@/lib/form-errors";
import { RequirePermission } from "@/modules/auth/components/auth-guard";

import { createProduct } from "../api";
import { useCatalogRefs } from "../hooks";
import { PRODUCT_FIELDS, ProductDetailsFields, productInput, productSchema } from "./product-details-fields";
import { EMPTY_SKU, SKU_FIELDS, SkuFields, skuInput, skuSchema } from "./sku-fields";

const schema = productSchema.extend({ skus: z.tuple([skuSchema]) });
type Values = z.infer<typeof schema>;

const FIELDS = [...PRODUCT_FIELDS, ...SKU_FIELDS.map((f) => `skus.0.${f}` as const)];

function NewProductForm() {
  const router = useRouter();
  const refs = useCatalogRefs();
  const [message, setMessage] = useState<string | null>(null);
  const { register, control, handleSubmit, setError, setValue, getValues, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "", description: "", category_id: "", brand_id: "", tax_rate_id: "",
      track_inventory: true, track_batches: false, track_expiry: false,
      skus: [EMPTY_SKU],
    },
  });

  // Default tax rate and the "piece" unit once the reference data arrives.
  useEffect(() => {
    if (!refs.data) return;
    if (!getValues("tax_rate_id")) setValue("tax_rate_id", refs.data.taxRates.find((t) => t.is_default)?.id ?? "");
    if (!getValues("skus.0.base_unit_id")) setValue("skus.0.base_unit_id", refs.data.units.find((u) => u.code === "pc")?.id ?? "");
  }, [refs.data, getValues, setValue]);

  const submit = handleSubmit(async (values) => {
    setMessage(null);
    try {
      const product = await createProduct({ ...productInput(values), skus: [skuInput(values.skus[0])] });
      router.push(`/products/edit?id=${product.id}`);
    } catch (error) {
      setMessage(applyApiError(error, setError, FIELDS));
    }
  });

  if (refs.error) return <Alert variant="destructive"><AlertDescription>{refs.error.message}</AlertDescription></Alert>;
  if (!refs.data) return <Skeleton className="h-96 w-full" />;

  return (
    <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-2 lg:items-start">
      {message && (
        <Alert variant="destructive" className="lg:col-span-2">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      <Panel title="Product" description="What it is and how it is taxed and tracked.">
        <ProductDetailsFields register={register} control={control} errors={formState.errors}
          categories={refs.data.categories} brands={refs.data.brands} taxRates={refs.data.taxRates} />
      </Panel>
      <Panel title="First SKU" description="The sellable item: unit, price and barcode. Add more variants and pack sizes after saving.">
        <SkuFields prefix="skus.0." register={register} errors={formState.errors.skus?.[0]} units={refs.data.units} />
      </Panel>
      <div className="flex justify-end gap-2 lg:col-span-2">
        <LinkButton variant="outline" href="/products">Cancel</LinkButton>
        <Button type="submit" disabled={formState.isSubmitting}>{formState.isSubmitting ? "Saving…" : "Create product"}</Button>
      </div>
    </form>
  );
}

export function NewProductPage() {
  return (
    <div className="grid gap-6">
      <PageHeader title="New product" description="Add a product with its first SKU. Stock starts at zero; receive it from Inventory › Stock in." />
      <RequirePermission permission="products.manage" fallback={<p className="text-sm text-muted-foreground">You do not have permission to add products.</p>}>
        <NewProductForm />
      </RequirePermission>
    </div>
  );
}
