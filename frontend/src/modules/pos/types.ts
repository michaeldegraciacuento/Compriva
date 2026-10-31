import type { CartTotals, DiscountType, LineAmounts, TaxType } from "./calculator";

export interface Terminal {
  id: string;
  code: string;
  name: string;
  status: "pending" | "active" | "revoked";
  /** Sync snapshot only: the last receipt number the server has from this terminal. */
  last_receipt_sequence?: number;
}

export interface ShiftSummary {
  sales_count: number;
  voided_count: number;
  sales_total: string;
  payments: Record<string, { count: number; total: string }>;
  refunds: Record<string, string>;
  refunds_total: string;
  opening_float: string;
  cash_sales: string;
  cash_refunds: string;
  cash_in: string;
  cash_out: string;
  expected_cash: string;
}

export type CashMovementType = "cash_in" | "cash_out" | "cash_drop";

export interface CashMovement {
  id: string;
  type: CashMovementType;
  amount: string;
  reason: string;
  performed_by: string | null;
  occurred_at: string;
}

export interface Shift {
  id: string;
  status: "open" | "closed";
  terminal: Terminal;
  cashier: { id: string; name: string };
  opening_float: string;
  expected_cash: string | null;
  counted_cash: string | null;
  cash_variance: string | null;
  opened_at: string;
  closed_at: string | null;
  closed_by: string | null;
  notes: string | null;
  cash_movements: CashMovement[];
  summary: ShiftSummary | null;
  /** Shift history only. */
  sales_count?: number;
  sales_total?: string;
}

export interface PaymentMethod {
  id: string;
  code: "cash" | "gcash" | "maya" | string;
  name: string;
  type: string;
  requires_reference: boolean;
  allows_change: boolean;
  is_active: boolean;
  account_name: string | null;
  account_number: string | null;
  qr_url: string | null;
}

export interface PresetDiscount {
  id: string;
  code: string | null;
  name: string;
  kind: string;
  type: DiscountType;
  value: string;
  is_vat_exempt: boolean;
  requires_customer_id: boolean;
  requires_approval: boolean;
  max_amount: string | null;
  min_purchase: string | null;
}

/** A customer as the POS picker sees it (also cached on desktop terminals). */
export interface PosCustomer {
  id: string;
  code: string | null;
  name: string;
  type: "regular" | "senior_citizen" | "pwd" | "business";
  phone: string | null;
  tin: string | null;
  address: string | null;
  id_number: string | null;
}

export interface ReceiptSettings {
  header_lines: string[];
  footer_text: string | null;
  show_vat_breakdown: boolean;
  paper_size: string;
}

export interface PosBootstrap {
  install_id: string | null;
  terminal: Terminal | null;
  can_register: boolean;
  shift: Shift | null;
  payment_methods: PaymentMethod[];
  discounts: PresetDiscount[];
  categories: { id: string; name: string }[];
  receipt: ReceiptSettings;
  /** Missing from servers before this setting existed. */
  pos?: { max_cash_in_drawer: string };
}

export interface SellUnit {
  unit: { id: string; code: string; name: string; allows_decimal: boolean };
  factor: string;
  price: string;
}

/** A sellable SKU as the POS sees it (GET /pos/catalog). */
export interface PosItem {
  id: string;
  product_id: string;
  name: string;
  code: string;
  category_id: string | null;
  image_url: string | null;
  base_unit_id: string;
  units: SellUnit[];
  matched_unit_id: string | null;
  tax: { id: string; code: string; type: TaxType; rate: string; inclusive: boolean };
  stock: { tracked: boolean; on_hand: string; available: string };
}

export interface ItemDiscount {
  type: DiscountType;
  value: string;
}

export interface CartLine {
  key: string;
  item: PosItem;
  unitId: string;
  quantity: string;
  barcode: string | null;
  /** Manager-approved price; null = price list. */
  priceOverride: string | null;
  discount: ItemDiscount | null;
}

/** The sale-level discount: a preset (e.g. Senior Citizen) or a manual one. */
export type SaleDiscount =
  | { kind: "preset"; preset: PresetDiscount; customerIdNumber: string | null }
  | { kind: "manual"; type: DiscountType; value: string };

export interface PricedCart {
  lines: (CartLine & { unit: SellUnit; unitPrice: string; amounts: LineAmounts })[];
  totals: CartTotals;
  /** Permissions the cart needs (discounts, price changes). */
  permissions: string[];
}

export interface Approval {
  login: string;
  secret: string;
}

export interface SaleItem {
  id: string;
  line_number: number;
  sku_id: string;
  product_name: string;
  sku_code: string;
  barcode: string | null;
  unit_name: string;
  quantity: string;
  regular_unit_price: string;
  unit_price: string;
  price_overridden: boolean;
  gross_amount: string;
  discount_amount: string;
  tax_code: string;
  tax_type: TaxType;
  tax_amount: string;
  line_total: string;
  returned_quantity: string | null;
}

export interface Sale {
  id: string;
  receipt_number: string;
  status: "completed" | "voided";
  terminal?: { id: string; code: string; name: string };
  cashier?: { id: string; name: string };
  cashier_shift_id: string;
  occurred_at: string;
  business_date: string;
  customer_id?: string | null;
  customer_name: string | null;
  customer_tin?: string | null;
  customer_address?: string | null;
  /** A customer added after the sale (not on the printed receipt). */
  customer_added?: { customer_id: string; customer_name: string | null; added_by: string | null; added_at: string; reason: string | null } | null;
  customer_id_number: string | null;
  gross_amount: string;
  discount_total: string;
  vat_exemption?: string;
  vatable_sales: string;
  vat_amount: string;
  vat_exempt_sales: string;
  zero_rated_sales: string;
  grand_total: string;
  amount_paid: string;
  change_due: string;
  items_count?: number;
  items?: SaleItem[];
  discounts?: { id: string; sale_item_id: string | null; name: string; kind: string; type: DiscountType; value: string; amount: string; customer_id_number: string | null }[];
  payments?: { id: string; method: string; amount: string; tendered_amount: string; change_amount: string; reference_number: string | null }[];
  returns?: { id: string; return_number: string; total_refund: string; reason: string; occurred_at: string; processed_by: string | null; refunds: { method: string; amount: string }[] }[];
  void: { voided_at: string; voided_by: string | null; reason: string } | null;
  store?: { name: string; legal_name: string | null; tin: string | null; address: string | null; phone: string | null; is_vat_registered: boolean };
  receipt?: ReceiptSettings;
  notes: string | null;
}

export interface SaleReturn {
  id: string;
  return_number: string;
  sale_id: string;
  receipt_number: string;
  reason: string;
  total_refund: string;
  vat_amount: string;
  occurred_at: string;
  processed_by: string | null;
  items: { id: string; sale_item_id: string; product_name: string; unit_name: string; quantity: string; refund_amount: string; condition: string; restock: boolean }[];
  refunds: { method: string; amount: string; reference_number: string | null }[];
}

export interface PaymentInput {
  method: string;
  amount: string;
  reference?: string | null;
}
