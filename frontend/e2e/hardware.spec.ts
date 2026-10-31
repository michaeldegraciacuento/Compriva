import { expect as baseExpect, test, type Page } from "@playwright/test";

import { authFile, open } from "./helpers";

/**
 * Hardware in the browser (Phase 9). A USB scanner is a keyboard that types
 * fast and presses Enter, so Playwright can act as one: 5 ms between keys.
 * Uses its own terminal (fixed install ID) and the manager, so it never shares a
 * shift with pos.spec.ts.
 */
const INSTALL_ID = "0b6f3d2e-6a1c-4e57-9a0e-e2e000000002";
const PANCIT_CANTON = "2000000000053"; // DemoDataSeeder: first barcode of Lucky Me! Pancit Canton

const expect = baseExpect.configure({ timeout: 15_000 });
test.use({ reducedMotion: "reduce", storageState: authFile("manager") });

async function scan(page: Page, code: string) {
  await page.keyboard.type(code, { delay: 5 });
  await page.keyboard.press("Enter");
}

const cart = (page: Page) => page.getByRole("region", { name: "Cart" });

test("a USB scanner adds items from anywhere on the POS, ignores double reads and flags unknown barcodes", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript((id) => window.localStorage.setItem("compriva.install_id", id), INSTALL_ID);
  await open(page, "/pos");

  const register = page.getByRole("button", { name: "Register this computer" });
  const openShift = page.getByRole("button", { name: /Open shift with/ });
  const heading = page.getByRole("heading", { name: "Point of Sale" });
  await expect(register.or(openShift).or(heading)).toBeVisible();
  if (await register.isVisible()) {
    await page.getByLabel("Terminal name").fill("E2E scanner lane");
    await register.click();
  }
  await expect(openShift.or(heading)).toBeVisible();
  if (await openShift.isVisible()) {
    await page.getByLabel("Opening cash (₱)").fill("0");
    await openShift.click();
  }
  await expect(heading).toBeVisible();
  if (await cart(page).getByRole("button", { name: "Clear cart" }).isEnabled()) {
    await cart(page).getByRole("button", { name: "Clear cart" }).click();
    await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Clear cart" }).click();
  }

  // The cursor is not in the scan box: the scan is recognised by its speed.
  // The scanner reads the label twice in a row (a double read): only one item is added.
  await heading.click();
  await scan(page, PANCIT_CANTON);
  await scan(page, PANCIT_CANTON);
  const quantity = cart(page).getByLabel(/Quantity of Lucky Me! Pancit Canton/);
  await expect(quantity).toHaveValue("1");
  await page.waitForTimeout(800);
  await expect(quantity).toHaveValue("1");

  // A deliberate second scan, later, adds another.
  await scan(page, PANCIT_CANTON);
  await expect(quantity).toHaveValue("2");

  // Someone typing slowly outside the scan box is not mistaken for a scanner.
  await heading.click();
  await page.keyboard.type("1234", { delay: 120 });
  await page.keyboard.press("Enter");
  await expect(quantity).toHaveValue("2");

  // Unknown barcode: a clear message, the cart unchanged.
  await page.getByLabel("Scan a barcode or search items").click();
  await scan(page, "2009999999992");
  await expect(page.getByRole("alert").filter({ hasText: "Unknown barcode" })).toContainText("2009999999992");
  await expect(cart(page).getByRole("listitem")).toHaveCount(1);

  await cart(page).getByRole("button", { name: "Clear cart" }).click();
  await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Clear cart" }).click();
});

test("the hardware page explains browser printing and previews the receipt", async ({ page }) => {
  await open(page, "/hardware");
  await expect(page.getByRole("heading", { name: "Hardware" })).toBeVisible();
  await expect(page.getByText("In the browser, receipts print through the print dialog.")).toBeVisible();
  await expect(page.getByText("The cash drawer needs the Compriva desktop app")).toBeVisible();

  // Paper size switches the preview.
  await page.getByRole("radio", { name: "58 mm" }).or(page.getByRole("button", { name: "58 mm" })).first().click();
  await expect(page.locator(".receipt-print[data-paper='58mm']")).toBeVisible();

  // The scanner tester tells a scan from typing.
  const tester = page.getByLabel("Test: scan a barcode here");
  await tester.click();
  await page.keyboard.type("4800016644290", { delay: 5 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Scans" })).toContainText("scan");
  await page.keyboard.type("4800016644290", { delay: 120 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Scans" })).toContainText("typed (too slow for a scanner)");
});
