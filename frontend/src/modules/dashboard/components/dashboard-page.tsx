"use client";

import { Banknote, FlaskConical, Receipt, ShoppingBag, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { SegmentedControl } from "@/components/segmented-control";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatDate, formatMoney } from "@/lib/format";

import { fetchSalesOverview } from "../api";
import { useStockAlerts } from "../stock-alerts-store";
import type { DashboardRange, SalesOverview } from "../types";
import { BestSellers } from "./best-sellers";
import { RecentTransactions } from "./recent-transactions";
import { SalesChart } from "./sales-chart";
import { ExpiringPanel, LowStockPanel } from "./stock-panels";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
] as const satisfies readonly { value: DashboardRange; label: string }[];

const COPY: Record<DashboardRange, { sales: string; chart: string; compared: string; period: string }> = {
  today: { sales: "Today's sales", chart: "Sales by hour", compared: "vs yesterday", period: "today" },
  "7d": { sales: "Sales, last 7 days", chart: "Sales by day", compared: "vs previous 7 days", period: "last 7 days" },
  "30d": { sales: "Sales, last 30 days", chart: "Sales by day", compared: "vs previous 30 days", period: "last 30 days" },
};

function delta(change: string | null, comparedTo: string) {
  return change === null ? null : { percent: change, comparedTo };
}

/**
 * Store dashboard. The date range scopes the sales section (KPIs, chart,
 * best sellers, recent transactions). Stock alerts are live inventory and are
 * not affected by the range. Sales figures are SAMPLE data until the sales
 * endpoint exists; stock alerts are real.
 */
export function DashboardPage() {
  const [range, setRange] = useState<DashboardRange>("today");
  const [overview, setOverview] = useState<SalesOverview | null>(null);
  const stock = useStockAlerts();
  const loadStock = useStockAlerts((state) => state.load);
  const copy = COPY[range];

  useEffect(() => {
    let cancelled = false;
    // Refetch keeps the previous overview on screen until the new one arrives.
    void fetchSalesOverview(range).then((data) => {
      if (!cancelled) setOverview(data);
    });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => {
    void loadStock();
  }, [loadStock]);

  const kpis = overview?.kpis;

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Dashboard" description={formatDate(new Date(), "EEEE, d MMMM yyyy")} />

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl label="Date range" value={range} onChange={setRange} options={RANGES} />
        {overview?.is_sample && (
          <StatusBadge tone="info" icon={FlaskConical} className="h-auto min-h-7 py-1 whitespace-normal">
            Sample sales data — live figures arrive with the point of sale
          </StatusBadge>
        )}
      </div>

      <section aria-label="Sales summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis ? (
          <>
            <StatCard label={copy.sales} icon={Banknote} value={formatMoney(kpis.sales.value)}
              delta={delta(kpis.sales.change_percent, copy.compared)} />
            <StatCard label="Transactions" icon={Receipt} value={formatCount(kpis.transactions.value)}
              delta={delta(kpis.transactions.change_percent, copy.compared)} />
            <StatCard label="Average transaction value" icon={ShoppingBag} value={formatMoney(kpis.average_transaction_value.value)}
              delta={delta(kpis.average_transaction_value.change_percent, copy.compared)} />
            <StatCard label="Gross profit" icon={TrendingUp} value={formatMoney(kpis.gross_profit.value)}
              meta={`${kpis.gross_profit.margin_percent}% margin`}
              delta={delta(kpis.gross_profit.change_percent, copy.compared)} />
          </>
        ) : (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[132px] rounded-xl" />)
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {overview ? <SalesChart overview={overview} title={copy.chart} /> : <Skeleton className="h-[380px] rounded-xl" />}
        </div>
        {overview ? <BestSellers items={overview.best_sellers} period={copy.period} /> : <Skeleton className="h-[380px] rounded-xl" />}
      </div>

      {overview && <RecentTransactions items={overview.recent_transactions} />}

      <section aria-labelledby="stock-alerts-heading" className="grid grid-cols-1 gap-3">
        <div>
          <h2 id="stock-alerts-heading" className="text-base font-semibold">Stock alerts</h2>
          <p className="text-sm text-muted-foreground">Live inventory · not affected by the date range</p>
        </div>
        {stock.status === "error" && (
          <p className="text-sm text-danger" role="alert">Stock alerts could not be loaded. They refresh automatically.</p>
        )}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <LowStockPanel data={stock.data?.low_stock} loading={stock.status === "loading" || stock.status === "idle"} />
          <ExpiringPanel data={stock.data?.expiring} loading={stock.status === "loading" || stock.status === "idle"} />
        </div>
      </section>
    </div>
  );
}
