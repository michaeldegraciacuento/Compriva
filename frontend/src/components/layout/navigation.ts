import {
  Activity,
  BarChart3,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  type LucideIcon,
  Monitor,
  Package,
  QrCode,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";

import { can } from "@/modules/auth/permissions";
import type { Session } from "@/modules/auth/types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown only to users holding this permission. null = every signed-in user. */
  permission: string | null;
  /** False until the module is built; rendered as "Soon", not as a link. */
  available: boolean;
}

export interface NavGroup {
  label: string | null;
  items: readonly NavItem[];
}

/** Sidebar structure, one entry per UI module (docs/architecture.md). */
export const NAVIGATION: readonly NavGroup[] = [
  {
    label: null,
    items: [{ label: "Dashboard", href: "/", icon: LayoutDashboard, permission: null, available: true }],
  },
  {
    label: "Sell",
    items: [
      { label: "Point of Sale", href: "/pos", icon: ShoppingCart, permission: "pos.access", available: true },
      { label: "Sales", href: "/sales", icon: Receipt, permission: "sales.view", available: true },
      { label: "Cashier shifts", href: "/shifts", icon: Wallet, permission: "cashier.manage_shifts", available: true },
      { label: "Customers", href: "/customers", icon: UserRound, permission: "customers.view", available: false },
    ],
  },
  {
    label: "Stock",
    items: [
      { label: "Products", href: "/products", icon: Package, permission: "products.view", available: true },
      { label: "Inventory", href: "/inventory", icon: Boxes, permission: "inventory.view", available: true },
      { label: "Purchasing", href: "/purchasing", icon: Truck, permission: "purchasing.view", available: true },
    ],
  },
  {
    label: "Insights",
    items: [{ label: "Reports", href: "/reports", icon: BarChart3, permission: "reports.view", available: true }],
  },
  {
    label: "Administration",
    items: [
      { label: "Users", href: "/users", icon: Users, permission: "users.manage", available: false },
      { label: "Roles", href: "/roles", icon: ShieldCheck, permission: "roles.manage", available: false },
      { label: "Terminals & sync", href: "/terminals", icon: Monitor, permission: "inventory.allocate", available: true },
      { label: "Payment methods", href: "/payment-methods", icon: QrCode, permission: "payments.manage_methods", available: true },
      { label: "Settings", href: "/settings", icon: Settings, permission: "settings.manage", available: false },
      { label: "Audit log", href: "/audit", icon: ClipboardList, permission: "audit.view", available: false },
      { label: "System status", href: "/system", icon: Activity, permission: "settings.manage", available: true },
    ],
  },
];

/** Pages that are not in the sidebar but appear in breadcrumbs, under an optional parent page. */
const EXTRA_ROUTES: Record<string, { label: string; parent?: string }> = {
  "/profile": { label: "My profile" },
  "/sync": { label: "Sync" },
  "/products/new": { label: "New product", parent: "/products" },
  "/products/edit": { label: "Edit product", parent: "/products" },
  "/products/catalog": { label: "Categories, brands & units", parent: "/products" },
  "/inventory/stock-in": { label: "Stock in", parent: "/inventory" },
  "/inventory/stock-out": { label: "Stock out", parent: "/inventory" },
  "/inventory/count": { label: "Stock count", parent: "/inventory" },
  "/inventory/documents": { label: "Documents", parent: "/inventory" },
  "/inventory/documents/view": { label: "Document", parent: "/inventory/documents" },
  "/inventory/movements": { label: "Stock history", parent: "/inventory" },
  "/inventory/batches": { label: "Batches & expiry", parent: "/inventory" },
  "/sales/view": { label: "Sale", parent: "/sales" },
  "/purchasing/orders/new": { label: "New purchase order", parent: "/purchasing" },
  "/purchasing/orders/edit": { label: "Edit purchase order", parent: "/purchasing" },
  "/purchasing/orders/view": { label: "Purchase order", parent: "/purchasing" },
  "/purchasing/suppliers": { label: "Suppliers", parent: "/purchasing" },
  "/purchasing/deliveries": { label: "Purchase history", parent: "/purchasing" },
  "/purchasing/deliveries/view": { label: "Delivery", parent: "/purchasing/deliveries" },
  "/purchasing/costs": { label: "Cost history", parent: "/purchasing" },
};

/** The home page is a dashboard for people who may see one, a welcome page otherwise. */
function homeLabel(session: Session | null): string {
  return can(session, "dashboard.view") ? "Dashboard" : "Home";
}

/** Groups and items the user may see; empty groups are dropped. */
export function navigationFor(session: Session | null): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => item.permission === null || can(session, item.permission))
      .map((item) => (item.href === "/" ? { ...item, label: homeLabel(session) } : item)),
  })).filter((group) => group.items.length > 0);
}

export interface Crumb {
  label: string;
  href: string | null;
}

/** Breadcrumb trail for a path: Home › [group] › [parent pages] › page. Group labels are not links. */
export function breadcrumbsFor(pathname: string, session: Session | null): Crumb[] {
  const home: Crumb = { label: homeLabel(session), href: "/" };
  if (pathname === "/") return [{ ...home, href: null }];

  const trail = (path: string, current: boolean): Crumb[] => {
    for (const group of NAVIGATION) {
      const item = group.items.find((candidate) => candidate.href === path);
      if (item) {
        return [...(group.label ? [{ label: group.label, href: null }] : []), { label: item.label, href: current ? null : item.href }];
      }
    }
    const extra = EXTRA_ROUTES[path];
    if (!extra) return [];
    return [...(extra.parent ? trail(extra.parent, false) : []), { label: extra.label, href: current ? null : path }];
  };

  // Static export may serve "/inventory/stock-in/" with a trailing slash.
  return [home, ...trail(pathname.replace(/\/$/, "") || "/", true)];
}
