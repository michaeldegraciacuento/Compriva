"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, CloudOff, RefreshCw, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { getOfflineRuntime, useSyncStatus } from "../runtime";

/**
 * Header indicator on desktop terminals: synced / syncing / waiting / offline /
 * rejected operations, linking to the Sync page. Mounting it starts the
 * terminal's background sync. Renders nothing in the web app.
 */
export function SyncIndicator() {
  const status = useSyncStatus((s) => s.status);
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    let active = true;
    void getOfflineRuntime().then((runtime) => {
      if (active) setDesktop(runtime !== null);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!desktop || !status) return null;

  const { icon: Icon, label, tone } =
    status.rejected > 0
      ? { icon: AlertTriangle, label: `${status.rejected} rejected`, tone: "text-danger" }
      : status.state === "syncing"
        ? { icon: RefreshCw, label: "Syncing…", tone: "text-info" }
        : status.state === "offline"
          ? { icon: CloudOff, label: status.pending > 0 ? `Offline · ${status.pending} waiting` : "Offline", tone: "text-warning" }
          : status.state === "error"
            ? { icon: AlertTriangle, label: "Sync failed", tone: "text-danger" }
            : status.pending > 0
              ? { icon: RefreshCw, label: `${status.pending} waiting`, tone: "text-warning" }
              : { icon: CheckCircle2, label: status.lastSuccessAt ? `Synced ${formatDistanceToNowStrict(new Date(status.lastSuccessAt))} ago` : "Not synced yet", tone: "text-success" };

  return (
    <Link
      href="/sync"
      className={cn("flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50", tone)}
      aria-label={`Sync status: ${label}`}
      data-testid="sync-indicator"
    >
      <Icon className={cn("size-4", status.state === "syncing" && "animate-spin motion-reduce:animate-none")} aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
