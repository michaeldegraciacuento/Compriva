import type { IsoDate, IsoDateTime, Money, Quantity, Uuid } from "@/types/common";

export type StockStatus = "ok" | "low" | "out";
export type DocumentType = "stock_in" | "stock_out" | "adjustment";
export type DocumentStatus = "draft" | "posted";
export type MovementType =
  | "stock_in" | "stock_out" | "adjustment" | "opening_balance"
  | "purchase_receipt" | "sale" | "sale_void" | "sale_return";

/** GET /inventory/stock */
export interface StockLevel {
  sku_id: Uuid;
  sku_code: string;
  name: string;
  product_id: Uuid;
  category: string | null;
  unit: string;
  is_active: boolean;
  quantity_on_hand: Quantity;
  quantity_allocated: Quantity;
  quantity_available: Quantity;
  reorder_level: Quantity;
  average_cost: Money;
  stock_value: Money;
  status: StockStatus;
  nearest_expiry: IsoDate | null;
  last_movement_at: IsoDateTime | null;
}

export interface StockSummary {
  skus: number;
  out_of_stock: number;
  low_stock: number;
  stock_value: Money;
}

export interface StockDocument {
  id: Uuid;
  number: string;
  type: DocumentType;
  reason: string;
  reason_label: string;
  status: DocumentStatus;
  reference: string | null;
  notes: string | null;
  created_by?: { id: Uuid; name: string };
  approved_by?: { id: Uuid; name: string } | null;
  lines_count?: number;
  lines?: {
    id: Uuid;
    sku: { id: Uuid; code: string; name: string };
    unit: { id: Uuid; code: string } | null;
    quantity: Quantity | null;
    conversion_factor: string;
    system_quantity: Quantity;
    counted_quantity: Quantity | null;
    quantity_change: Quantity;
    unit_cost: Money;
    batch: { id: Uuid; batch_number: string; expiry_date: IsoDate | null } | null;
    batch_number: string | null;
    expiry_date: IsoDate | null;
    notes: string | null;
  }[];
  posted_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

export interface StockMovement {
  id: Uuid;
  type: MovementType;
  quantity: Quantity;
  unit_cost: Money;
  sku: { id: Uuid; code: string; name: string };
  batch: { id: Uuid; batch_number: string } | null;
  reference: { type: string; id: Uuid; number: string | null } | null;
  created_by: { id: Uuid; name: string } | null;
  occurred_at: IsoDateTime;
}

export interface StockBatch {
  id: Uuid;
  batch_number: string;
  sku: { id: Uuid; code: string; name: string; unit: string | null };
  expiry_date: IsoDate | null;
  days_left: number | null;
  unit_cost: Money;
  initial_quantity: Quantity;
  remaining_quantity: Quantity;
  received_at: IsoDateTime;
}

/** One line of a stock document as submitted. */
export interface DocumentLineInput {
  product_sku_id: Uuid;
  unit_id?: Uuid | null;
  quantity?: Quantity;
  counted_quantity?: Quantity;
  unit_cost?: Money;
  batch_number?: string | null;
  expiry_date?: IsoDate | null;
  stock_batch_id?: Uuid | null;
  notes?: string | null;
}

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  stock_in: "Stock in",
  stock_out: "Stock out",
  adjustment: "Count adjustment",
  opening_balance: "Opening balance",
  purchase_receipt: "Purchase receipt",
  sale: "Sale",
  sale_void: "Sale void",
  sale_return: "Sale return",
};

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  stock_in: "Stock in",
  stock_out: "Stock out",
  adjustment: "Count",
};

/** Reasons per document type; must match StockDocumentType::reasons() on the server. */
export const REASONS: Record<DocumentType, { value: string; label: string }[]> = {
  stock_in: [
    { value: "received", label: "Received from supplier" },
    { value: "transfer_in", label: "Transfer in" },
    { value: "found", label: "Found stock" },
    { value: "opening_balance", label: "Opening balance" },
    { value: "other", label: "Other" },
  ],
  stock_out: [
    { value: "damage", label: "Damaged" },
    { value: "expiry", label: "Expired" },
    { value: "theft", label: "Theft / loss" },
    { value: "internal_use", label: "Internal use" },
    { value: "return_to_supplier", label: "Returned to supplier" },
    { value: "other", label: "Other" },
  ],
  adjustment: [
    { value: "count_correction", label: "Physical count" },
    { value: "opening_balance", label: "Opening balance" },
    { value: "other", label: "Other" },
  ],
};
