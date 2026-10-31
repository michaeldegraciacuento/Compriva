import { getApiClient } from "@/lib/api";
import type { Paginated, PaginationMeta } from "@/types/api";

import type { AuditEntry, AuditFilterOptions, AuditFilters, HealthStatus, SettingsGroup, StoreSettings } from "./types";

export async function fetchHealth(): Promise<HealthStatus> {
  const api = await getApiClient();
  return api.get<HealthStatus>("/health", { timeout: 5_000 });
}

async function writer() {
  const api = await getApiClient();
  await api.ensureCsrfCookie();
  return api;
}

export const fetchSettings = async () => (await getApiClient()).get<StoreSettings>("/settings");
export const updateSettings = async <G extends SettingsGroup>(group: G, values: Partial<StoreSettings["settings"][G]>) =>
  (await writer()).put<StoreSettings>(`/settings/${group}`, values);
export const updateStore = async (values: Partial<Omit<StoreSettings["store"], "timezone" | "currency">>) => (await writer()).patch<StoreSettings>("/settings/store", values);

export async function fetchAuditLog(filters: AuditFilters): Promise<Paginated<AuditEntry>> {
  return (await getApiClient()).request<AuditEntry[], PaginationMeta>("GET", "/audit-logs", undefined, { params: filters });
}

export const fetchAuditFilters = async () => (await getApiClient()).get<AuditFilterOptions>("/audit-logs/filters");

/** Downloads the filtered audit log as CSV (at most 10,000 entries); the download is itself audited. */
export async function downloadAuditLog(filters: AuditFilters): Promise<void> {
  const params = { ...filters, page: undefined, per_page: undefined, format: "csv" };
  const { blob, filename } = await (await getApiClient()).download("/audit-logs", { params });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename ?? "audit-log.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
