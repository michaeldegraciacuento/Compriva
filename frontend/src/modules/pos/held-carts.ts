import type { CartLine, SaleDiscount } from "./types";

/**
 * Held (parked) carts stay on the terminal, like every cart: a cart is not a
 * sale and never reaches the server until checkout (docs/offline-sync.md §1).
 * They are kept in this browser's / desktop webview's local storage, per
 * terminal, so they survive a reload. When the desktop app sells from SQLite
 * (offline phase) this moves to the local database behind the same functions.
 */

export interface HeldCart {
  id: string;
  label: string;
  heldAt: string;
  cashierName: string;
  lines: CartLine[];
  discount: SaleDiscount | null;
  customerName: string;
}

const key = (terminalId: string) => `compriva.pos.held.${terminalId}`;

export function loadHeldCarts(terminalId: string): HeldCart[] {
  try {
    const raw = window.localStorage.getItem(key(terminalId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HeldCart[]) : [];
  } catch {
    return [];
  }
}

export function saveHeldCarts(terminalId: string, carts: HeldCart[]): boolean {
  try {
    window.localStorage.setItem(key(terminalId), JSON.stringify(carts));
    return true;
  } catch {
    return false; // storage full or blocked: the caller keeps the cart on screen
  }
}
