"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { EmptyState } from "@/components/empty-state";
import { Panel } from "@/components/panel";
import { SegmentedControl } from "@/components/segmented-control";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCount, formatMoney, formatMoneyCompact } from "@/lib/format";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { BarChart3 } from "lucide-react";

import type { SalesOverview } from "../types";

type Point = SalesOverview["series"]["points"][number];

interface TooltipProps {
  active?: boolean;
  payload?: { payload: Point }[];
}

/** Value leads, label follows; the series key is a short stroke, not a box. */
function ChartTooltip({ active, payload }: TooltipProps) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 text-xs text-muted-foreground">{point.label}</p>
      <p className="flex items-center gap-2">
        <span className="h-0.5 w-3 rounded-full bg-chart-1" aria-hidden />
        <span className="font-semibold">{formatMoney(point.sales)}</span>
        <span className="text-muted-foreground">sales</span>
      </p>
      <p className="mt-0.5 pl-5 text-xs text-muted-foreground">{formatCount(point.transactions)} transactions</p>
    </div>
  );
}

/**
 * Sales over time: one series (no legend — the title names it), columns
 * ≤ 24px with 4px rounded data-ends, hairline solid gridlines, compact peso
 * ticks, hover tooltip and a table view so no value is tooltip-only.
 */
export function SalesChart({ overview, title }: { overview: SalesOverview; title: string }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const reduceMotion = useReducedMotion();
  const points = overview.series.points;
  const peak = points.reduce<Point | null>((best, p) => (!best || Number(p.sales) > Number(best.sales) ? p : best), null);

  return (
    <Panel
      title={title}
      description={peak ? `Busiest ${overview.series.bucket === "hour" ? "hour" : "day"}: ${peak.label} · ${formatMoney(peak.sales)}` : undefined}
      action={
        <SegmentedControl
          label="Chart or table"
          value={view}
          onChange={setView}
          options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]}
        />
      }
      data-testid="sales-chart"
    >
      {points.length === 0 ? (
        <EmptyState icon={BarChart3} title="No sales yet today">The store opens at 7:00 am.</EmptyState>
      ) : view === "chart" ? (
        <figure
          className="numeric h-72 w-full"
          role="img"
          aria-label={`${title}. ${points.length} ${overview.series.bucket === "hour" ? "hours" : "days"}${peak ? `, highest ${peak.label} at ${formatMoney(peak.sales)}` : ""}. Switch to Table for all values.`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <YAxis
                tickFormatter={(value: number) => formatMoneyCompact(value)}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                width={56}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey={(p: Point) => Number(p.sales)} name="Sales" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={24}
                isAnimationActive={!reduceMotion} animationDuration={500} />
            </BarChart>
          </ResponsiveContainer>
        </figure>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <Table className="numeric">
            <TableHeader>
              <TableRow>
                <TableHead>{overview.series.bucket === "hour" ? "Hour" : "Day"}</TableHead>
                <TableHead className="text-right">Transactions</TableHead>
                <TableHead className="text-right">Sales</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((p) => (
                <TableRow key={p.starts_at}>
                  <TableCell>{p.label}</TableCell>
                  <TableCell className="text-right">{formatCount(p.transactions)}</TableCell>
                  <TableCell className="text-right">{formatMoney(p.sales)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
