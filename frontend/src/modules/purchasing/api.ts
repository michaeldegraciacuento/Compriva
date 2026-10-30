import { getApiClient } from "@/lib/api";
import type { Paginated, PaginationMeta } from "@/types/api";

import type { CostHistory, GoodsReceipt, OrderInput, OrderStatus, PurchaseOrder, ReceiveInput, Supplier } from "./types";

async function writer() {
  const api = await getApiClient();
  await api.ensureCsrfCookie();
  return api;
}

export async function fetchSuppliers(filters: { q?: string; status?: "active" | "inactive"; page?: number; per_page?: number }): Promise<Paginated<Supplier>> {
  return (await getApiClient()).request<Supplier[], PaginationMeta>("GET", "/suppliers", undefined, { params: filters });
}

export type SupplierInput = Partial<Omit<Supplier, "id" | "open_orders_count" | "purchased_total" | "last_received_at">>;
export const createSupplier = async (data: SupplierInput) => (await writer()).post<Supplier>("/suppliers", data);
export const updateSupplier = async (id: string, data: SupplierInput) => (await writer()).patch<Supplier>(`/suppliers/${id}`, data);

export async function fetchOrders(filters: { q?: string; status?: OrderStatus; supplier_id?: string; page?: number }): Promise<Paginated<PurchaseOrder>> {
  return (await getApiClient()).request<PurchaseOrder[], PaginationMeta>("GET", "/purchase-orders", undefined, { params: filters });
}

export const fetchOrder = async (id: string) => (await getApiClient()).get<PurchaseOrder>(`/purchase-orders/${id}`);
export const createOrder = async (input: OrderInput) => (await writer()).post<PurchaseOrder>("/purchase-orders", input);
export const updateOrder = async (id: string, input: OrderInput) => (await writer()).put<PurchaseOrder>(`/purchase-orders/${id}`, input);
export const approveOrder = async (id: string) => (await writer()).post<PurchaseOrder>(`/purchase-orders/${id}/approve`);
export const cancelOrder = async (id: string, reason?: string) => (await writer()).post<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { reason });
export const receiveOrder = async (id: string, input: ReceiveInput) => (await writer()).post<GoodsReceipt>(`/purchase-orders/${id}/receive`, input);

export async function fetchReceipts(filters: { q?: string; supplier_id?: string; from?: string; to?: string; page?: number }): Promise<Paginated<GoodsReceipt>> {
  return (await getApiClient()).request<GoodsReceipt[], PaginationMeta>("GET", "/goods-receipts", undefined, { params: filters });
}

export const fetchReceipt = async (id: string) => (await getApiClient()).get<GoodsReceipt>(`/goods-receipts/${id}`);
export const fetchCostHistory = async (skuId: string) => (await getApiClient()).get<CostHistory>(`/skus/${skuId}/cost-history`);
