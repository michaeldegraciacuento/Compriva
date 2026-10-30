import { create } from "zustand";

import { ApiError } from "@/lib/api";

import { fetchStockAlerts } from "./api";
import type { StockAlerts } from "./types";

const REFRESH_MS = 5 * 60_000;

interface StockAlertsState {
  data: StockAlerts | null;
  /** "forbidden": the user may not see stock alerts (not an error to display). */
  status: "idle" | "loading" | "ready" | "error" | "forbidden";
  loadedAt: number;
  load(force?: boolean): Promise<void>;
}

/**
 * Shared by the dashboard panels and the header notifications so both show
 * the same numbers from one request. Refetching keeps the previous data on
 * screen (no skeleton flash).
 */
export const useStockAlerts = create<StockAlertsState>()((set, get) => ({
  data: null,
  status: "idle",
  loadedAt: 0,

  async load(force = false) {
    const { status, loadedAt } = get();
    if (status === "loading" || status === "forbidden") return;
    if (!force && status === "ready" && Date.now() - loadedAt < REFRESH_MS) return;

    set({ status: get().data ? "ready" : "loading" });
    try {
      set({ data: await fetchStockAlerts(), status: "ready", loadedAt: Date.now() });
    } catch (error) {
      set({ status: error instanceof ApiError && error.code === "FORBIDDEN" ? "forbidden" : "error" });
    }
  },
}));
