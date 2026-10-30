import { getApiClient } from "@/lib/api";
import type { Paginated, PaginationMeta } from "@/types/api";

import type {
  Brand,
  Category,
  NewProductInput,
  NewSkuInput,
  Price,
  Product,
  Sku,
  TaxRate,
  Unit,
} from "./types";

/** CSRF cookie first on the web (cookie sessions); a no-op on the desktop app. */
async function writer() {
  const api = await getApiClient();
  await api.ensureCsrfCookie();
  return api;
}

// --- Taxonomy ------------------------------------------------------------------

export const fetchCategories = async () => (await getApiClient()).get<Category[]>("/categories");
export const fetchBrands = async () => (await getApiClient()).get<Brand[]>("/brands");
export const fetchUnits = async () => (await getApiClient()).get<Unit[]>("/units");
export const fetchTaxRates = async () => (await getApiClient()).get<TaxRate[]>("/tax-rates");

export const saveCategory = async (id: string | null, input: Partial<Category>) =>
  id ? (await writer()).patch<Category>(`/categories/${id}`, input) : (await writer()).post<Category>("/categories", input);
export const deleteCategory = async (id: string) => (await writer()).delete(`/categories/${id}`);

export const saveBrand = async (id: string | null, input: Partial<Brand>) =>
  id ? (await writer()).patch<Brand>(`/brands/${id}`, input) : (await writer()).post<Brand>("/brands", input);
export const deleteBrand = async (id: string) => (await writer()).delete(`/brands/${id}`);

export const saveUnit = async (id: string | null, input: Partial<Unit>) =>
  id ? (await writer()).patch<Unit>(`/units/${id}`, input) : (await writer()).post<Unit>("/units", input);

// --- Products ------------------------------------------------------------------

export interface ProductFilters {
  q?: string;
  category_id?: string;
  status?: "active" | "inactive";
  page?: number;
}

export async function fetchProducts(filters: ProductFilters): Promise<Paginated<Product>> {
  return (await getApiClient()).request<Product[], PaginationMeta>("GET", "/products", undefined, { params: filters });
}

export const fetchProduct = async (id: string) => (await getApiClient()).get<Product>(`/products/${id}`);
export const createProduct = async (input: NewProductInput) => (await writer()).post<Product>("/products", input);
export const updateProduct = async (id: string, input: Partial<NewProductInput>) => (await writer()).patch<Product>(`/products/${id}`, input);
export const setProductActive = async (id: string, active: boolean) =>
  (await writer()).post<Product>(`/products/${id}/${active ? "activate" : "deactivate"}`);

// --- SKUs ----------------------------------------------------------------------

export const searchSkus = async (q: string) => (await getApiClient()).get<Sku[]>("/skus/search", { params: { q } });
export const addSku = async (productId: string, input: NewSkuInput) => (await writer()).post<Sku>(`/products/${productId}/skus`, input);
export const updateSku = async (id: string, input: Partial<NewSkuInput>) => (await writer()).patch<Sku>(`/skus/${id}`, input);
export const setSkuActive = async (id: string, active: boolean) =>
  (await writer()).post<Sku>(`/skus/${id}/${active ? "activate" : "deactivate"}`);

export const addBarcode = async (skuId: string, input: { barcode: string; type: string; unit_id: string | null }) =>
  (await writer()).post<Sku>(`/skus/${skuId}/barcodes`, input);
export const removeBarcode = async (id: string) => (await writer()).delete(`/barcodes/${id}`);

export const addConversion = async (skuId: string, input: { unit_id: string; factor: string }) =>
  (await writer()).post<Sku>(`/skus/${skuId}/conversions`, input);
export const removeConversion = async (id: string) => (await writer()).delete(`/conversions/${id}`);

export const fetchPriceHistory = async (skuId: string) => (await getApiClient()).get<Price[]>(`/skus/${skuId}/prices`);
export const setPrice = async (skuId: string, input: { unit_id: string; tier: string; price: string; effective_from?: string | null }) =>
  (await writer()).post<Price>(`/skus/${skuId}/prices`, input);

// --- Images --------------------------------------------------------------------

export async function uploadImage(productId: string, file: File): Promise<Product> {
  const form = new FormData();
  form.append("image", file);
  return (await writer()).post<Product>(`/products/${productId}/images`, form);
}
export const makePrimaryImage = async (id: string) => (await writer()).post<Product>(`/product-images/${id}/primary`);
export const deleteImage = async (id: string) => (await writer()).delete(`/product-images/${id}`);
