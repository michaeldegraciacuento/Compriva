import { expect, test } from "@playwright/test";

import { ACCOUNTS, authFile, open } from "./helpers";

/**
 * Dashboard and app shell against the real API and the demo database
 * (DemoDataSeeder: 3 low-stock SKUs incl. Safeguard out of stock, 3 expiring batches).
 * Sales figures are sample data until the point of sale exists.
 */

test.use({ reducedMotion: "reduce", storageState: authFile("owner") });

test("owner dashboard shows KPIs, chart, best sellers, transactions and real stock alerts", async ({ page }) => {
  await open(page);

  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByText(/Sample sales data/)).toBeVisible();
  for (const label of ["Today's sales", "Transactions", "Average transaction value", "Gross profit"]) {
    await expect(page.getByTestId(`stat-${label}`).getByTestId("stat-value")).toHaveText(/\S/);
  }

  const chart = page.getByTestId("sales-chart");
  await expect(chart.locator(".recharts-bar-rectangle").first()).toBeVisible();
  await chart.getByRole("radio", { name: "Table" }).or(chart.getByRole("button", { name: "Table" })).click();
  await expect(chart.getByRole("columnheader", { name: "Sales" })).toBeVisible();

  await expect(page.getByTestId("best-sellers").locator("li")).toHaveCount(5);
  await expect(page.getByTestId("recent-transactions").getByRole("row")).not.toHaveCount(0);

  // Real data from GET /api/v1/dashboard/stock-alerts
  const lowStock = page.getByTestId("low-stock");
  await expect(lowStock.getByText("Safeguard Bar Soap Pure White 135g")).toBeVisible();
  await expect(lowStock.getByText("Out of stock")).toBeVisible();
  await expect(page.getByTestId("expiring").getByText("Banana Lakatan Per kg")).toBeVisible();
});

test("the date range rescopes the sales section", async ({ page }) => {
  await open(page);

  await page.getByRole("group", { name: "Date range" }).getByText("7 days").click();
  await expect(page.getByTestId("stat-Sales, last 7 days")).toBeVisible();
  await expect(page.getByTestId("sales-chart").getByText("Sales by day")).toBeVisible();
  await expect(page.getByText("By sales, last 7 days")).toBeVisible();
});

test("header shows breadcrumbs, notifications and the user menu", async ({ page }) => {
  await open(page);

  const bell = page.getByTestId("notifications");
  await expect(bell).toHaveAccessibleName("Notifications (6)");
  await bell.click();
  await expect(page.getByText("3 products are low on stock")).toBeVisible();
  await expect(page.getByText("3 batches expire within 30 days")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "My profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  const crumbs = page.getByRole("navigation", { name: "breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(crumbs.getByText("My profile")).toBeVisible();
});

test.describe("as a cashier", () => {
  test.use({ storageState: authFile("cashier") });

  test("cashiers get a welcome page, not the dashboard", async ({ page }) => {
    await open(page);

    await expect(page.getByRole("heading", { name: `Welcome, ${ACCOUNTS.cashier.name}` })).toBeVisible();
    await expect(page.getByTestId("sales-chart")).toHaveCount(0);
    await expect(page.getByTestId("notifications")).toHaveAccessibleName("Notifications");
  });
});

test("phone layout: no horizontal scroll, navigation in a drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.getByTestId("low-stock").getByText("Out of stock")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await page.getByRole("button", { name: "Open menu" }).click();
  // Keyboard, not a click: in `next dev` the issues badge sits over the bottom of the drawer.
  await page.getByRole("dialog").getByTestId("nav-System status").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/system$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
