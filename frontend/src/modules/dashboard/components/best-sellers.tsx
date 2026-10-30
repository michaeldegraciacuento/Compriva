import { Trophy } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { formatMoney, formatQuantity } from "@/lib/format";

import type { SalesOverview } from "../types";

/** Ranked list with an inline magnitude bar (one hue; the numbers are always shown). */
export function BestSellers({ items, period }: { items: SalesOverview["best_sellers"]; period: string }) {
  const top = Math.max(...items.map((i) => Number(i.sales)), 0);

  return (
    <Panel title="Best-selling products" description={`By sales, ${period}`} data-testid="best-sellers">
      {items.length === 0 || top === 0 ? (
        <EmptyState icon={Trophy} title="No sales yet">Best sellers appear after the first sales.</EmptyState>
      ) : (
        <ol className="grid grid-cols-1 gap-4">
          {items.map((item, index) => (
            <li key={item.sku_id} className="grid min-w-0 grid-cols-1 gap-1.5">
              <div className="flex items-baseline gap-3 text-sm">
                <span className="w-4 shrink-0 text-xs font-semibold text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium" title={item.name}>{item.name}</span>
                <span className="numeric shrink-0 font-semibold">{formatMoney(item.sales)}</span>
              </div>
              <div className="flex items-center gap-3 pl-7">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-chart-1" style={{ width: `${(Number(item.sales) / top) * 100}%` }} />
                </div>
                <span className="numeric w-16 shrink-0 text-right text-xs text-muted-foreground">
                  {formatQuantity(item.quantity_sold, item.unit)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
