"use client";

import { create } from "zustand";

import { uuidv7 } from "@/lib/ids";

import { addItem } from "./cart";
import { loadHeldCarts, saveHeldCarts, type HeldCart } from "./held-carts";
import type { CartLine, ItemDiscount, PosCustomer, PosItem, SaleDiscount } from "./types";

interface CartState {
  /**
   * ID of the sale this cart will become. Generated with the cart and kept
   * through payment retries, so a sale submitted twice is recorded once.
   */
  saleId: string;
  lines: CartLine[];
  discount: SaleDiscount | null;
  customerName: string;
  /** A customer chosen from the list (customerName then holds their name, editable). */
  customer: PosCustomer | null;
  held: HeldCart[];

  add(item: PosItem, options?: { unitId?: string | null; barcode?: string | null }): void;
  setQuantity(key: string, quantity: string): void;
  setUnit(key: string, unitId: string): void;
  setLineDiscount(key: string, discount: ItemDiscount | null): void;
  setPriceOverride(key: string, price: string | null): void;
  remove(key: string): void;
  replaceItems(items: PosItem[]): void;
  setDiscount(discount: SaleDiscount | null): void;
  setCustomerName(name: string): void;
  setCustomer(customer: PosCustomer | null): void;
  /** Starts a new cart (after a sale, or to discard this one). */
  clear(): void;

  loadHeld(terminalId: string): void;
  hold(terminalId: string, cashierName: string, label: string): boolean;
  resume(terminalId: string, id: string): void;
  discardHeld(terminalId: string, id: string): void;
}

const emptyCart = () => ({ saleId: uuidv7(), lines: [] as CartLine[], discount: null, customerName: "", customer: null });

const updateLine = (lines: CartLine[], key: string, patch: Partial<CartLine>) => lines.map((line) => (line.key === key ? { ...line, ...patch } : line));

export const useCartStore = create<CartState>()((set, get) => ({
  ...emptyCart(),
  held: [],

  add: (item, options) => set((s) => ({ lines: addItem(s.lines, item, options) })),
  setQuantity: (key, quantity) => set((s) => ({ lines: updateLine(s.lines, key, { quantity }) })),
  setUnit: (key, unitId) => set((s) => ({ lines: updateLine(s.lines, key, { unitId, priceOverride: null }) })),
  setLineDiscount: (key, discount) => set((s) => ({ lines: updateLine(s.lines, key, { discount }) })),
  setPriceOverride: (key, price) => set((s) => ({ lines: updateLine(s.lines, key, { priceOverride: price }) })),
  remove: (key) => set((s) => ({ lines: s.lines.filter((line) => line.key !== key) })),
  replaceItems: (items) =>
    set((s) => ({ lines: s.lines.map((line) => ({ ...line, item: items.find((item) => item.id === line.item.id) ?? line.item })) })),
  setDiscount: (discount) => set({ discount }),
  setCustomerName: (customerName) => set({ customerName }),
  setCustomer: (customer) => set({ customer }),
  clear: () => set(emptyCart()),

  loadHeld: (terminalId) => set({ held: loadHeldCarts(terminalId) }),
  hold: (terminalId, cashierName, label) => {
    const { lines, discount, customerName, customer, held } = get();
    if (lines.length === 0) return false;
    const cart: HeldCart = { id: uuidv7(), label, heldAt: new Date().toISOString(), cashierName, lines, discount, customerName, customer };
    const next = [...held, cart];
    if (!saveHeldCarts(terminalId, next)) return false;
    set({ ...emptyCart(), held: next });
    return true;
  },
  resume: (terminalId, id) => {
    const { held, lines } = get();
    const cart = held.find((c) => c.id === id);
    if (!cart || lines.length > 0) return;
    const next = held.filter((c) => c.id !== id);
    saveHeldCarts(terminalId, next);
    // A resumed cart becomes a new sale ID: it was never submitted.
    set({ saleId: uuidv7(), lines: cart.lines, discount: cart.discount, customerName: cart.customerName, customer: cart.customer ?? null, held: next });
  },
  discardHeld: (terminalId, id) => {
    const next = get().held.filter((c) => c.id !== id);
    saveHeldCarts(terminalId, next);
    set({ held: next });
  },
}));
