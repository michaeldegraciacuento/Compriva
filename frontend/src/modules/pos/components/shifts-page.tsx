"use client";

import { Wallet } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";

import { fetchShiftDetail, fetchShifts } from "../api";
import { cents, ZERO } from "../fixed-point";
import type { Shift } from "../types";
import { methodName } from "./receipt";

const MOVEMENT_LABELS = { cash_in: "Cash in", cash_out: "Cash out", cash_drop: "Cash drop" } as const;

function Variance({ value }: { value: string | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const v = cents(value);
  if (v === ZERO) return <StatusBadge tone="success">Balanced</StatusBadge>;
  return <StatusBadge tone={v < ZERO ? "danger" : "warning"}>{v < ZERO ? `Short ${formatMoney(value.replace("-", ""))}` : `Over ${formatMoney(value)}`}</StatusBadge>;
}

/** Shift history: opening cash, cash in/out, expected vs counted cash, over/short. */
export function ShiftsPage() {
  const [filters, setFilters] = useState<{ status?: "open" | "closed"; from?: string; to?: string; page: number }>({ page: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const shifts = useApiQuery(["shifts", filters], () => fetchShifts(filters));

  return (
    <div className="grid gap-6">
      <PageHeader title="Cashier shifts" description="Every shift's takings and drawer count. Expected cash = opening cash + cash sales + cash in − refunds − cash out." />
      <Panel title="Shifts" flush>
        <div className="flex flex-col gap-2 px-5 pb-4 sm:flex-row">
          <NativeSelect aria-label="Status" value={filters.status ?? ""} onChange={(e) => setFilters({ ...filters, status: (e.target.value || undefined) as "open" | "closed", page: 1 })} className="sm:w-40">
            <option value="">Open and closed</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </NativeSelect>
          <Input type="date" aria-label="From date" value={filters.from ?? ""} onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined, page: 1 })} className="sm:w-40" />
          <Input type="date" aria-label="To date" value={filters.to ?? ""} onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined, page: 1 })} className="sm:w-40" />
        </div>
        {shifts.error ? (
          <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{shifts.error.message}</AlertDescription></Alert>
        ) : shifts.loading ? (
          <div className="grid gap-3 px-5" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : shifts.data?.data.length === 0 ? (
          <EmptyState icon={Wallet} title="No shifts found" />
        ) : (
          <Table className="numeric">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Shift</TableHead>
                <TableHead className="hidden text-right md:table-cell">Sales</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Expected</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Counted</TableHead>
                <TableHead className="pr-5 text-right">Drawer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.data?.data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="pl-5">
                    <Button variant="link" className="h-auto p-0 font-medium" onClick={() => setSelected(s.id)}>{s.cashier.name}</Button>
                    <span className="block text-xs text-muted-foreground">
                      {s.terminal.code} · {formatDate(s.opened_at)} {formatTime(s.opened_at)}{s.closed_at ? `–${formatTime(s.closed_at)}` : " · open"}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-right md:table-cell">
                    {formatMoney(s.sales_total ?? "0")}<span className="block text-xs text-muted-foreground">{s.sales_count} sales</span>
                  </TableCell>
                  <TableCell className="hidden text-right lg:table-cell">{s.expected_cash ? formatMoney(s.expected_cash) : "—"}</TableCell>
                  <TableCell className="hidden text-right lg:table-cell">{s.counted_cash ? formatMoney(s.counted_cash) : "—"}</TableCell>
                  <TableCell className="pr-5 text-right">{s.status === "open" ? <StatusBadge tone="info">Open</StatusBadge> : <Variance value={s.cash_variance} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Pagination meta={shifts.data?.meta} onPage={(page) => setFilters({ ...filters, page })} />
      </Panel>
      {selected && <ShiftDialog id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd className="numeric">{value}</dd>
    </div>
  );
}

function ShiftDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const shift = useApiQuery(["shift", id], () => fetchShiftDetail(id));
  const s: Shift | undefined = shift.data;
  const summary = s?.summary;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{s ? `${s.cashier.name} · ${s.terminal.code}` : "Shift"}</DialogTitle>
          <DialogDescription>{s && `${formatDate(s.opened_at)} ${formatTime(s.opened_at)}${s.closed_at ? ` – ${formatTime(s.closed_at)}, closed by ${s.closed_by}` : " · still open"}`}</DialogDescription>
        </DialogHeader>
        {!s || !summary ? (
          <Skeleton className="h-48" />
        ) : (
          <div className="grid gap-4 text-sm">
            <dl className="grid gap-1 rounded-lg bg-muted/60 p-3">
              <Row label={`Sales (${summary.sales_count})`} value={formatMoney(summary.sales_total)} />
              {Object.entries(summary.payments).map(([method, p]) => <Row key={method} label={`  ${methodName(method)}`} value={formatMoney(p.total)} />)}
              {summary.voided_count > 0 && <Row label="Voided sales" value={String(summary.voided_count)} />}
              <div className="my-1 border-t" />
              <Row label="Opening cash" value={formatMoney(summary.opening_float)} />
              <Row label="+ Cash sales" value={formatMoney(summary.cash_sales)} />
              <Row label="+ Cash in" value={formatMoney(summary.cash_in)} />
              <Row label="− Cash refunds" value={formatMoney(summary.cash_refunds)} />
              <Row label="− Cash out and drops" value={formatMoney(summary.cash_out)} />
              <Row label="Expected cash" value={formatMoney(summary.expected_cash)} strong />
              {s.counted_cash && <Row label="Counted" value={formatMoney(s.counted_cash)} strong />}
              {s.cash_variance && <Row label="Over / short" value={formatMoney(s.cash_variance)} strong />}
            </dl>
            {s.cash_movements.length > 0 && (
              <div>
                <h3 className="mb-1 font-medium">Cash in and out</h3>
                <ul className="grid gap-1">
                  {s.cash_movements.map((m) => (
                    <li key={m.id} className="flex justify-between gap-3">
                      <span>{MOVEMENT_LABELS[m.type]} · {m.reason}<span className="block text-xs text-muted-foreground">{formatTime(m.occurred_at)} · {m.performed_by}</span></span>
                      <span className="numeric">{m.type === "cash_in" ? "+" : "−"}{formatMoney(m.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {s.notes && <p className="text-muted-foreground">{s.notes}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
