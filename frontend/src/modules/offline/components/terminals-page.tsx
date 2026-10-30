"use client";

import { AlertTriangle, CheckCircle2, Monitor } from "lucide-react";
import { useState, type FormEvent } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getApiClient, toApiError } from "@/lib/api";
import { formatDate, formatRelative, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import type { Sku } from "@/modules/catalog/types";
import { SkuPicker } from "@/modules/inventory/components/sku-picker";
import { formatUnits, parse } from "@/modules/pos/fixed-point";

interface TerminalRow {
  id: string;
  code: string;
  name: string;
  status: string;
  syncs: boolean;
  last_seen_at: string | null;
  last_synced_at: string | null;
  last_receipt_sequence: number;
  operations_applied: number;
  operations_rejected: number;
  open_conflicts: number;
  allocated_skus: number;
  allocated_units: string;
}

interface TerminalDetail {
  terminal: { id: string; code: string; name: string };
  allocations: { sku: { id: string; code: string; name: string; unit: string }; allocated: string; consumed: string; released: string; remaining: string }[];
  operations: { id: string; local_seq: number; type: string; status: string; error_code: string | null; error_message: string | null; occurred_at: string; received_at: string }[];
}

interface Conflict {
  id: string;
  terminal: string;
  type: string;
  message: string;
  detected_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

const CONFLICT_LABELS: Record<string, string> = {
  stock_shortage: "Stock short",
  over_allocation: "Beyond allocation",
  price_changed: "Price changed",
  shift_replaced: "Shift replaced",
  expected_cash: "Cash differs",
};

const qty = (value: string) => formatUnits(parse(value));

/**
 * Checkout terminals for managers: when each last synced, what the server
 * applied or rejected, the stock allocated to each, and the conflicts found
 * when offline sales arrived (kept and flagged, never discarded).
 */
export function TerminalsPage() {
  const terminals = useApiQuery(["terminals"], async () => (await getApiClient()).get<TerminalRow[]>("/terminals"));
  const conflicts = useApiQuery(["sync-conflicts"], async () => (await getApiClient()).get<Conflict[]>("/sync/conflicts", { params: { status: "open" } }));
  const [selected, setSelected] = useState<TerminalRow | null>(null);

  return (
    <div className="grid gap-6">
      <PageHeader title="Terminals & sync" description="Desktop terminals sell offline from the stock allocated to them and sync in the background." />

      <Panel title="Terminals" flush>
        {terminals.error ? (
          <Alert variant="destructive" className="mx-5 w-auto"><AlertDescription>{terminals.error.message}</AlertDescription></Alert>
        ) : !terminals.data ? (
          <div className="grid gap-3 px-5">{[0, 1].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : terminals.data.length === 0 ? (
          <EmptyState icon={Monitor} title="No terminals yet">Set one up from the Point of Sale page on the checkout computer.</EmptyState>
        ) : (
          <Table className="numeric">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Terminal</TableHead>
                <TableHead className="hidden md:table-cell">Last sync</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Operations</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Allocated</TableHead>
                <TableHead className="pr-5 text-right">Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {terminals.data.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="pl-5">
                    <Button variant="link" className="h-auto p-0 font-medium" onClick={() => setSelected(t)}>{t.code} · {t.name}</Button>
                    <span className="block text-xs text-muted-foreground">{t.syncs ? "Desktop, syncs offline sales" : "Browser (online only)"} · last receipt {t.last_receipt_sequence}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{t.last_synced_at ? formatRelative(t.last_synced_at) : "Never"}</TableCell>
                  <TableCell className="hidden text-right lg:table-cell">{t.operations_applied}{t.operations_rejected > 0 && <span className="text-danger"> · {t.operations_rejected} rejected</span>}</TableCell>
                  <TableCell className="hidden text-right sm:table-cell">{t.allocated_skus} items · {qty(t.allocated_units)} units</TableCell>
                  <TableCell className="pr-5 text-right">
                    {t.status !== "active" ? <StatusBadge tone="neutral">{t.status}</StatusBadge>
                      : t.open_conflicts > 0 || t.operations_rejected > 0 ? <StatusBadge tone="warning">Needs review</StatusBadge>
                        : <StatusBadge tone="success">OK</StatusBadge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel title="Conflicts to review" description="Offline operations the server applied but did not match its own records. The sale is kept; count the stock or check the price, then mark it reviewed." flush>
        {!conflicts.data ? (
          <Skeleton className="mx-5 h-16" />
        ) : conflicts.data.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing to review" />
        ) : (
          <ul className="divide-y">
            {conflicts.data.map((c) => <ConflictRow key={c.id} conflict={c} onResolved={conflicts.reload} />)}
          </ul>
        )}
      </Panel>

      {selected && <TerminalDialog terminal={selected} onClose={() => setSelected(null)} onChanged={terminals.reload} />}
    </div>
  );
}

function ConflictRow({ conflict, onResolved }: { conflict: Conflict; onResolved: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const resolve = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const api = await getApiClient();
      await api.ensureCsrfCookie();
      await api.post(`/sync/conflicts/${conflict.id}/resolve`, { note });
      await onResolved();
    } catch (caught) {
      setError(toApiError(caught).message);
      setBusy(false);
    }
  };

  return (
    <li className="grid gap-2 px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="warning" icon={AlertTriangle}>{CONFLICT_LABELS[conflict.type] ?? conflict.type}</StatusBadge>
        <span className="text-xs text-muted-foreground">{conflict.terminal} · {formatDate(conflict.detected_at)} {formatTime(conflict.detected_at)}</span>
      </div>
      <p className="text-sm">{conflict.message}</p>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={resolve}>
        <Input aria-label="What was done" placeholder="What was done, e.g. counted and corrected" value={note} onChange={(e) => setNote(e.target.value)} maxLength={255} />
        <Button type="submit" variant="outline" disabled={busy || note.trim().length < 3}>Mark reviewed</Button>
      </form>
      {error && <p className="text-xs text-danger">{error}</p>}
    </li>
  );
}

function TerminalDialog({ terminal, onClose, onChanged }: { terminal: TerminalRow; onClose: () => void; onChanged: () => Promise<void> }) {
  const detail = useApiQuery(["terminal", terminal.id], async () => (await getApiClient()).get<TerminalDetail>(`/terminals/${terminal.id}`));
  const [sku, setSku] = useState<Sku | null>(null);
  const [quantity, setQuantity] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const allocate = async (event: FormEvent) => {
    event.preventDefault();
    if (!sku) return;
    setMessage(null);
    try {
      const api = await getApiClient();
      await api.ensureCsrfCookie();
      await api.post(`/terminals/${terminal.id}/allocations`, { sku_id: sku.id, quantity });
      setMessage(`${quantity} ${sku.base_unit.code} of ${sku.name} allocated to ${terminal.code}. It arrives at its next sync.`);
      setSku(null);
      setQuantity("");
      await detail.reload();
      await onChanged();
    } catch (caught) {
      setMessage(toApiError(caught).message);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{terminal.code} · {terminal.name}</DialogTitle>
          <DialogDescription>Stock it may sell offline, and the last operations it synced.</DialogDescription>
        </DialogHeader>
        {!detail.data ? (
          <Skeleton className="h-48" />
        ) : (
          <div className="grid gap-5">
            <section className="grid gap-2">
              <h3 className="font-medium">Stock allocation</h3>
              {detail.data.allocations.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing allocated. The terminal asks for its share at every sync.</p>
              ) : (
                <Table className="numeric">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Allocated</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Sold</TableHead>
                      <TableHead className="hidden text-right md:table-cell">Released</TableHead>
                      <TableHead className="text-right">Remaining</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.data.allocations.map((a) => (
                      <TableRow key={a.sku.id}>
                        <TableCell>{a.sku.name}</TableCell>
                        <TableCell className="hidden text-right sm:table-cell">{qty(a.allocated)}</TableCell>
                        <TableCell className="hidden text-right sm:table-cell">{qty(a.consumed)}</TableCell>
                        <TableCell className="hidden text-right md:table-cell">{qty(a.released)}</TableCell>
                        <TableCell className={`text-right font-medium ${parse(a.remaining) < BigInt(0) ? "text-danger" : ""}`}>{qty(a.remaining)} {a.sku.unit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <form className="grid gap-2 rounded-lg border p-3" onSubmit={allocate}>
                <Label>Allocate more stock to {terminal.code}</Label>
                <SkuPicker exclude={new Set()} onPick={setSku} />
                {sku && (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <span className="text-sm">{sku.name}</span>
                    <Input aria-label="Quantity to allocate" inputMode="decimal" placeholder={`Quantity (${sku.base_unit.code})`} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="sm:w-40" />
                    <Button type="submit" disabled={quantity.trim() === ""}>Allocate</Button>
                  </div>
                )}
                {message && <p className="text-sm">{message}</p>}
              </form>
            </section>
            <section className="grid gap-2">
              <h3 className="font-medium">Recent operations</h3>
              <ul className="grid gap-1 text-sm">
                {detail.data.operations.map((op) => (
                  <li key={op.id} className="flex flex-wrap justify-between gap-2">
                    <span>#{op.local_seq} {op.type}{op.error_message && <span className="block text-xs text-danger">{op.error_code}: {op.error_message}</span>}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {formatDate(op.occurred_at)} {formatTime(op.occurred_at)}
                      <StatusBadge tone={op.status === "applied" ? "success" : "danger"}>{op.status}</StatusBadge>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
