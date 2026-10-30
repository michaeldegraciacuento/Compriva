import type { IsoDate, IsoDateTime, Money, Quantity, Uuid } from "@/types/common";

/**
 * Wire contracts of the dashboard.
 *
 * SalesOverview is the contract for the future GET /api/v1/dashboard/sales?range=…
 * (Sales/Reporting phase). Until then it is filled by sample-data.ts. Every
 * figure arrives computed by the server; the UI only formats it.
 */

export type DashboardRange = "today" | "7d" | "30d";

export interface KpiValue<T> {
  value: T;
  previous: T;
  /** Signed percent vs the previous period, e.g. "12.4". Null when there is no previous value. */
  change_percent: string | null;
}

export interface SalesOverview {
  range: DashboardRange;
  /** True while the dashboard shows generated sample data. */
  is_sample: boolean;
  generated_at: IsoDateTime;
  kpis: {
    sales: KpiValue<Money>;
    transactions: KpiValue<number>;
    average_transaction_value: KpiValue<Money>;
    gross_profit: KpiValue<Money> & { margin_percent: string };
  };
  series: {
    bucket: "hour" | "day";
    points: { label: string; starts_at: IsoDateTime; sales: Money; transactions: number }[];
  };
  best_sellers: { sku_id: Uuid; name: string; quantity_sold: Quantity; unit: string; sales: Money }[];
  recent_transactions: {
    id: Uuid;
    receipt_number: string;
    occurred_at: IsoDateTime;
    cashier_name: string;
    terminal_code: string;
    item_count: number;
    payment_method: "Cash" | "GCash" | "Maya" | "Card";
    total: Money;
    status: "completed" | "voided";
  }[];
}

/** GET /api/v1/dashboard/stock-alerts (real data). */
export interface StockAlerts {
  low_stock: {
    total: number;
    items: { sku_id: Uuid; sku_code: string; name: string; quantity_on_hand: Quantity; reorder_level: Quantity; unit: string }[];
  };
  expiring: {
    total: number;
    window_days: number;
    items: {
      batch_id: Uuid;
      batch_number: string;
      sku_id: Uuid;
      name: string;
      expiry_date: IsoDate;
      days_left: number;
      remaining_quantity: Quantity;
      unit: string;
    }[];
  };
  generated_at: IsoDateTime;
}
