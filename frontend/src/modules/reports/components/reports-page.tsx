"use client";

import { endOfMonth, format, startOfMonth, startOfWeek, subDays, subMonths } from "date-fns";
import { BarChart3, FileDown, FileSpreadsheet, FileText, Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { SegmentedControl } from "@/components/segmented-control";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { cn } from "@/lib/utils";

import { downloadReport, fetchReport, fetchReportCatalog, type ExportFormat, type ReportInfo, type ReportParams } from "../api";
import { formatCell, NUMERIC_TYPES } from "../format";

const day = (d: Date) => format(d, "yyyy-MM-dd");
type Preset = "today" | "week" | "month" | "last-month" | "30" | "custom";

function presetRange(preset: Preset): { from: string; to: string } | null {
  const now = new Date();
  switch (preset) {
    case "today": return { from: day(now), to: day(now) };
    case "week": return { from: day(startOfWeek(now, { weekStartsOn: 1 })), to: day(now) };
    case "month": return { from: day(startOfMonth(now)), to: day(now) };
    case "last-month": {
      const last = subMonths(now, 1);
      return { from: day(startOfMonth(last)), to: day(endOfMonth(last)) };
    }
    case "30": return { from: day(subDays(now, 29)), to: day(now) };
    default: return null;
  }
}

/** Reports: pick a report, a period, read it on screen, export it as CSV, Excel or PDF. */
export function ReportsPage() {
  const catalog = useApiQuery(["report-catalog"], fetchReportCatalog);
  const router = useRouter();
  const selectedKey = useSearchParams().get("report");
  const reports = catalog.data ?? [];
  const selected = reports.find((r) => r.key === selectedKey) ?? reports[0];

  if (catalog.error) return <Alert variant="destructive"><AlertDescription>{catalog.error.message}</AlertDescription></Alert>;

  return (
    <div className="grid gap-6">
      <PageHeader title="Reports" description="Sales, profit, payments, cashiers and stock. Export any report as CSV, Excel or PDF." />
      <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Reports" className="grid gap-1">
          {!catalog.data
            ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)
            : reports.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  aria-current={r.key === selected?.key ? "page" : undefined}
                  onClick={() => router.replace(`/reports?report=${r.key}`)}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    r.key === selected?.key ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted",
                  )}
                >
                  {r.title}
                  {r.profit && <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Cost and profit" />}
                </button>
              ))}
        </nav>
        {selected ? <ReportView key={selected.key} report={selected} /> : catalog.data && <EmptyState icon={BarChart3} title="No reports available" />}
      </div>
    </div>
  );
}

function ReportView({ report }: { report: ReportInfo }) {
  const [preset, setPreset] = useState<Preset>("month");
  const [custom, setCustom] = useState(() => presetRange("month")!);
  const [group, setGroup] = useState<"day" | "week" | "month">("day");
  const [days, setDays] = useState("30");
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const range = presetRange(preset) ?? custom;
  const params: ReportParams = {
    ...(report.filters.includes("range") ? range : {}),
    ...(report.filters.includes("group") ? { group } : {}),
    ...(report.filters.includes("days") ? { days: Math.max(0, Math.min(365, parseInt(days, 10) || 0)) } : {}),
  };
  const data = useApiQuery(["report", report.key, params], () => fetchReport(report.key, params));

  const exportAs = async (formatName: ExportFormat) => {
    setExporting(formatName);
    setExportError(null);
    try {
      await downloadReport(report.key, params, formatName);
    } catch (caught) {
      setExportError(toApiError(caught).message);
    } finally {
      setExporting(null);
    }
  };

  const result = data.data;

  return (
    <div className="grid min-w-0 gap-4">
      <Panel title={report.title} description={report.description}>
        <div className="flex flex-wrap items-end gap-3">
          {report.filters.includes("range") && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="report-period">Period</Label>
                <select id="report-period" value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className="h-9 rounded-md border bg-transparent px-2 text-sm">
                  <option value="today">Today</option>
                  <option value="week">This week</option>
                  <option value="month">This month</option>
                  <option value="last-month">Last month</option>
                  <option value="30">Last 30 days</option>
                  <option value="custom">Custom…</option>
                </select>
              </div>
              {preset === "custom" && (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="report-from">From</Label>
                    <Input id="report-from" type="date" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="report-to">To</Label>
                    <Input id="report-to" type="date" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
                  </div>
                </>
              )}
            </>
          )}
          {report.filters.includes("group") && (
            <SegmentedControl label="Group by" value={group} onChange={setGroup} options={[{ value: "day", label: "Daily" }, { value: "week", label: "Weekly" }, { value: "month", label: "Monthly" }]} />
          )}
          {report.filters.includes("days") && (
            <div className="grid gap-1.5">
              <Label htmlFor="report-days">Expiring within (days)</Label>
              <Input id="report-days" type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" />
            </div>
          )}
          <div className="ml-auto flex flex-wrap gap-2" role="group" aria-label="Export">
            <Button variant="outline" size="sm" disabled={exporting !== null} onClick={() => void exportAs("csv")}><FileText aria-hidden /> {exporting === "csv" ? "Exporting…" : "CSV"}</Button>
            <Button variant="outline" size="sm" disabled={exporting !== null} onClick={() => void exportAs("xlsx")}><FileSpreadsheet aria-hidden /> {exporting === "xlsx" ? "Exporting…" : "Excel"}</Button>
            <Button variant="outline" size="sm" disabled={exporting !== null} onClick={() => void exportAs("pdf")}><FileDown aria-hidden /> {exporting === "pdf" ? "Exporting…" : "PDF"}</Button>
          </div>
        </div>
        {exportError && <Alert variant="destructive" className="mt-3"><AlertDescription>{exportError}</AlertDescription></Alert>}
      </Panel>

      {data.error ? (
        <Alert variant="destructive"><AlertDescription>{data.error.message}</AlertDescription></Alert>
      ) : !result ? (
        <Skeleton className="h-64" aria-busy="true" />
      ) : (
        <Panel title={result.title} description={result.subtitle} flush>
          {result.rows.length === 0 ? (
            <EmptyState icon={BarChart3} title="Nothing to report">No data for this period.</EmptyState>
          ) : (
            <div className="overflow-x-auto" aria-busy={data.fetching}>
              <Table className="numeric">
                <TableHeader>
                  <TableRow>
                    {result.columns.map((c, i) => (
                      <TableHead key={c.key} className={cn("whitespace-nowrap", NUMERIC_TYPES.includes(c.type) && "text-right", i === 0 && "pl-5", i === result.columns.length - 1 && "pr-5")}>
                        {c.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row, r) => (
                    <TableRow key={r}>
                      {result.columns.map((c, i) => (
                        <TableCell key={c.key} className={cn(NUMERIC_TYPES.includes(c.type) && "text-right whitespace-nowrap", i === 0 && "pl-5 font-medium", i === result.columns.length - 1 && "pr-5")}>
                          {formatCell(row[c.key], c.type)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {result.totals && (
                    <TableRow className="bg-muted/50 font-semibold">
                      {result.columns.map((c, i) => (
                        <TableCell key={c.key} className={cn(NUMERIC_TYPES.includes(c.type) && "text-right whitespace-nowrap", i === 0 && "pl-5", i === result.columns.length - 1 && "pr-5")}>
                          {result.totals![c.key] == null ? "" : formatCell(result.totals![c.key], c.type)}
                        </TableCell>
                      ))}
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {result.notes.length > 0 && (
            <div className="grid gap-1 px-5 pt-3 text-xs text-muted-foreground">
              {result.notes.map((note) => <p key={note}>{note}</p>)}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

