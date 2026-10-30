import { getApiClient } from "@/lib/api";
import type { ApiEnvelope, Paginated, PaginationMeta } from "@/types/api";

import type { Approval, CartLine, CashMovementType, PaymentInput, PaymentMethod, PosBootstrap, PosItem, Sale, SaleDiscount, SaleReturn, Shift } from "./types";

async function writer() {
  const api = await getApiClient();
  await api.ensureCsrfCookie();
  return api;
}

export const fetchBootstrap = async () => (await getApiClient()).get<PosBootstrap>("/pos/terminal");
export const registerTerminal = async (name: string) => (await writer()).post("/pos/terminal", { name });

export const fetchShift = async () => (await getApiClient()).get<Shift | null>("/pos/shift");
export const openShift = async (openingFloat: string, notes?: string | null) => (await writer()).post<Shift>("/pos/shift", { opening_float: openingFloat, notes });
export const recordCashMovement = async (input: { type: CashMovementType; amount: string; reason: string; approval?: Approval | null }) =>
  (await writer()).post<Shift>("/pos/cash-movements", input);

export async function fetchShifts(filters: { status?: "open" | "closed"; from?: string; to?: string; page?: number }): Promise<Paginated<Shift>> {
  return (await getApiClient()).request<Shift[], PaginationMeta>("GET", "/shifts", undefined, { params: filters });
}

export const fetchShiftDetail = async (id: string) => (await getApiClient()).get<Shift>(`/shifts/${id}`);

export const closeShift = async (countedCash: string, notes?: string | null) => (await writer()).post<Shift>("/pos/shift/close", { counted_cash: countedCash, notes });

export async function fetchPosCatalog(params: { q?: string; barcode?: string; category_id?: string }): Promise<PosItem[]> {
  return (await getApiClient()).get<PosItem[]>("/pos/catalog", { params });
}

/** The cart in the shape the API expects. Prices are never sent, except a manager-approved override. */
export function cartPayload(lines: CartLine[], discount: SaleDiscount | null) {
  return {
    lines: lines.map((line) => ({
      sku_id: line.item.id,
      unit_id: line.unitId,
      quantity: line.quantity,
      barcode: line.barcode,
      unit_price: line.priceOverride,
      discount: line.discount,
    })),
    discount:
      discount === null
        ? null
        : discount.kind === "preset"
          ? { discount_id: discount.preset.id, customer_id_number: discount.customerIdNumber }
          : { type: discount.type, value: discount.value },
  };
}

export interface CheckoutInput {
  id: string;
  lines: CartLine[];
  discount: SaleDiscount | null;
  payments: PaymentInput[];
  expectedTotal: string;
  customerName?: string | null;
  approval?: Approval | null;
}

export async function checkout(input: CheckoutInput): Promise<ApiEnvelope<Sale, { replayed: boolean }>> {
  return (await writer()).request<Sale, { replayed: boolean }>("POST", "/pos/checkout", {
    id: input.id,
    ...cartPayload(input.lines, input.discount),
    payments: input.payments,
    expected_total: input.expectedTotal,
    customer_name: input.customerName || null,
    approval: input.approval ?? null,
  });
}

export const fetchShiftSales = async (q?: string) => (await getApiClient()).get<Sale[]>("/pos/sales", { params: q ? { q } : {} });

export interface SaleFilters {
  q?: string;
  status?: "completed" | "voided";
  from?: string;
  to?: string;
  page?: number;
}

export async function fetchSales(filters: SaleFilters): Promise<Paginated<Sale>> {
  return (await getApiClient()).request<Sale[], PaginationMeta>("GET", "/sales", undefined, { params: filters });
}

export const fetchSale = async (id: string) => (await getApiClient()).get<Sale>(`/sales/${id}`);
export const reprintSale = async (id: string) => (await writer()).post<Sale>(`/sales/${id}/reprint`);

export const voidSale = async (id: string, reason: string, approval?: Approval | null) =>
  (await writer()).post<Sale>(`/sales/${id}/void`, { reason, approval: approval ?? null });

export interface ReturnInput {
  reason: string;
  items: { sale_item_id: string; quantity: string; condition: "resellable" | "damaged" | "expired" }[];
  refund_method: string;
  refund_reference?: string | null;
  approval?: Approval | null;
}

export const returnItems = async (saleId: string, input: ReturnInput) => (await writer()).post<SaleReturn>(`/sales/${saleId}/returns`, input);

export const fetchPaymentMethods = async () => (await getApiClient()).get<PaymentMethod[]>("/payment-methods");
export const updatePaymentMethod = async (id: string, data: { account_name?: string | null; account_number?: string | null; is_active?: boolean }) =>
  (await writer()).patch<PaymentMethod>(`/payment-methods/${id}`, data);

export async function uploadPaymentQr(id: string, file: File): Promise<PaymentMethod> {
  const body = new FormData();
  body.append("image", file);
  return (await writer()).post<PaymentMethod>(`/payment-methods/${id}/qr`, body);
}

export const removePaymentQr = async (id: string) => (await writer()).delete<PaymentMethod>(`/payment-methods/${id}/qr`);
