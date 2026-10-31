"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { changes, eventLabel, formatValue, SENSITIVE_EVENTS, subjectHref } from "../audit-events";
import type { AuditEntry } from "../types";

/** What an entry is about: a link to its page when there is one. */
export function AuditSubject({ subject }: { subject: AuditEntry["subject"] }) {
  if (!subject) return null;
  const href = subjectHref(subject.type, subject.id);
  const text = subject.label ?? subject.id.slice(0, 8);
  return href ? <Link href={href} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{text}</Link> : <span className="font-medium">{text}</span>;
}

/** The changed values (old → new) and where the action came from. */
export function AuditDetails({ entry }: { entry: AuditEntry }) {
  const rows = changes(entry).filter((row) => row.key !== "group");
  return (
    <div className="grid gap-3 text-sm">
      {rows.length > 0 ? (
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr><th className="py-1 pr-3 font-medium">Field</th><th className="py-1 pr-3 font-medium">Before</th><th className="py-1 font-medium">After</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t align-top">
                <td className="py-1 pr-3 text-muted-foreground">{row.label}</td>
                <td className="py-1 pr-3 break-words">{row.old === undefined ? "" : formatValue(row.old)}</td>
                <td className="py-1 break-words">{row.new === undefined ? "" : formatValue(row.new)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted-foreground">No values recorded.</p>
      )}
      <p className="text-xs break-words text-muted-foreground">
        {[entry.ip_address && `IP ${entry.ip_address}`, entry.device && `terminal ${entry.device.code}`, entry.request_id && `request ${entry.request_id}`, entry.user_agent]
          .filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

/** One entry as a row that opens to show its details. */
export function AuditRow({ entry, showSubject = true }: { entry: AuditEntry; showSubject?: boolean }) {
  const [open, setOpen] = useState(false);
  const group = typeof entry.new_values?.group === "string" ? entry.new_values.group : null;
  return (
    <li className="border-b last:border-b-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-start gap-3 px-5 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted">
        <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">{formatDate(entry.created_at)}<br />{formatTime(entry.created_at)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            {SENSITIVE_EVENTS.has(entry.event) ? <StatusBadge tone="warning">{eventLabel(entry.event)}</StatusBadge> : <span className="font-medium">{eventLabel(entry.event)}</span>}
            {group && <span className="text-xs text-muted-foreground">({group})</span>}
            {showSubject && entry.subject && <span className="text-sm">· <AuditSubject subject={entry.subject} /></span>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {entry.user ? entry.user.name : entry.device ? `Terminal ${entry.device.code}` : "System"}
            {entry.user && entry.device && ` at ${entry.device.code}`}
          </span>
        </span>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div className="px-5 pb-3 sm:pl-32"><AuditDetails entry={entry} /></div>}
    </li>
  );
}
