import { describe, expect, it } from "vitest";

import type { Session } from "@/modules/auth/types";

import { NAVIGATION, breadcrumbsFor, navigationFor } from "./navigation";

function session(permissions: string[]): Session {
  return { user: { id: "u", name: "U", username: "u" }, roles: [], permissions, mode: "online", method: "session", device: null };
}

const CASHIER = ["pos.access", "pos.remove_item", "sales.reprint", "customers.view", "customers.manage", "cashier.shift"];
const CLERK = ["products.view", "inventory.view", "inventory.adjust", "purchasing.view", "purchasing.receive"];
const ALL = NAVIGATION.flatMap((g) => g.items.map((i) => i.permission)).filter((p): p is string => p !== null).concat("dashboard.view");

const labels = (permissions: string[]) => navigationFor(session(permissions)).map((g) => [g.label, g.items.map((i) => i.label)]);

describe("role-based navigation", () => {
  it("shows a cashier Home and the selling modules only", () => {
    expect(labels(CASHIER)).toEqual([
      [null, ["Home"]],
      ["Sell", ["Point of Sale", "Customers"]],
    ]);
  });

  it("shows inventory staff their stock modules and no administration", () => {
    expect(labels(CLERK)).toEqual([
      [null, ["Home"]],
      ["Stock", ["Products", "Inventory", "Purchasing"]],
    ]);
  });

  it("shows an owner every group and a Dashboard", () => {
    const groups = navigationFor(session(ALL));
    expect(groups.map((g) => g.label)).toEqual([null, "Sell", "Stock", "Insights", "Administration"]);
    expect(groups[0].items[0].label).toBe("Dashboard");
    expect(groups.flatMap((g) => g.items)).toHaveLength(NAVIGATION.flatMap((g) => g.items).length);
  });

  it("shows only Home without a session", () => {
    expect(labels([])).toEqual([[null, ["Home"]]]);
  });
});

describe("breadcrumbs", () => {
  it("names the home page by what it shows", () => {
    expect(breadcrumbsFor("/", session(["dashboard.view"]))).toEqual([{ label: "Dashboard", href: null }]);
    expect(breadcrumbsFor("/", session(CASHIER))).toEqual([{ label: "Home", href: null }]);
  });

  it("includes the sidebar group as a non-link crumb", () => {
    expect(breadcrumbsFor("/system", session(ALL))).toEqual([
      { label: "Dashboard", href: "/" },
      { label: "Administration", href: null },
      { label: "System status", href: null },
    ]);
  });

  it("nests module sub-pages under their parent page", () => {
    expect(breadcrumbsFor("/inventory/documents/view", session(ALL))).toEqual([
      { label: "Dashboard", href: "/" },
      { label: "Stock", href: null },
      { label: "Inventory", href: "/inventory" },
      { label: "Documents", href: "/inventory/documents" },
      { label: "Document", href: null },
    ]);
  });

  it("covers pages outside the sidebar", () => {
    expect(breadcrumbsFor("/profile", session(CASHIER))).toEqual([
      { label: "Home", href: "/" },
      { label: "My profile", href: null },
    ]);
  });
});
