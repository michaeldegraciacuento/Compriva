import * as api from "./api";
import type { CheckoutInput } from "./api";
import { createCustomer, fetchCustomers } from "../customers/api";
import type { Customer, CustomerInput } from "../customers/types";
import type { Approval, CashMovementType, PosBootstrap, PosCustomer, PosItem, Sale, Shift } from "./types";

/**
 * Where the POS reads and writes. The screens only talk to this interface:
 * - online: the web app, straight to the API (central stock)
 * - local:  the desktop terminal, its own SQLite database, synced in the
 *           background (src/modules/offline/local-pos.ts), the same in every
 *           mode, online or not (docs/README.md)
 */
export interface PosBackend {
  readonly kind: "online" | "local";
  bootstrap(): Promise<PosBootstrap>;
  registerTerminal(name: string): Promise<void>;
  openShift(openingFloat: string): Promise<Shift>;
  fetchShift(): Promise<Shift | null>;
  closeShift(countedCash: string, notes?: string | null): Promise<Shift>;
  catalog(params: { q?: string; barcode?: string; category_id?: string }): Promise<PosItem[]>;
  /** Resolves only once the sale is saved (on the server, or in the local database). */
  checkout(input: CheckoutInput): Promise<Sale>;
  shiftSales(q?: string): Promise<Sale[]>;
  cashMovement(input: { type: CashMovementType; amount: string; reason: string; approval?: Approval | null }): Promise<Shift>;
  fetchSale(id: string): Promise<Sale>;
  voidSale(id: string, reason: string, approval?: Approval | null): Promise<Sale>;
  /** Active customers matching a name, code, phone or ID number (from the local cache on desktop). */
  customers(q: string): Promise<PosCustomer[]>;
  /** Adds a customer. Needs the server, also on desktop, where the new customer is cached at once. */
  createCustomer(input: CustomerInput): Promise<PosCustomer>;
}

export const toPosCustomer = (c: Customer | PosCustomer): PosCustomer => ({
  id: c.id, code: c.code, name: c.name, type: c.type, phone: c.phone, tin: c.tin, address: c.address, id_number: c.id_number,
});

export const onlinePos: PosBackend = {
  kind: "online",
  bootstrap: () => api.fetchBootstrap(),
  registerTerminal: async (name) => {
    await api.registerTerminal(name);
  },
  openShift: (openingFloat) => api.openShift(openingFloat),
  fetchShift: () => api.fetchShift(),
  closeShift: (countedCash, notes) => api.closeShift(countedCash, notes),
  catalog: (params) => api.fetchPosCatalog(params),
  checkout: async (input) => (await api.checkout(input)).data,
  shiftSales: (q) => api.fetchShiftSales(q),
  cashMovement: (input) => api.recordCashMovement(input),
  fetchSale: (id) => api.fetchSale(id),
  voidSale: (id, reason, approval) => api.voidSale(id, reason, approval),
  customers: async (q) => (await fetchCustomers({ q: q || undefined, status: "active", per_page: 20 })).data.map(toPosCustomer),
  createCustomer: async (input) => toPosCustomer(await createCustomer(input)),
};
