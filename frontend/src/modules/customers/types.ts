export type CustomerType = "regular" | "senior_citizen" | "pwd" | "business";

export const CUSTOMER_TYPES: { value: CustomerType; label: string }[] = [
  { value: "regular", label: "Regular" },
  { value: "senior_citizen", label: "Senior citizen" },
  { value: "pwd", label: "PWD" },
  { value: "business", label: "Business" },
];

export const customerTypeLabel = (type: CustomerType) => CUSTOMER_TYPES.find((t) => t.value === type)?.label ?? type;

export interface Customer {
  id: string;
  code: string | null;
  name: string;
  type: CustomerType;
  phone: string | null;
  email: string | null;
  address: string | null;
  tin: string | null;
  id_number: string | null;
  birth_date: string | null;
  notes: string | null;
  is_active: boolean;
  purchases_count: number | null;
  purchases_total: string | null;
  last_purchase_at: string | null;
  created_at: string | null;
}

export interface CustomerPurchase {
  id: string;
  receipt_number: string;
  status: "completed" | "voided";
  occurred_at: string;
  terminal: string | null;
  cashier: string | null;
  items_count: number | null;
  grand_total: string;
  /** Added to the sale afterwards, not chosen at checkout. */
  customer_added_later?: boolean;
}

export type CustomerInput = Partial<Pick<Customer, "name" | "type" | "phone" | "email" | "address" | "tin" | "id_number" | "birth_date" | "notes" | "is_active">>;
