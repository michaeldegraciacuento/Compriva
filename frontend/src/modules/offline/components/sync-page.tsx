"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatTime } from "@/lib/format";
import { useApiQuery } from "@/lib/use-api-query";
import { useCan } from "@/modules/auth/hooks";
import { formatUnits, parse } from "@/modules/pos/fixed-point";
import { notify } from "@/lib/notify";

import { recentOperations } from "../outbox";
import { getOfflineRuntime, useSyncStatus } from "../runtime";
import type { OutboxRow, SyncLogRow } from "../types";

const TYPE_LABELS: Record<string, string> = {
  "shift.opened": "Shift opened",
  "shift.closed": "Shift closed",
  "cash.movement": "Cash in/out",
  "sale.completed": "Sale",
  "sale.voided": "Void",
  "allocation.release": "Stock released",
};

const OUTCOME: Record<SyncLogRow["outcome"], { label: string; tone: Tone }> = {
  ok: { label: "Synced", tone: "success" },
  partial: { label: "Some rejected", tone: "warning" },
  offline: { label: "Offline", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
};

function describe(row: OutboxRow): string {
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  if (row.type === "sale.completed") return `${payload.receipt_number} · ₱${(payload.totals as { grand_total: string }).grand_total}`;
  if (row.type === "cash.movement") return `${payload.type} ₱${payload.amount} · ${payload.reason}`;
  return TYPE_LABELS[row.type] ?? row.type;
}

/**
 * This terminal's synchronization: what is waiting to be sent, what the
 * server rejected (kept for review, never deleted), its stock allocation and
 * the history of sync runs. Desktop terminals only.
 */
export function SyncPage() {
  const status = useSyncStatus((s) => s.status);
  const canManage = useCan("inventory.allocate");
  const [busy, setBusy] = useState(false);
  const data = useApiQuery(["sync-page", status?.pending, status?.rejected, status?.lastSuccessAt], async () => {
    const runtime = await getOfflineRuntime();
    if (!runtime) return null;
    const { db, pos } = runtime;
    const allocations = await db.select<{ sku_id: string; remaining: string; name: string | null; unit: string | null }>(
      `SELECT a.sku_id, a.remaining, i.name, json_extract(i.data, '$.units[0].unit.code') AS unit
       FROM stock_allocations a LEFT JOIN catalog_items i ON i.sku_id = a.sku_id ORDER BY i.name`);
    return {
      pending: await recentOperations(db, "pending", 200),
      rejected: await recentOperations(db, "rejected", 200),
      log: await db.select<SyncLogRow>("SELECT * FROM sync_log ORDER BY id DESC LIMIT 50"),
      allocations: await Promise.all(allocations.map(async (a) => ({ ...a, available: await pos.available(a.sku_id) }))),
    };
  });

  const syncNow = async () => {
    setBusy(true);
    try {
      const report = await (await getOfflineRuntime())?.engine.syncNow();
      if (report?.outcome === "ok") notify.success("Synced", report.pushed > 0 ? `${report.pushed} change${report.pushed === 1 ? "" : "s"} sent to the server.` : "Everything is up to date.");
      else if (report?.outcome === "offline") notify.warning("Still offline", "Sales stay on this terminal until the connection is back.");
      else if (report) notify.error("Sync finished with problems", report.message ?? undefined);
      await data.reload();
    } finally {
      setBusy(false);
    }
  };

  if (data.data === null) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Sync" description="Synchronization applies to desktop checkout terminals." />
        <EmptyState icon={RefreshCw} title="This is the web app">
          It is always online. {canManage && <LinkButton variant="link" href="/terminals">See the terminals and their sync status</LinkButton>}
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Sync"
        description="Sales and shifts are saved on this terminal first and sent to the server in the background. Nothing is deleted until the server has it."
        actions={<Button onClick={() => void syncNow()} disabled={busy}><RefreshCw className={busy ? "animate-spin motion-reduce:animate-none" : ""} aria-hidden /> {busy ? "Syncing…" : "Sync now"}</Button>}
      />

      {status && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Status", status.state === "idle" ? "Up to date" : status.state === "syncing" ? "Syncing" : status.state === "offline" ? "Offline" : "Error"],
            ["Waiting to send", String(status.pending)],
            ["Rejected", String(status.rejected)],
            ["Last successful sync", status.lastSuccessAt ? `${formatDate(status.lastSuccessAt)} ${formatTime(status.lastSuccessAt)}` : "Never"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}
      {status?.lastError && (
        <Alert variant={status.state === "offline" ? "default" : "destructive"}>
          <AlertDescription>
            {status.lastError}
            {status.nextAttemptAt && ` Next try at ${formatTime(status.nextAttemptAt)}.`}
          </AlertDescription>
        </Alert>
      )}

      {!data.data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {data.data.rejected.length > 0 && (
            <Panel title="Rejected by the server" description="Kept on this terminal for review. A manager can see the same on the Terminals page." flush>
              <OperationTable rows={data.data.rejected} showError />
            </Panel>
          )}
          <Panel title="Waiting to send" flush>
            {data.data.pending.length === 0 ? <EmptyState icon={RefreshCw} title="Everything is sent" /> : <OperationTable rows={data.data.pending} showError />}
          </Panel>
          <Panel title="Stock this terminal may sell" description="Its allocation from the server, minus sales not yet synced. Selling more needs a sync." flush>
            {data.data.allocations.length === 0 ? (
              <EmptyState icon={RefreshCw} title="No stock allocated yet" />
            ) : (
              <Table className="numeric">
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Product</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Allocated (server)</TableHead>
                    <TableHead className="pr-5 text-right">Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.allocations.map((a) => (
                    <TableRow key={a.sku_id}>
                      <TableCell className="pl-5">{a.name ?? a.sku_id}</TableCell>
                      <TableCell className="hidden text-right sm:table-cell">{formatUnits(parse(a.remaining))} {a.unit}</TableCell>
                      <TableCell className="pr-5 text-right font-medium">{formatUnits(a.available)} {a.unit}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Panel>
          <Panel title="Sync history" flush>
            <Table className="numeric">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">When</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Sent</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Received</TableHead>
                  <TableHead className="hidden pr-5 md:table-cell">Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.log.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-5 whitespace-nowrap">{formatDate(row.started_at)} {formatTime(row.started_at)}</TableCell>
                    <TableCell><StatusBadge tone={OUTCOME[row.outcome].tone}>{OUTCOME[row.outcome].label}</StatusBadge></TableCell>
                    <TableCell className="hidden text-right sm:table-cell">{row.pushed}{row.rejected > 0 && ` (${row.rejected} rejected)`}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">{row.pulled}</TableCell>
                    <TableCell className="hidden pr-5 text-muted-foreground md:table-cell">{row.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        </>
      )}
    </div>
  );
}

function OperationTable({ rows, showError }: { rows: OutboxRow[]; showError: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-5">#</TableHead>
          <TableHead>Operation</TableHead>
          <TableHead className="hidden md:table-cell">Saved</TableHead>
          {showError && <TableHead className="pr-5">Last error</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.operation_id}>
            <TableCell className="pl-5 text-muted-foreground">{row.local_seq}</TableCell>
            <TableCell>
              <span className="font-medium">{TYPE_LABELS[row.type] ?? row.type}</span>
              <span className="block text-xs text-muted-foreground">{describe(row)}</span>
            </TableCell>
            <TableCell className="hidden whitespace-nowrap md:table-cell">{formatTime(row.created_at)} · {Number(row.attempts)} tries</TableCell>
            {showError && <TableCell className="pr-5 text-xs text-danger">{row.last_error ?? "—"}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
