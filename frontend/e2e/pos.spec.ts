import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";

import { ACCOUNTS, authFile, open, type AccountKey } from "./helpers";

/**
 * Point of sale against the real API (Phase 6), on one browser registered as
 * a terminal. The install ID is fixed so every run reuses the same terminal
 * instead of registering a new one. Sells demo products (DemoDataSeeder).
 */

const INSTALL_ID = "0b6f3d2e-6a1c-4e57-9a0e-e2e000000001";

// `php artisan serve` handles one request at a time.
const expect = baseExpect.configure({ timeout: 15_000 });

test.describe.configure({ mode: "serial" });
test.use({ reducedMotion: "reduce" });

async function terminalPage(browser: Browser, account: AccountKey): Promise<Page> {
  const context = await browser.newContext({ storageState: authFile(account), reducedMotion: "reduce" });
  await context.addInitScript((id) => window.localStorage.setItem("compriva.install_id", id), INSTALL_ID);
  return context.newPage();
}

async function addItem(page: Page, search: string, name: RegExp) {
  await page.getByLabel("Scan a barcode or search items").fill(search);
  await page.getByRole("list", { name: "Items" }).getByRole("button", { name }).first().click();
}

const cart = (page: Page) => page.getByRole("region", { name: "Cart" });

test("a manager registers this browser as a terminal", async ({ browser }) => {
  const page = await terminalPage(browser, "owner");
  await open(page, "/pos");
  const register = page.getByRole("button", { name: "Register this computer" });
  // First run registers; later runs find the terminal already set up.
  await expect(register.or(page.getByText(/Open a shift on|is in use|Point of Sale ·|Shift since/).first()).or(page.getByRole("heading", { name: "Point of Sale" }))).toBeVisible();
  if (await register.isVisible()) {
    await page.getByLabel("Terminal name").fill("E2E browser lane");
    await register.click();
  }
  await expect(page.getByText("Set up this checkout terminal")).toHaveCount(0);
  await page.context().close();
});

