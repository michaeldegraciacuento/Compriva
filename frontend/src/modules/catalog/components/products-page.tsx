"use client";

import { PackageSearch, Plus, Tags } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { SearchInput } from "@/components/search-input";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatQuantity } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { useCan } from "@/modules/auth/hooks";

import { fetchProducts, type ProductFilters } from "../api";
import { useCatalogRefs } from "../hooks";
import { currentPrice } from "../sku";
import type { Product } from "../types";
import { ProductThumb } from "./product-thumb";

function priceRange(product: Product): string {
  const prices = product.skus.map((sku) => currentPrice(sku)?.price).filter((p): p is string => !!p);
  if (prices.length === 0) return "—";
  const sorted = [...prices].sort((a, b) => Number(a) - Number(b));
  return sorted[0] === sorted[sorted.length - 1] ? formatMoney(sorted[0]) : `${formatMoney(sorted[0])} – ${formatMoney(sorted[sorted.length - 1])}`;
}

function stockText(product: Product): string {
  if (!product.track_inventory) return "Not tracked";
  if (product.skus.length === 1) return formatQuantity(product.skus[0].stock.quantity_on_hand, product.skus[0].base_unit.code);
  return `${product.skus.length} SKUs`;
}

export function ProductsPage() {
  const canManage = useCan("products.manage");
  const [filters, setFilters] = useState<ProductFilters>({ page: 1 });
  const refs = useCatalogRefs();
  const products = useApiQuery(["products", filters], () => fetchProducts(filters));
  const update = (patch: Partial<ProductFilters>) => setFilters((current) => ({ ...current, page: 1, ...patch }));

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Products"
        description="Everything the store sells: SKUs, barcodes, units and prices."
        actions={canManage && (
          <>
            <LinkButton variant="outline" href="/products/catalog">
              <Tags aria-hidden /> Categories & units
            </LinkButton>
            <LinkButton href="/products/new">
              <Plus aria-hidden /> New product
            </LinkButton>
          </>
        )}
      />

      <Panel
        title="Product list"
        flush
        action={products.data && <span className="text-sm text-muted-foreground">{products.data.meta?.total ?? 0} products</span>}
      >
        <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row">
          <SearchInput label="Search products" placeholder="Name, SKU or scan a barcode" value={filters.q ?? ""} onChange={(q) => update({ q: q || undefined })} />
          <NativeSelect aria-label="Category" value={filters.category_id ?? ""} onChange={(e) => update({ category_id: e.target.value || undefined })} className="sm:w-48">
            <option value="">All categories</option>
            {refs.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
          <NativeSelect
            aria-label="Status"
            value={filters.status ?? ""}
            onChange={(e) => update({ status: (e.target.value || undefined) as ProductFilters["status"] })}
            className="sm:w-36"
          >
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </NativeSelect>
        </div>

        {products.error ? (
          <Alert variant="destructive" className="mx-5 w-auto">
            <AlertDescription>{products.error.message}</AlertDescription>
          </Alert>
        ) : products.loading ? (
          <div className="grid gap-3 px-5" aria-busy="true">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : products.data?.data.length === 0 ? (
          <EmptyState icon={PackageSearch} title="No products found">
            {filters.q || filters.category_id || filters.status ? "Try a different search or filter." : "Add the first product to start selling."}
          </EmptyState>
        ) : (
          <Table className="numeric" aria-busy={products.fetching}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Product</TableHead>
                <TableHead className="hidden md:table-cell">Category</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Stock</TableHead>
                <TableHead className="hidden pr-5 text-right sm:table-cell">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.data?.data.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="max-w-0 pl-5 sm:max-w-none">
                    <Link href={`/products/edit?id=${product.id}`} className="flex min-w-0 items-center gap-3 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      <ProductThumb url={product.image_url} name={product.name} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium hover:underline">{product.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {product.skus.map((s) => s.code).join(", ")}
                          {product.brand && ` · ${product.brand.name}`}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{product.category?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="pr-5 text-right whitespace-nowrap sm:pr-2">
                    {priceRange(product)}
                    {!product.is_active && <span className="block text-xs text-muted-foreground sm:hidden">Inactive</span>}
                  </TableCell>
                  <TableCell className="hidden text-right whitespace-nowrap sm:table-cell">{stockText(product)}</TableCell>
                  <TableCell className="hidden pr-5 text-right sm:table-cell">
                    {product.is_active ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="neutral">Inactive</StatusBadge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination meta={products.data?.meta} onPage={(page) => setFilters((current) => ({ ...current, page }))} />
      </Panel>
    </div>
  );
}
