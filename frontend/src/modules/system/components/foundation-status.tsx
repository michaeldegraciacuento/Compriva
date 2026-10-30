"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { getPlatform } from "@/platform";

import { fetchHealth } from "../api";

type Check = { state: "pending" } | { state: "ok"; value: string } | { state: "error"; value: string };

interface Checks {
  platform: Check;
  device: Check;
  localDb: Check;
  api: Check;
}

const PENDING: Check = { state: "pending" };

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.code}: ${error.message}${error.requestId ? ` (request ${error.requestId})` : ""}`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function settle(run: () => Promise<string>): Promise<Check> {
  try {
    return { state: "ok", value: await run() };
  } catch (error) {
    return { state: "error", value: describeError(error) };
  }
}

/** Diagnostics for the Phase 1 foundation: platform, device identity, local SQLite and API reachability. */
export function FoundationStatus() {
  const [checks, setChecks] = useState<Checks>({
    platform: PENDING,
    device: PENDING,
    localDb: PENDING,
    api: PENDING,
  });

  useEffect(() => {
    let cancelled = false;
    const update = (key: keyof Checks, check: Check) => {
      if (!cancelled) setChecks((current) => ({ ...current, [key]: check }));
    };

    void (async () => {
      const platform = await getPlatform();
      update("platform", { state: "ok", value: `${platform.kind} (auth: ${platform.authMode})` });

      void settle(async () => {
        const identity = await platform.getDeviceIdentity();
        if (!identity) return "unknown";
        return platform.kind === "web"
          ? `${identity.installId} · browser terminal ID`
          : `${identity.installId} · ${identity.machineName ?? "unknown host"} · v${identity.appVersion}`;
      }).then((check) => update("device", check));

      void settle(async () => {
        const db = await platform.getLocalDatabase();
        if (!db) return "not applicable (web is online-only)";
        const [row] = await db.select<{ version: string; migrations: number }>(
          "SELECT sqlite_version() AS version, (SELECT COUNT(*) FROM _sqlx_migrations WHERE success = 1) AS migrations",
        );
        return `SQLite ${row.version} · ${row.migrations} migration(s) applied`;
      }).then((check) => update("localDb", check));

      void settle(async () => {
        const health = await fetchHealth();
        return `${health.status} · API ${health.api_version} · server ${health.server_time}`;
      }).then((check) => update("api", check));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const rows: { key: keyof Checks; label: string }[] = [
    { key: "platform", label: "Platform" },
    { key: "device", label: "Device identity" },
    { key: "localDb", label: "Local database" },
    { key: "api", label: `Cloud API (${env.NEXT_PUBLIC_API_URL})` },
  ];

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Checks</CardTitle>
        <CardDescription>Platform, terminal identity, local database and cloud API.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="divide-y">
          {rows.map(({ key, label }) => {
            const check = checks[key];
            return (
              <div
                key={key}
                data-testid={`check-${key}`}
                data-state={check.state}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <dt className="text-sm font-medium">{label}</dt>
                <dd className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground sm:max-w-[65%] sm:justify-end">
                  <span className="break-all">{check.state === "pending" ? "Checking…" : check.value}</span>
                  <Badge variant={check.state === "error" ? "destructive" : check.state === "ok" ? "secondary" : "outline"}>
                    {check.state}
                  </Badge>
                </dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}
