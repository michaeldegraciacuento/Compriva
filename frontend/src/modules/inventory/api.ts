import { getApiClient } from "@/lib/api";
import type { ApiEnvelope, Paginated, PaginationMeta } from "@/types/api";

import type { DocumentLineInput, DocumentType, StockBatch, StockDocument, StockLevel, StockMovement, StockSummary } from "./types";

async function writer() {
  const api = await getApiClient();
  await api.ensureCsrfCookie();
  return api;
}

export interface StockFilters {
  q?: string;
  category_id?: string;
  status?: "ok" | "low" | "out";
  page?: number;
}

export async function fetchStock(filters: StockFilters): Promise<ApiEnvelope<StockLevel[], PaginationMeta> & { summary: StockSummary }> {
  const api = await getApiClient();
  return api.request<StockLevel[], PaginationMeta>("GET", "/inventory/stock", undefined, { params: filters }) as Promise<
    ApiEnvelope<StockLevel[], PaginationMeta> & { summary: StockSummary }
  >;
}

export async function fetchDocuments(filters: { type?: DocumentType; status?: string; q?: string; page?: number }): Promise<Paginated<StockDocument>> {
  return (await getApiClient()).request<StockDocument[], PaginationMeta>("GET", "/inventory/documents", undefined, { params: filters });
}

export const fetchDocument = async (id: string) => (await getApiClient()).get<StockDocument>(`/inventory/documents/${id}`);

const PATHS: Record<DocumentType, string> = { stock_in: "/inventory/stock-in", stock_out: "/inventory/stock-out", adjustment: "/inventory/adjustments" };

export async function createDocument(type: DocumentType, input: { reason: string; reference?: string | null; notes?: string | null; lines: DocumentLineInput[] }) {
  return (await writer()).post<StockDocument>(PATHS[type], input);
}

export const approveDocument = async (id: string) => (await writer()).post<StockDocument>(`/inventory/documents/${id}/approve`);
export const rejectDocument = async (id: string) => (await writer()).delete(`/inventory/documents/${id}`);

export async function fetchMovements(filters: { sku_id?: string; type?: string; document_id?: string; from?: string; to?: string; page?: number }): Promise<Paginated<StockMovement>> {
  return (await getApiClient()).request<StockMovement[], PaginationMeta>("GET", "/inventory/movements", undefined, { params: filters });
}

export async function fetchBatches(filters: { sku_id?: string; status?: string; page?: number }): Promise<ApiEnvelope<StockBatch[], PaginationMeta & { expiry_warning_days?: number }>> {
  return (await getApiClient()).request<StockBatch[], PaginationMeta & { expiry_warning_days?: number }>("GET", "/inventory/batches", undefined, { params: filters });
}
