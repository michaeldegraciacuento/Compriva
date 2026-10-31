"use client";

import { ClipboardList, Download, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { NativeSelect } from "@/components/native-select";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Panel } from "@/components/panel";
import { SearchInput } from "@/components/search-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toApiError } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";

import { downloadAuditLog, fetchAuditFilters, fetchAuditLog } from "../api";
import { CATEGORIES, eventLabel } from "../audit-events";
import type { AuditFilters } from "../types";
import { AuditRow } from "./audit-entry";

/** The audit log: every sign-in, sale, void, price, stock, user and setting change. Read-only. */
export function AuditPage() {
  // A record's History panel links here with ?subject_type=&subject_id=.
  const params = useSearchParams();
  const [filters, setFilters] = useState<AuditFilters>({ page: 1, subject_type: params.get("subject_type") ?? undefined, subject_id: params.get("subject_id") ?? undefined });
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const entries = useApiQuery(["audit", filters], () => fetchAuditLog(filters));
  const options = useApiQuery(["audit-filters"], fetchAuditFilters);
  const update = (patch: AuditFilters) => setFilters({ ...filters, ...patch, page: 1 });
  const events = (options.data?.events ?? []).filter((e) => !filters.category || e.event.startsWith(`${filters.category}.`));

  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadAuditLog(filters);
    } catch (caught) {
      setError(toApiError(caught).message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Audit log"
        description="Who did what, when and from where. Entries can never be changed or deleted."
        actions={<Button variant="outline" onClick={() => void download()} disabled={downloading}><Download aria-hidden /> {downloading ? "Preparing…" : "Download CSV"}</Button>}
      />
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {filters.subject_id && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Showing the history of one {filters.subject_type?.replace(/_/g, " ")}.
            <Button size="sm" variant="ghost" onClick={() => update({ subject_type: undefined, subject_id: undefined })}><X aria-hidden /> Show everything</Button>
          </AlertDescription>
        </Alert>
      )}

      <Panel title="Entries" description={entries.data ? `${(entries.data.meta?.total ?? 0).toLocaleString()} matching` : undefined} flush>
        <div className="grid gap-2 px-5 pb-4 sm:grid-cols-2 lg:grid-cols-3">
          <SearchInput label="Search the audit log" placeholder="Person, event, IP or request ID" value={filters.q ?? ""} onChange={(q) => update({ q: q || undefined })} />
          <NativeSelect aria-label="Area" value={filters.category ?? ""} onChange={(e) => update({ category: e.target.value || undefined, event: undefined })}>
            <option value="">All areas</option>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Event" value={filters.event ?? ""} onChange={(e) => update({ event: e.target.value || undefined })}>
            <option value="">All events</option>
            {events.map((e) => <option key={e.event} value={e.event}>{eventLabel(e.event)} ({e.count})</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Person" value={filters.user_id ?? ""} onChange={(e) => update({ user_id: e.target.value || undefined })}>
            <option value="">Everyone</option>
            {options.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
          <NativeSelect aria-label="Terminal" value={filters.device_id ?? ""} onChange={(e) => update({ device_id: e.target.value || undefined })}>
            <option value="">All terminals and browsers</option>
            {options.data?.devices.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
          </NativeSelect>
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From" value={filters.from ?? ""} onChange={(e) => update({ from: e.target.value || undefined })} />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" aria-label="To" value={filters.to ?? ""} min={filters.from} onChange={(e) => update({ to: e.target.value || undefined })} />
          </div>
        </div>
        {entries.error ? (
          <Alert variant="destructive" className="mx-5 mb-4 w-auto"><AlertDescription>{entries.error.message}</AlertDescription></Alert>
        ) : entries.loading ? (
          <div className="grid gap-3 px-5 pb-4" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : entries.data?.data.length === 0 ? (
          <EmptyState icon={ClipboardList} title="No entries match">Try a wider date range or fewer filters.</EmptyState>
        ) : (
          <ul aria-label="Audit entries" className="border-t">
            {entries.data?.data.map((entry) => <AuditRow key={entry.id} entry={entry} />)}
          </ul>
        )}
        <Pagination meta={entries.data?.meta} onPage={(page) => setFilters({ ...filters, page })} />
      </Panel>
    </div>
  );
}
