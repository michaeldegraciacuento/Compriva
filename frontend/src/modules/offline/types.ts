import type { CashierSnapshot } from "@/modules/auth/types";

import type { PaymentMethod, PosItem, PresetDiscount, ReceiptSettings, Terminal } from "../pos/types";

/** A sellable item as cached on the terminal: the POS item plus its barcodes. */
export interface CachedItem extends PosItem {
  barcodes: { barcode: string; unit_id: string | null }[];
}

export interface TerminalSettings {
  receipt: ReceiptSettings;
  store: { name: string; legal_name: string | null; tin: string | null; address: string | null; phone: string | null; is_vat_registered: boolean; timezone: string } | null;
  pos: { allow_over_allocation: boolean; max_offline_hours: number };
}

export interface Allocation {
  sku_id: string;
  remaining: string;
}

export interface Snapshot {
  terminal: Terminal;
  items: CachedItem[];
  categories: { id: string; name: string }[];
  payment_methods: PaymentMethod[];
  discounts: PresetDiscount[];
  cashiers: CashierSnapshot;
  settings: TerminalSettings;
  allocations: Allocation[];
}

export type Change =
  | { entity: "item"; op: "upsert"; id: string; data: CachedItem }
  | { entity: "item"; op: "delete"; id: string }
  | { entity: "categories"; op: "replace"; data: { id: string; name: string }[] }
  | { entity: "cashiers"; op: "replace"; data: CashierSnapshot }
  | { entity: "payment_methods"; op: "replace"; data: PaymentMethod[] }
  | { entity: "discounts"; op: "replace"; data: PresetDiscount[] }
  | { entity: "settings"; op: "replace"; data: TerminalSettings }
  | { entity: "allocation"; op: "upsert"; id: string; data: Allocation };

export type PullResponse =
  | { mode: "snapshot"; cursor: number; has_more: false; server_time: string; snapshot: Snapshot }
  | { mode: "changes"; cursor: number; has_more: boolean; server_time: string; changes: Change[]; open_conflicts: number };

export type OperationType = "shift.opened" | "shift.closed" | "cash.movement" | "sale.completed" | "sale.voided" | "allocation.release";

export interface OutboxOperation {
  operation_id: string;
  local_seq: number;
  type: OperationType;
  schema_version: number;
  created_at: string;
  payload: Record<string, unknown>;
}

export type OperationResult =
  | { operation_id: string; status: "applied" | "duplicate"; result: { conflicts?: { id: string; type: string; message: string }[] } & Record<string, unknown> }
  | { operation_id: string; status: "rejected" | "failed"; error: { code: string; message: string } };

export interface OutboxRow {
  operation_id: string;
  local_seq: number;
  type: OperationType;
  payload: string;
  schema_version: number;
  created_at: string;
  status: "pending" | "synced" | "rejected";
  attempts: number;
  last_error: string | null;
  result: string | null;
  synced_at: string | null;
}

export interface SyncLogRow {
  id: number;
  started_at: string;
  finished_at: string;
  outcome: "ok" | "partial" | "offline" | "failed";
  pushed: number;
  rejected: number;
  pulled: number;
  message: string | null;
}