test("a cashier sells with cash, split GCash, a manager-approved discount, holds a cart and voids a sale", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await terminalPage(browser, "cashier");
  await open(page, "/pos");

  // Open the shift unless this cashier's shift from an earlier run is still open.
  const openShift = page.getByRole("button", { name: /Open shift with/ });
  await expect(openShift.or(page.getByRole("heading", { name: "Point of Sale" }))).toBeVisible();
  if (await openShift.isVisible()) {
    await page.getByLabel("Opening cash (₱)").fill("1000");
    await openShift.click();
  }
  await expect(page.getByRole("heading", { name: "Point of Sale" })).toBeVisible();
  await expect(page.getByText(ACCOUNTS.cashier.name).first()).toBeVisible();

  // 1. Cash sale: 3 × Pancit Canton ₱16 = ₱48, ₱100 cash → ₱52 change.
  await addItem(page, "Pancit Canton", /Pancit Canton/);
  await cart(page).getByRole("button", { name: /One more/ }).click();
  await cart(page).getByRole("button", { name: /One more/ }).click();
  await expect(cart(page).getByRole("button", { name: "Pay ₱48.00" })).toBeVisible();
  await cart(page).getByRole("button", { name: "Pay ₱48.00" }).click();
  let payment = page.getByRole("dialog", { name: "Payment" });
  await payment.getByLabel("Cash received (₱)").fill("100");
  await expect(payment.getByText("₱52.00").first()).toBeVisible();
  await payment.getByRole("button", { name: "Complete · change ₱52.00" }).click();
  let done = page.getByRole("dialog", { name: /Sale complete/ });
  await expect(done.getByText("₱52.00").first()).toBeVisible();
  await expect(done.getByText(/T\d\d-\d{6}/).first()).toBeVisible();
  await done.getByRole("button", { name: "New sale" }).click();

  // 2. Split payment: 1.5 kg rice ₱87 = ₱50 GCash (QR, reference) + ₱37 exact cash.
  await addItem(page, "Jasmine Rice", /Jasmine Rice/);
  await cart(page).getByLabel(/Quantity of Jasmine Rice/).fill("1.5");
  await cart(page).getByRole("button", { name: "Pay ₱87.00" }).click();
  payment = page.getByRole("dialog", { name: "Payment" });
  await payment.getByRole("button", { name: "GCash", exact: true }).click();
  await payment.getByLabel("GCash amount (₱)").fill("50");
  await payment.getByLabel("GCash reference number").fill("E2E-GC-1001");
  await payment.getByRole("button", { name: "Add GCash payment and split" }).click();
  await payment.getByRole("button", { name: "Cash", exact: true }).click();
  await payment.getByRole("button", { name: "Exact" }).click();
  await payment.getByRole("button", { name: "Complete sale" }).click();
  done = page.getByRole("dialog", { name: /Sale complete/ });
  await expect(done.getByText("Ref E2E-GC-1001")).toBeVisible();
  await done.getByRole("button", { name: "New sale" }).click();

  // 3. A 10% item discount needs a manager: approval on the cashier's screen.
  await addItem(page, "Pancit Canton", /Pancit Canton/);
  await cart(page).getByRole("button", { name: /^Edit Lucky Me! Pancit Canton/ }).click();
  const lineDialog = page.getByRole("dialog");
  await lineDialog.getByRole("radio", { name: "Percent" }).or(lineDialog.getByRole("button", { name: "Percent" })).first().click();
  await lineDialog.getByLabel("Discount percent").fill("10");
  await lineDialog.getByRole("button", { name: "Save" }).click();
  await expect(cart(page).getByRole("button", { name: "Pay ₱14.40" })).toBeVisible();
  await cart(page).getByRole("button", { name: "Pay ₱14.40" }).click();
  payment = page.getByRole("dialog", { name: "Payment" });
  await expect(payment.getByText("Manager approval for discounts")).toBeVisible();
  await payment.getByLabel("Cash received (₱)").fill("20");
  await payment.getByLabel("Manager username").fill(ACCOUNTS.manager.login);
  await payment.getByLabel("PIN or password").fill(ACCOUNTS.manager.password);
  await payment.getByRole("button", { name: /Complete/ }).click();
  await page.getByRole("dialog", { name: /Sale complete/ }).getByRole("button", { name: "New sale" }).click();

  // 4. Hold a cart, then resume it.
  await addItem(page, "Century Tuna", /Century Tuna/);
  await cart(page).getByRole("button", { name: "Hold" }).click();
  await page.getByLabel("Name (optional)").fill("Customer getting rice");
  await page.getByRole("button", { name: "Hold cart" }).click();
  await expect(cart(page).getByText("The cart is empty")).toBeVisible();
  await page.getByRole("button", { name: /Held carts \(\d+\)/ }).click();
  const heldSheet = page.getByRole("dialog", { name: "Held carts" });
  await heldSheet.getByRole("listitem").filter({ hasText: "Customer getting rice" }).getByRole("button", { name: "Resume" }).click();
  await expect(cart(page).getByText(/Century Tuna/)).toBeVisible();
  await cart(page).getByRole("button", { name: "Clear cart" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Clear cart" }).or(page.getByRole("dialog").getByRole("button", { name: "Clear cart" })).first().click();

  // 5. Void the last sale with a manager's approval; it stays on record as voided.
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  await page.getByRole("dialog", { name: "Sales this shift" }).getByRole("button", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/\/sales\/view\?id=/);
  await page.getByRole("button", { name: "Void sale" }).click();
  const voidDialog = page.getByRole("dialog");
  await voidDialog.getByLabel("Reason").fill("Customer changed mind");
  await voidDialog.getByLabel("Manager username").fill(ACCOUNTS.manager.login);
  await voidDialog.getByLabel("PIN or password").fill(ACCOUNTS.manager.password);
  await voidDialog.getByRole("button", { name: "Void sale" }).click();
  await expect(page.getByText(/was voided and its stock returned/)).toBeVisible();
  await expect(page.getByText("VOID", { exact: true })).toBeVisible();

  // 6. Close the shift with a cash count.
  await open(page, "/pos");
  await page.getByRole("button", { name: "Close shift" }).click();
  const closeDialog = page.getByRole("dialog");
  await expect(closeDialog.getByText("Expected cash in drawer")).toBeVisible();
  await closeDialog.getByLabel("Cash counted (₱)").fill("1100");
  await closeDialog.getByRole("button", { name: "Close shift" }).click();
  await expect(closeDialog.getByRole("heading", { name: "Shift closed" })).toBeVisible();
  await closeDialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: /Open shift with/ })).toBeVisible();
  await page.context().close();
});

test("the payment methods page offers only Cash, GCash and Maya", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("owner") });
  const page = await context.newPage();
  await open(page, "/payment-methods");
  await expect(page.getByRole("heading", { name: "Payment methods" })).toBeVisible();
  await expect(page.getByText("GCash", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Credit / Debit Card")).toHaveCount(0);
  await context.close();
});
