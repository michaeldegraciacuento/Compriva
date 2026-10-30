"use client";

import { PageHeader } from "@/components/page-header";
import { RequirePermission } from "@/modules/auth/components/auth-guard";

import { FoundationStatus } from "./foundation-status";

/** Platform, device, local database and API diagnostics (settings.manage). */
export function SystemStatusPage() {
  return (
    <div className="grid gap-6">
      <PageHeader title="System status" description="Connectivity and platform checks for this computer." />
      <RequirePermission
        permission="settings.manage"
        fallback={<p className="text-sm text-muted-foreground">You do not have access to system status.</p>}
      >
        <FoundationStatus />
      </RequirePermission>
    </div>
  );
}
