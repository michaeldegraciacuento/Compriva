import { ArrowDownRight, ArrowUpRight, type LucideIcon, Minus } from "lucide-react";

import { Card } from "@/components/ui/card";
import { formatPercentChange } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface StatDelta {
  /** Signed percentage change, e.g. "12.4" or "-3.0". */
  percent: string;
  /** What the change is measured against, e.g. "vs yesterday". */
  comparedTo: string;
  /** Whether an increase is good (sales) or bad (refunds). Default: up is good. */
  upIsGood?: boolean;
}

/**
 * KPI tile: label · value · optional delta. The delta's color follows
 * direction × whether up is good, and always carries an arrow and the
 * signed number, so it never relies on color alone.
 */
export function StatCard({ label, value, meta, icon: Icon, delta, footnote, className }: {
  label: string;
  value: string;
  /** Secondary figure beside the value, e.g. "20.0% margin". */
  meta?: string;
  icon?: LucideIcon;
  delta?: StatDelta | null;
  footnote?: string;
  className?: string;
}) {
  return (
    <Card className={cn("gap-3 px-5", className)} data-testid={`stat-${label}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-accent-foreground" aria-hidden>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p className="flex items-baseline gap-2">
        <span className="text-[1.75rem] leading-none font-semibold tracking-tight" data-testid="stat-value">{value}</span>
        {meta && <span className="text-xs font-medium text-muted-foreground">{meta}</span>}
      </p>
      {delta ? <Delta {...delta} /> : footnote ? <p className="text-xs text-muted-foreground">{footnote}</p> : null}
    </Card>
  );
}

export function Delta({ percent, comparedTo, upIsGood = true }: StatDelta) {
  const n = Number(percent);
  const direction = n > 0 ? "up" : n < 0 ? "down" : "flat";
  const good = direction === "flat" ? null : (direction === "up") === upIsGood;
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;

  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
          good === true && "bg-success-soft text-success",
          good === false && "bg-danger-soft text-danger",
          good === null && "bg-muted text-muted-foreground",
        )}
        data-direction={direction}
      >
        <Icon className="size-3.5" aria-hidden />
        {formatPercentChange(n)}
      </span>
      {comparedTo}
    </p>
  );
}
