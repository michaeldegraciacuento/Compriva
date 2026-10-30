export interface Supplier {
  id: string;
  code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tin: string | null;
  payment_terms_days: number;
  notes: string | null;
  is_active: boolean;
  open_orders_count: number | null;
  purchased_total: string | null;
  last_received_at: string | null;
}

export type OrderStatus = "draft" | "ordered" | "partially_received" | "received" | "cancelled";

export interface OrderItem {
  id: string;
  sku: { id: string; code: string; name: string; tracks: { batches: boolean; expiry: boolean } };
  unit: { id: string; code: string; name: string; allows_decimal: boolean };
  conversion_factor: string;
  quantity_ordered: string;
  quantity_received: string;
  quantity_remaining: string;
  unit_cost: string;
  line_total: string;
}

export interface GoodsReceipt {
  id: string;
  number: string;
  status: "draft" | "posted";
  supplier: { id: string; name: string } | null;
  purchase_order: { id: string; number: string } | null;
  supplier_reference: string | null;
  total_cost: string;
  notes: string | null;
  received_at: string;
  received_by: string | null;
  items?: {
    id: string;
    sku: { id: string; code: string; name: string };
    unit: { id: string; code: string; name: string };
    quantity: string;
    base_quantity: string;
    unit_cost: string;
    line_total: string;
    batch_number: string | null;
    expiry_date: string | null;
  }[];
}

export interface PurchaseOrder {
  id: string;
  number: string;
  status: OrderStatus;
  supplier: { id: string; code: string; name: string } | null;
  order_date: string;
  expected_date: string | null;
  total: string;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  ordered_at: string | null;
  cancelled_at: string | null;
  items_count: number | null;
  created_at: string;
  items?: OrderItem[];
  receipts?: GoodsReceipt[];
}

export interface CostHistory {
  sku: { id: string; code: string; name: string; base_unit: string };
  last_cost: string;
  average_cost: string | null;
  history: {
    receipt_id: string;
    receipt_number: string;
    received_at: string;
    supplier: string;
    quantity: string;
    unit: string;
    unit_cost: string;
    ordered_unit_cost: string | null;
    cost_per_base_unit: string;
  }[];
}

export interface OrderInput {
  supplier_id: string;
  order_date?: string | null;
  expected_date?: string | null;
  notes?: string | null;
  items: { sku_id: string; unit_id: string; quantity: string; unit_cost: string }[];
}

export interface ReceiveInput {
  supplier_reference?: string | null;
  notes?: string | null;
  lines: { purchase_order_item_id: string; quantity: string; unit_cost?: string | null; batch_number?: string | null; expiry_date?: string | null }[];
}
