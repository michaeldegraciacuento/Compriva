import { getApiClient } from "@/lib/api";

import { sampleSalesOverview } from "./sample-data";
import type { DashboardRange, SalesOverview, StockAlerts } from "./types";

/** Real data: low stock and expiring batches. */
export async function fetchStockAlerts(): Promise<StockAlerts> {
  const api = await getApiClient();
  return api.get<StockAlerts>("/dashboard/stock-alerts");
}

/**
 * Sales overview. Returns SAMPLE data until the sales endpoint exists; the
 * signature already matches the future GET /dashboard/sales?range=…, so only
 * this function body changes when it lands.
 */
export async function fetchSalesOverview(range: DashboardRange): Promise<SalesOverview> {
  return sampleSalesOverview(range);
}
