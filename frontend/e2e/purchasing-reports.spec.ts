import { expect as baseExpect, test } from "@playwright/test";

import { authFile, open } from "./helpers";

/**
 * Purchasing, shifts and reports against the real API (Phase 7). Each run adds
 * its own supplier and purchase order to the local database.
 */

test.use({ reducedMotion: "reduce", storageState: authFile("manager") });

// `php artisan serve` handles one request at a time.
const expect = baseExpect.configure({ timeout: 15_000 });

test("order from a supplier, receive in two deliveries, read the cost history", async ({ page }) => {
  test.setTimeout(150_000);
  const supplier = `E2E Supplier ${Date.now()}`;

  // Supplier
  await open(page, "/purchasing/suppliers");
  await page.getByRole("button", { name: "Add supplier" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(supplier);
  await dialog.getByLabel("Payment terms (days, 0 = cash on delivery)").fill("30");
  await dialog.getByRole("button", { name: "Save supplier" }).click();
  await expect(page.getByRole("cell", { name: new RegExp(supplier) }).first()).toBeVisible();

  // Purchase order: 2 cases of vinegar (1 case = 12 pc) at ₱430
  await open(page, "/purchasing/orders/new");
  const supplierOption = page.locator("#po-supplier option").filter({ hasText: supplier });
  await page.locator("#po-supplier").selectOption(await supplierOption.getAttribute("value") ?? "");
  await page.getByRole("combobox", { name: "Add a product" }).fill("Datu Puti");
  await page.getByRole("option", { name: /Datu Puti Vinegar/ }).click();
  await page.getByLabel("Unit for Datu Puti Vinegar 1L").selectOption({ label: "Case (1 case = 12 pc)" });
  await page.getByLabel("Quantity of Datu Puti Vinegar 1L").fill("2");
  await page.getByLabel("Unit cost of Datu Puti Vinegar 1L").fill("430");
  await expect(page.getByText("Total ₱860.00")).toBeVisible();
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page).toHaveURL(/\/purchasing\/orders\/view\?id=/);
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

  // Place it, then receive 1 case now and 1 later at a new cost
  await page.getByRole("button", { name: "Place order" }).click();
  await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Place order" }).click();
  await expect(page.getByText(/is ordered/)).toBeVisible();

  await page.getByLabel("Qty (case)").fill("1");
  await page.getByLabel("Supplier invoice / DR number").fill("DR-E2E-1");
  await page.getByRole("button", { name: "Receive into stock" }).click();
  await expect(page.getByText(/received: stock added, ₱430\.00 at cost/)).toBeVisible();
  await expect(page.getByText("Partly received").first()).toBeVisible();

  await page.getByLabel("Cost / case").fill("442.80");
  await page.getByRole("button", { name: "Receive into stock" }).click();
  await expect(page.getByText(/received: stock added, ₱442\.80 at cost/)).toBeVisible();
  await expect(page.getByText("Received", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Receive a delivery" })).toHaveCount(0);

  // Cost history: ₱442.80 ÷ 12 = ₱36.90 per piece on the latest delivery
  await page.getByRole("link", { name: /cost history/ }).first().click();
  await expect(page).toHaveURL(/\/purchasing\/costs\?sku_id=/);
  await expect(page.getByRole("cell", { name: "₱36.90" }).first()).toBeVisible();

  // Purchase history lists the delivery
  await open(page, "/purchasing/deliveries");
  await expect(page.getByRole("cell", { name: new RegExp(supplier) }).first()).toBeVisible();
});

test("reports show on screen and export as CSV, Excel and PDF", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, "/reports?report=payment-summary");
  await expect(page.getByRole("button", { name: "Payment summary" })).toHaveAttribute("aria-current", "page");
  await page.getByLabel("Period").selectOption("30");
  await expect(page.getByRole("columnheader", { name: "Collected" })).toBeVisible();

  for (const [button, extension] of [["CSV", "csv"], ["Excel", "xlsx"], ["PDF", "pdf"]] as const) {
    const download = page.waitForEvent("download");
    await page.getByRole("group", { name: "Export" }).getByRole("button", { name: button }).click();
    expect((await download).suggestedFilename()).toMatch(new RegExp(`^compriva-payment-summary-\\d{8}-\\d{6}\\.${extension}$`));
  }

  // Sales by period, monthly, with profit (the manager may see it)
  await page.getByRole("navigation", { name: "Reports" }).getByRole("button", { name: "Sales by period" }).click();
  await page.getByRole("radio", { name: "Monthly" }).or(page.getByRole("button", { name: "Monthly" })).first().click();
  await expect(page.getByText("Monthly sales", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Gross profit" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Total" })).toBeVisible();
});

test("managers see shift history with the drawer count", async ({ page }) => {
  await open(page, "/shifts");
  await expect(page.getByRole("heading", { name: "Cashier shifts" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Drawer" })).toBeVisible();
});
