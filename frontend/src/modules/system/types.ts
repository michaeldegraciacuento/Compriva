import type { IsoDateTime } from "@/types/common";

/** GET /api/v1/health */
export interface HealthStatus {
  status: "ok" | "degraded";
  api_version: string;
  server_time: IsoDateTime;
  timezone: string;
  currency: string;
  checks: { database: "ok" | "unavailable" };
}

/** GET /settings: store details and store-wide settings. */
export interface StoreSettings {
  store: { name: string; legal_name: string | null; tin: string | null; address: string | null; phone: string | null; email: string | null; is_vat_registered: boolean; timezone: string; currency: string };
  settings: {
    receipt: { header_lines: string[]; footer_text: string | null; show_vat_breakdown: boolean };
    pos: { allow_over_allocation: boolean; allocation_share_percent: number; max_cash_in_drawer: string };
    sync: { max_offline_hours: number };
    inventory: { expiry_warning_days: number };
  };
  updated: Partial<Record<"receipt" | "pos" | "sync" | "inventory", { at: string | null; by: string | null }>>;
  fixed: { costing_method: string; prices_include_vat: boolean };
}

export type SettingsGroup = keyof StoreSettings["settings"];

/** One audit log entry. */
export interface AuditEntry {
  id: string;
  event: string;
  user: { id: string; name: string; username: string } | null;
  device: { id: string; code: string; name: string } | null;
  subject: { type: string; id: string; label: string | null } | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
}

export interface AuditFilters {
  q?: string;
  event?: string;
  category?: string;
  user_id?: string;
  device_id?: string;
  subject_type?: string;
  subject_id?: string;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
}

export interface AuditFilterOptions {
  events: { event: string; count: number }[];
  users: { id: string; name: string; username: string }[];
  devices: { id: string; code: string; name: string }[];
}
