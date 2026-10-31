import { getApiClient } from "@/lib/api";
import type { Paginated, PaginationMeta } from "@/types/api";

import type { Customer, CustomerInput, CustomerPurchase, CustomerType } from "./types";

async function writer() {
  const api = await getApiClient();
  await api.ensureCsrfCookie();
  return api;
}

export interface CustomerFilters {
  q?: string;
  type?: CustomerType;
  status?: "active" | "inactive";
  sort?: "name" | "recent" | "top";
  page?: number;
  per_page?: number;
}

export async function fetchCustomers(filters: CustomerFilters): Promise<Paginated<Customer>> {
  return (await getApiClient()).request<Customer[], PaginationMeta>("GET", "/customers", undefined, { params: filters });
}

export const fetchCustomer = async (id: string) => (await getApiClient()).get<Customer>(`/customers/${id}`);
export const createCustomer = async (data: CustomerInput) => (await writer()).post<Customer>("/customers", data);
export const updateCustomer = async (id: string, data: CustomerInput) => (await writer()).patch<Customer>(`/customers/${id}`, data);

export async function fetchCustomerPurchases(id: string, page = 1): Promise<Paginated<CustomerPurchase>> {
  return (await getApiClient()).request<CustomerPurchase[], PaginationMeta>("GET", `/customers/${id}/sales`, undefined, { params: { page } });
}
