import type { AuthUser } from "@/modules/auth/types";

/** A user as the Users pages see it (UserResource). */
export type ManagedUser = AuthUser;

export interface UserMeta {
  is_self: boolean;
  /** False for someone with more access than you: the server refuses changes. */
  manageable: boolean;
}

/** A role for the user form (GET /users/role-options). */
export interface RoleOption {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  permissions_count: number;
  grantable: boolean;
}

export interface Role {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  is_system: boolean;
  permissions: string[];
  users_count: number;
}

export interface Permission {
  name: string;
  display_name: string;
  group: string;
  description: string | null;
}

/** Section titles for permission groups, in the order the Roles page shows them. */
export const PERMISSION_GROUPS: { group: string; label: string }[] = [
  { group: "dashboard", label: "Dashboard" },
  { group: "pos", label: "Point of sale" },
  { group: "sales", label: "Sales" },
  { group: "cashier", label: "Cashier shifts" },
  { group: "customers", label: "Customers" },
  { group: "payments", label: "Payments" },
  { group: "products", label: "Products" },
  { group: "inventory", label: "Inventory" },
  { group: "purchasing", label: "Purchasing" },
  { group: "reports", label: "Reports" },
  { group: "users", label: "Users and roles" },
  { group: "settings", label: "Settings" },
  { group: "devices", label: "Terminals" },
];

/** Permissions that matter most, flagged on the Roles page. */
export const SENSITIVE_PERMISSIONS = new Set([
  "pos.price_override", "sales.void", "sales.return", "inventory.approve", "reports.view_profit", "users.manage", "roles.manage", "settings.manage", "devices.manage",
]);
