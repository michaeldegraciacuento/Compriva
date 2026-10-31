"use client";

import { Panel } from "@/components/panel";
import { LinkButton } from "@/components/link-button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/lib/use-api-query";
import { useCan } from "@/modules/auth/hooks";

import { fetchAuditLog } from "../api";
import { AuditRow } from "./audit-entry";

/**
 * The audit history of one record (a user, customer or sale), on its own page.
 * Shown only to people with audit.view. `version` reloads it after a change.
 */
export function AuditTrail({ type, id, version = 0 }: { type: string; id: string; version?: unknown }) {
  const allowed = useCan("audit.view");
  const entries = useApiQuery(["audit-trail", type, id, version, allowed], () =>
    allowed ? fetchAuditLog({ subject_type: type, subject_id: id, per_page: 10 }) : Promise.resolve(null));
  if (!allowed) return null;

  return (
    <Panel
      title="History"
      description="From the audit log, newest first."
      action={entries.data && (entries.data.meta?.total ?? 0) > 10 ? <LinkButton href={`/audit?subject_type=${type}&subject_id=${id}`} size="sm" variant="ghost">All {(entries.data.meta?.total ?? 0)}</LinkButton> : undefined}
      flush
    >
      {entries.loading ? (
        <div className="px-5 pb-4"><Skeleton className="h-10" /></div>
      ) : entries.error ? (
        <p className="px-5 pb-4 text-sm text-danger">{entries.error.message}</p>
      ) : entries.data?.data.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul className="border-t" aria-label="History">
          {entries.data?.data.map((entry) => <AuditRow key={entry.id} entry={entry} showSubject={false} />)}
        </ul>
      )}
    </Panel>
  );
}
