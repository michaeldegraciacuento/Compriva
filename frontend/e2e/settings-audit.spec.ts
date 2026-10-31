import { expect as baseExpect, test } from "@playwright/test";

import { authFile, open } from "./helpers";

/**
 * Settings (owner only) and the audit log (owner and manager).
 * Changes the receipt footer and puts it back, so the demo receipt stays the same.
 */
const expect = baseExpect.configure({ timeout: 15_000 });
test.describe.configure({ mode: "serial" });
test.use({ reducedMotion: "reduce" });

const run = Date.now().toString(36);

test("the owner changes the receipt footer, sees it in the preview, and finds the change in the audit log", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ storageState: authFile("owner"), reducedMotion: "reduce" });
  const page = await context.newPage();
  await open(page, "/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  const footer = page.getByLabel("Footer message");
  const original = await footer.inputValue();
  const receipts = page.getByRole("region", { name: "Receipts" }).or(page.locator("form").filter({ has: footer }));
  await footer.fill(`Salamat po! ${run}`);
  await receipts.getByRole("button", { name: "Save" }).click();
  // Confirmation pop-up; OK closes it.
  const done = page.getByRole("dialog", { name: "Receipts saved" });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "OK" }).click();
  await expect(done).toHaveCount(0);
  await expect(receipts.getByText(/Last changed .* by Store Owner/)).toBeVisible();
  await expect(page.locator(".receipt-print").getByText(`Salamat po! ${run}`)).toBeVisible();

  // Out-of-range values are refused by the form before saving.
  const share = page.getByLabel("Stock shared with terminals (%)");
  await expect(share).toHaveAttribute("min", "10");

  // The audit log shows who changed what, before and after.
  await open(page, "/audit");
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await page.getByLabel("Area").selectOption("settings");
  const entry = page.getByRole("list", { name: "Audit entries" }).getByRole("button", { name: /Settings changed/ }).first();
  await expect(entry).toContainText("Store Owner");
  await entry.click();
  await expect(page.getByRole("cell", { name: `Salamat po! ${run}` })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Receipt footer" }).first()).toBeVisible();

  // CSV download of the filtered entries.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/^audit-log-.*\.csv$/);

  // Put the footer back.
  await open(page, "/settings");
  await page.getByLabel("Footer message").fill(original);
  await page.locator("form").filter({ has: page.getByLabel("Footer message") }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog", { name: "Receipts saved" })).toBeVisible();
  await context.close();
});

test("managers read the audit log and a user's history, but cannot open Settings", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authFile("manager"), reducedMotion: "reduce" });
  const page = await context.newPage();
  await open(page, "/");
  const nav = page.getByRole("navigation").first();
  await expect(nav.getByRole("link", { name: "Audit log" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);

  await open(page, "/audit");
  await page.getByLabel("Area").selectOption("auth");
  await expect(page.getByRole("list", { name: "Audit entries" }).getByRole("button").first()).toBeVisible();

  // A user's page shows their history from the audit log.
  await open(page, "/users");
  await page.getByLabel("Search users").fill("cashier1");
  await page.getByRole("link", { name: "Juan Dela Cruz" }).click();
  await expect(page).toHaveURL(/\/users\/view/);
  await expect(page.getByRole("list", { name: "History" }).or(page.getByText("Nothing recorded yet."))).toBeVisible();
  await context.close();
});
