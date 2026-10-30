import { expect as baseExpect, test, type Page } from "@playwright/test";

import { authFile, open } from "./helpers";

/**
 * Products and inventory against the real API (Phase 5). Each run creates its
 * own uniquely named product in the local database, so runs never collide.
 * The owner holds inventory.approve, so documents post immediately.
 */

test.use({ reducedMotion: "reduce", storageState: authFile("owner") });

// `php artisan serve` handles one request at a time; writes queue behind parallel tests.
const expect = baseExpect.configure({ timeout: 15_000 });

async function addToDocument(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Add a product" }).fill(name);
  await page.getByRole("option", { name: new RegExp(name) }).click();
}

test("create a product, price it, stock it in and out, and read its history", async ({ page }) => {
  test.setTimeout(120_000);
  const name = `E2E Calamansi Juice ${Date.now()}`;

  // Create product + first SKU
  await open(page, "/products/new");
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Selling price (₱)").fill("25");
  await page.getByLabel("Cost (₱)").fill("15");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page).toHaveURL(/\/products\/edit\?id=/);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();

  const card = page.locator('[data-testid^="sku-"]').first();
  await expect(card.getByText("₱25.00")).toBeVisible();

  // Pack size: 1 box = 12 pc
  await card.getByRole("button", { name: "Add unit" }).click();
  const unitDialog = page.getByRole("dialog");
  await unitDialog.getByLabel("Unit", { exact: true }).selectOption({ label: "Box (box)" });
  await unitDialog.getByLabel("pc per unit").fill("12");
  await unitDialog.getByRole("button", { name: "Add unit" }).click();
  await expect(card.getByText("1 box = 12 pc")).toBeVisible();

  // New price (history keeps the old one)
  await card.getByRole("button", { name: "Set price" }).click();
  const priceDialog = page.getByRole("dialog");
  await priceDialog.getByLabel("Price (₱)").fill("27.50");
  await priceDialog.getByRole("button", { name: "Save price" }).click();
  await expect(card.getByText("₱27.50")).toBeVisible();
  await card.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("row")).toHaveCount(3); // header + 2 prices
  await page.keyboard.press("Escape");

  // Stock in 2 boxes = 24 pc
  await open(page, "/inventory/stock-in");
  await addToDocument(page, name);
  await page.getByLabel("Quantity").fill("2");
  await page.getByLabel("Unit", { exact: true }).selectOption({ label: "Box (12 pc)" });
  await expect(page.getByText("= 24 pc")).toBeVisible();
  await page.getByLabel("Reference").fill("DR-E2E");
  await page.getByRole("button", { name: "Post stock in" }).click();
  await expect(page).toHaveURL(/\/inventory\/documents\/view\?id=/);
  await expect(page.getByText("Posted", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "+24" })).toBeVisible();

  // Stock out more than is available: refused, nothing changes
  await open(page, "/inventory/stock-out");
  await addToDocument(page, name);
  await page.getByLabel("Quantity").fill("100");
  await page.getByRole("button", { name: "Post stock out" }).click();
  await expect(page.getByText(/not enough|insufficient|only/i).first()).toBeVisible();

  // Stock out 5 pc
  await page.getByLabel("Quantity").fill("5");
  await page.getByLabel("Reason").selectOption({ label: "Damaged" });
  await page.getByRole("button", { name: "Post stock out" }).click();
  await expect(page).toHaveURL(/\/inventory\/documents\/view\?id=/);
  await expect(page.getByRole("cell", { name: "−5" })).toBeVisible();

  // Overview shows 19 on hand
  await open(page, "/inventory");
  await page.getByRole("searchbox", { name: "Search stock" }).fill(name);
  await page.getByRole("searchbox", { name: "Search stock" }).press("Enter");
  const row = page.getByRole("row", { name: new RegExp(name) });
  await expect(row.getByText("19 pc")).toBeVisible();

  // History: two movements, newest first
  await row.getByRole("link").click();
  await expect(page).toHaveURL(/\/inventory\/movements\?sku_id=/);
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toContainText("−5");
  await expect(rows.nth(2)).toContainText("+24");
});

test("categories, brands and units are managed in one place", async ({ page }) => {
  const brand = `E2E Brand ${Date.now()}`;
  await open(page, "/products/catalog");
  await page.getByRole("tab", { name: "Brands" }).click();
  await page.getByRole("button", { name: "New brand" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(brand);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: brand, exact: true })).toBeVisible();

  await page.getByRole("button", { name: `Delete ${brand}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("cell", { name: brand, exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "Units" }).click();
  for (const unit of ["Piece", "Kilogram", "Gram", "Liter", "Milliliter", "Pack", "Box", "Bottle", "Tray", "Dozen"]) {
    await expect(page.getByRole("cell", { name: new RegExp(`^${unit}`) })).toBeVisible();
  }
});

test("a cashier cannot open products or inventory", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("cashier") });
  const page = await context.newPage();
  await open(page, "/");
  const nav = page.getByRole("navigation", { name: /main|primary|sidebar/i }).first();
  await expect(nav.getByRole("link", { name: "Products" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Inventory" })).toHaveCount(0);
  await context.close();
});
