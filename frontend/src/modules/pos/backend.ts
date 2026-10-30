import * as api from "./api";
import type { CheckoutInput } from "./api";
import type { Approval, CashMovementType, PosBootstrap, PosItem, Sale, Shift } from "./types";

/**
 * Where the POS reads and writes. The screens only talk to this interface:
 * - online: the web app, straight to the API (central stock)
 * - local:  the desktop terminal, its own SQLite database, synced in the
 *           background (src/modules/offline/local-pos.ts), the same in every
 *           mode, online or not (docs/offline-sync.md §1)
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
}

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
};
