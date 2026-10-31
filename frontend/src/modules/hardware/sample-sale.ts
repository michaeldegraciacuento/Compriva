import type { Sale } from "@/modules/pos/types";

/** A typical receipt for previews (Hardware and Settings pages); never sent anywhere. */
export const SAMPLE_SALE: Sale = {
  id: "sample", receipt_number: "T01-000123", status: "completed", terminal: { id: "t", code: "T01", name: "Lane 1" }, cashier: { id: "u", name: "Juan Dela Cruz" },
  cashier_shift_id: "s", occurred_at: new Date().toISOString(), business_date: "", customer_name: null, customer_id_number: null,
  gross_amount: "157.50", discount_total: "0.00", vat_exemption: "0.00", vatable_sales: "92.41", vat_amount: "11.09", vat_exempt_sales: "54.00", zero_rated_sales: "0.00",
  grand_total: "157.50", amount_paid: "200.00", change_due: "42.50",
  items: [
    { id: "1", line_number: 1, sku_id: "a", product_name: "Lucky Me! Pancit Canton Original 80g", sku_code: "SKU-0003", barcode: null, unit_name: "Piece", quantity: "3", regular_unit_price: "16.00", unit_price: "16.00", price_overridden: false, gross_amount: "48.00", discount_amount: "0.00", tax_code: "VAT12", tax_type: "vat", tax_amount: "5.14", line_total: "48.00", returned_quantity: "0" },
    { id: "2", line_number: 2, sku_id: "b", product_name: "Century Tuna Flakes in Oil 155g", sku_code: "SKU-0004", barcode: null, unit_name: "Piece", quantity: "1", regular_unit_price: "55.50", unit_price: "55.50", price_overridden: false, gross_amount: "55.50", discount_amount: "0.00", tax_code: "VAT12", tax_type: "vat", tax_amount: "5.95", line_total: "55.50", returned_quantity: "0" },
    { id: "3", line_number: 3, sku_id: "c", product_name: "Fresh Eggs Large", sku_code: "SKU-0008", barcode: null, unit_name: "Piece", quantity: "6", regular_unit_price: "9.00", unit_price: "9.00", price_overridden: false, gross_amount: "54.00", discount_amount: "0.00", tax_code: "VAT_EXEMPT", tax_type: "vat_exempt", tax_amount: "0.00", line_total: "54.00", returned_quantity: "0" },
  ],
  discounts: [],
  payments: [{ id: "p", method: "cash", amount: "157.50", tendered_amount: "200.00", change_amount: "42.50", reference_number: null }],
  void: null,
  store: { name: "Compriva Grocery", legal_name: null, tin: "123-456-789-000", address: "Malolos, Bulacan", phone: null, is_vat_registered: true },
  receipt: { header_lines: [], footer_text: "Thank you for shopping!", show_vat_breakdown: true, paper_size: "80mm" },
  notes: null,
};
