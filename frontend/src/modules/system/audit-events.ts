/**
 * Readable names for audit log events (docs/README.md). Events not
 * listed here are shown from their code ("product_image.added" → "Product image added").
 */
const EVENTS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Sign-in failed",
  "auth.login_blocked": "Sign-in blocked (too many attempts)",
  "auth.logout": "Signed out",
  "auth.profile_updated": "Own profile changed",
  "auth.terminal_login": "Signed in at a terminal",
  "auth.terminal_login_failed": "Terminal sign-in failed",
  "auth.token_revoked": "Signed out a device",
  "auth.password_changed": "Own password changed",
  "auth.pin_changed": "Own PIN changed",
  "approval.granted": "Manager approval given",
  "approval.denied": "Manager approval refused",
  "user.created": "User added",
  "user.updated": "User details changed",
  "user.roles_changed": "User roles changed",
  "user.suspended": "User suspended",
  "user.activated": "User activated",
  "user.password_reset": "Password reset by an admin",
  "user.pin_reset": "PIN reset by an admin",
  "user.access_revoked": "User signed out everywhere",
  "role.created": "Role created",
  "role.updated": "Role renamed",
  "role.permissions_changed": "Role permissions changed",
  "role.deleted": "Role deleted",
  "sale.completed": "Sale",
  "sale.voided": "Sale voided",
  "sale.returned": "Items returned",
  "sale.reprinted": "Receipt reprinted",
  "sale.customer_added": "Customer added to a sale",
  "shift.opened": "Shift opened",
  "shift.closed": "Shift closed",
  "cash.cash_in": "Cash in",
  "cash.cash_out": "Cash out",
  "cash.cash_drop": "Cash drop",
  "cash_drawer.opened": "Drawer opened without a sale",
  "customer.created": "Customer added",
  "customer.updated": "Customer changed",
  "product.created": "Product added",
  "product.updated": "Product changed",
  "product_price.set": "Price changed",
  "stock_document.created": "Stock document created",
  "stock_document.posted": "Stock document posted",
  "stock_document.rejected": "Stock document rejected",
  "goods_receipt.posted": "Goods received",
  "purchase_order.created": "Purchase order created",
  "purchase_order.ordered": "Purchase order approved",
  "purchase_order.cancelled": "Purchase order cancelled",
  "settings.updated": "Settings changed",
  "store.updated": "Store details changed",
  "payment_method.updated": "Payment method changed",
  "payment_method.qr_uploaded": "QR code uploaded",
  "payment_method.qr_removed": "QR code removed",
  "device.registered_as_terminal": "Terminal registered",
  "device.revoked": "Terminal revoked",
  "device.sync_token_issued": "Terminal sync started",
  "allocation.manual": "Stock allocated to a terminal",
  "sync.conflict_resolved": "Sync conflict resolved",
  "sync.operation_rejected": "Offline operation rejected",
  "report.exported": "Report downloaded",
  "audit.exported": "Audit log downloaded",
};

/** Filter groups: the part of the event code before the dot. */
export const CATEGORIES: { value: string; label: string }[] = [
  { value: "auth", label: "Sign-in" },
  { value: "approval", label: "Approvals" },
  { value: "sale", label: "Sales" },
  { value: "shift", label: "Shifts" },
  { value: "cash", label: "Cash in / out" },
  { value: "cash_drawer", label: "Cash drawer" },
  { value: "customer", label: "Customers" },
  { value: "product", label: "Products" },
  { value: "product_price", label: "Prices" },
  { value: "stock_document", label: "Stock documents" },
  { value: "purchase_order", label: "Purchase orders" },
  { value: "goods_receipt", label: "Receiving" },
  { value: "user", label: "Users" },
  { value: "role", label: "Roles" },
  { value: "settings", label: "Settings" },
  { value: "store", label: "Store details" },
  { value: "payment_method", label: "Payment methods" },
  { value: "device", label: "Terminals" },
  { value: "sync", label: "Sync" },
  { value: "report", label: "Reports" },
  { value: "audit", label: "Audit log" },
];

const humanize = (code: string) => {
  const text = code.replace(/[._]/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const eventLabel = (event: string) => EVENTS[event] ?? humanize(event);

/** Events worth a second look: shown with a warning tone. */
export const SENSITIVE_EVENTS = new Set([
  "auth.login_blocked", "approval.denied", "sale.voided", "sale.returned", "cash_drawer.opened", "user.roles_changed", "user.suspended",
  "user.password_reset", "role.permissions_changed", "role.deleted", "product_price.set", "settings.updated", "store.updated", "audit.exported",
]);

const FIELDS: Record<string, string> = {
  is_active: "Active", id_number: "ID number", tin: "TIN", pin: "PIN", has_pin: "Has PIN", header_lines: "Receipt header", footer_text: "Receipt footer",
  show_vat_breakdown: "VAT breakdown", allocation_share_percent: "Terminal share %", allow_over_allocation: "Sell beyond allocation",
  max_cash_in_drawer: "Cash drawer limit", max_offline_hours: "Offline hours", expiry_warning_days: "Expiry warning days",
  is_vat_registered: "VAT registered", receipt_number: "Receipt", legal_name: "Legal name",
};

export const fieldLabel = (key: string) => FIELDS[key] ?? humanize(key);

/** Where to open the record an entry is about, when the app has a page for it. */
export function subjectHref(type: string, id: string): string | null {
  const pages: Record<string, string> = {
    sale: "/sales/view", customer: "/customers/view", user: "/users/view", role: "/roles/edit", product: "/products/edit",
    purchase_order: "/purchasing/orders/view", goods_receipt: "/purchasing/deliveries/view", stock_adjustment: "/inventory/documents/view",
  };
  return pages[type] ? `${pages[type]}?id=${id}` : null;
}

/** A value as one line of text: lists joined, booleans as Yes/No, empty as —. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length === 0 ? "(none)" : value.map(formatValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Old → new per field, for the details of an entry. */
export function changes(entry: { old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null }) {
  const keys = [...new Set([...Object.keys(entry.old_values ?? {}), ...Object.keys(entry.new_values ?? {})])];
  return keys.map((key) => ({
    key,
    label: fieldLabel(key),
    old: entry.old_values && key in entry.old_values ? entry.old_values[key] : undefined,
    new: entry.new_values && key in entry.new_values ? entry.new_values[key] : undefined,
  }));
}
