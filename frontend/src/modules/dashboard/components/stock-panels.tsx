import { CalendarCheck, PackageCheck } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Meter } from "@/components/meter";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatQuantity } from "@/lib/format";
import { expiryStatus } from "@/modules/inventory/status";

import type { StockAlerts } from "../types";

function LoadingRows() {
  return (
    <div className="grid gap-4" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-1.5 w-full" />
        </div>
      ))}
    </div>
  );
}

/** Only rendered when the list is truncated; otherwise the panel has no footer at all. */
function moreFooter(data: { items: unknown[]; total: number } | undefined, noun: string) {
  if (!data || data.total <= data.items.length) return undefined;
  return <span className="text-muted-foreground">Showing {data.items.length} of {data.total} {noun}. The Inventory module lists all of them.</span>;
}

export function LowStockPanel({ data, loading }: { data: StockAlerts["low_stock"] | undefined; loading: boolean }) {
  return (
    <Panel
      title="Low-stock alerts"
      description="At or below the reorder level"
      action={data && data.total > 0 ? <StatusBadge tone="danger">{data.total} items</StatusBadge> : undefined}
      footer={moreFooter(data, "products")}
      data-testid="low-stock"
    >
      {loading && !data ? (
        <LoadingRows />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={PackageCheck} title="Stock levels look good">No product is at or below its reorder level.</EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4">
          {data.items.map((item) => {
            const onHand = Number(item.quantity_on_hand);
            const out = onHand <= 0;
            return (
              <li key={item.sku_id} className="grid min-w-0 grid-cols-1 gap-2">
                <div className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium" title={item.name}>{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.sku_code}</p>
                  </div>
                  {out ? <StatusBadge tone="danger">Out of stock</StatusBadge> : <StatusBadge tone="warning">Low</StatusBadge>}
                </div>
                <div className="flex items-center gap-3">
                  <Meter value={onHand} max={Number(item.reorder_level)} tone={out ? "danger" : "warning"} label={`${item.name} stock level`} />
                  <span className="numeric shrink-0 text-xs text-muted-foreground">
                    {formatQuantity(item.quantity_on_hand)} / {formatQuantity(item.reorder_level, item.unit)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function ExpiringPanel({ data, loading }: { data: StockAlerts["expiring"] | undefined; loading: boolean }) {
  return (
    <Panel
      title="Expiring products"
      description={data ? `Batches expiring within ${data.window_days} days` : "Batches close to their expiry date"}
      action={data && data.total > 0 ? <StatusBadge tone="warning">{data.total} batches</StatusBadge> : undefined}
      footer={moreFooter(data, "batches")}
      data-testid="expiring"
    >
      {loading && !data ? (
        <LoadingRows />
      ) : !data || data.items.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="Nothing expiring soon">No batch expires within the warning window.</EmptyState>
      ) : (
        <ul className="divide-y">
          {data.items.map((item) => {
            const status = expiryStatus(item.days_left);
            return (
              <li key={item.batch_id} className="flex items-start justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate font-medium" title={item.name}>{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Batch {item.batch_number} · {formatDate(item.expiry_date)} · {formatQuantity(item.remaining_quantity, item.unit)} left
                  </p>
                </div>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
