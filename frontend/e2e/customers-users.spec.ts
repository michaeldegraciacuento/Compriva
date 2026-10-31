import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";

import { authFile, open, type AccountKey } from "./helpers";

/**
 * Customers at the counter and in the back office, users and roles.
 * Sells as the manager on the hardware spec's terminal (a person has one open shift at a
 * time); the owner registers it on a fresh database.
 * Demo customers come from DemoDataSeeder (Lola Carmen Villanueva is a senior citizen).
 * Each run adds a customer, a user and a role with unique names (the role is deleted again).
 */
const INSTALL_ID = "0b6f3d2e-6a1c-4e57-9a0e-e2e000000002"; // hardware.spec.ts
const LOLA = "Lola Carmen Villanueva";
const LOLA_ID = "SC-QC-2019-04411";
const run = Date.now().toString(36);

const expect = baseExpect.configure({ timeout: 15_000 });
test.describe.configure({ mode: "serial" });
test.use({ reducedMotion: "reduce" });

async function terminalPage(browser: Browser, account: AccountKey): Promise<Page> {
  const context = await browser.newContext({ storageState: authFile(account), reducedMotion: "reduce" });
  await context.addInitScript((id) => window.localStorage.setItem("compriva.install_id", id), INSTALL_ID);
  return context.newPage();
}

const cart = (page: Page) => page.getByRole("region", { name: "Cart" });

async function addPancitCanton(page: Page) {
  await page.getByLabel("Scan a barcode or search items").fill("Pancit Canton");
  await page.getByRole("list", { name: "Items" }).getByRole("button", { name: /Pancit Canton/ }).first().click();
}

async function payExact(page: Page) {
  await cart(page).getByRole("button", { name: /^Pay ₱/ }).click();
  const payment = page.getByRole("dialog", { name: "Payment" });
  await payment.getByRole("button", { name: "Exact" }).click();
  await payment.getByRole("button", { name: /Complete/ }).click();
  return page.getByRole("dialog", { name: /Sale complete/ });
}

test("the owner registers the test terminal", async ({ browser }) => {
  const page = await terminalPage(browser, "owner");
  await open(page, "/pos");
  const register = page.getByRole("button", { name: "Register this computer" });
  await expect(register.or(page.getByText(/Open a shift on|is in use|Shift since/).first()).or(page.getByRole("heading", { name: "Point of Sale" }))).toBeVisible();
  if (await register.isVisible()) {
    await page.getByLabel("Terminal name").fill("E2E scanner lane");
    await register.click();
  }
  await expect(page.getByText("Set up this checkout terminal")).toHaveCount(0);
  await page.context().close();
});

test("at the counter: a senior citizen from the customer list gets their discount and ID; a new customer is added", async ({ browser }) => {
  test.setTimeout(150_000);
  const page = await terminalPage(browser, "manager");
  await open(page, "/pos");
  const openShift = page.getByRole("button", { name: /Open shift with/ });
  const heading = page.getByRole("heading", { name: "Point of Sale" });
  await expect(openShift.or(heading)).toBeVisible();
  if (await openShift.isVisible()) {
    await page.getByLabel("Opening cash (₱)").fill("0");
    await openShift.click();
  }
  await expect(heading).toBeVisible();

  // Choose Lola from the list: the SC discount is picked and her ID number filled in.
  await addPancitCanton(page);
  await cart(page).getByRole("button", { name: "Sale discount or customer" }).click();
  let dialog = page.getByRole("dialog", { name: "Sale discount and customer" });
  await dialog.getByLabel("Find a customer").fill("Lola");
  await dialog.getByRole("list", { name: "Customers" }).getByRole("button", { name: new RegExp(LOLA) }).click();
  await expect(dialog.getByRole("button", { name: /Senior Citizen 20%/ })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByLabel("Customer ID number")).toHaveValue(LOLA_ID);
  // Enter in the search box must not apply the dialog.
  await dialog.getByRole("button", { name: "Change" }).click();
  await dialog.getByLabel("Find a customer").press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(cart(page).getByRole("button", { name: new RegExp(`Senior Citizen 20%.*${LOLA}`) })).toBeVisible();

  let done = await payExact(page);
  await expect(done.getByText(LOLA).first()).toBeVisible();
  await expect(done.getByText(`SC/PWD ID: ${LOLA_ID}`).first()).toBeVisible();

  // She wants one more thing after paying: the sale is final, so "More items" starts a new sale for her.
  await done.getByRole("button", { name: `More items for ${LOLA}` }).click();
  await expect(cart(page).getByRole("button", { name: new RegExp(`Senior Citizen 20%.*${LOLA}`) })).toBeVisible();
  await addPancitCanton(page);
  done = await payExact(page);
  await expect(done.getByText(LOLA).first()).toBeVisible();
  await expect(done.getByText(`SC/PWD ID: ${LOLA_ID}`).first()).toBeVisible();
  await done.getByRole("button", { name: "New sale" }).click();
  await expect(cart(page).getByRole("button", { name: "Sale discount or customer" })).toBeVisible(); // New sale: no customer

  // A sale where the cashier forgot the customer: added afterwards on the sale page; the receipt stays as printed.
  await addPancitCanton(page);
  done = await payExact(page);
  await done.getByRole("button", { name: "New sale" }).click();
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  await page.getByRole("dialog", { name: "Sales this shift" }).getByRole("button", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/\/sales\/view\?id=/);
  await page.getByRole("button", { name: "Add customer" }).click();
  const addDialog = page.getByRole("dialog", { name: /Add customer to/ });
  await addDialog.getByLabel("Find a customer").fill("Mark Aquino");
  await addDialog.getByRole("list", { name: "Customers" }).getByRole("button", { name: /Mark Aquino/ }).click();
  await addDialog.getByLabel("Note (optional)").fill("Forgot at checkout");
  await addDialog.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText(/Mark Aquino was added to sale/)).toBeVisible();
  await expect(page.getByText(/Customer \(added later by/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add customer" })).toHaveCount(0);
  await open(page, "/pos");
  await expect(page.getByRole("heading", { name: "Point of Sale" })).toBeVisible();

  // A first-time buyer is added from the POS and chosen at once.
  await addPancitCanton(page);
  await cart(page).getByRole("button", { name: "Sale discount or customer" }).click();
  dialog = page.getByRole("dialog", { name: "Sale discount and customer" });
  await dialog.getByLabel("Find a customer").fill(`E2E Buyer ${run}`);
  await dialog.getByRole("button", { name: "New" }).click();
  const added = dialog.getByRole("group", { name: "New customer" });
  await expect(added.getByLabel("Name")).toHaveValue(`E2E Buyer ${run}`);
  await added.getByLabel("Phone").fill("0917 000 0000");
  await added.getByRole("button", { name: "Save customer" }).click();
  await expect(dialog.getByText(`E2E Buyer ${run}`)).toBeVisible();
  await dialog.getByRole("button", { name: "Apply" }).click();
  done = await payExact(page);
  await expect(done.getByText(`E2E Buyer ${run}`).first()).toBeVisible();
  await done.getByRole("button", { name: "New sale" }).click();
  await page.context().close();
});

test("the Customers page shows purchase history and adds a business customer", async ({ browser }) => {
  const page = await terminalPage(browser, "manager");
  await open(page, "/customers");
  await expect(page.getByRole("heading", { name: "Customers" })).toBeVisible();
  await page.getByLabel("Search customers").fill(LOLA_ID);
  await page.getByRole("link", { name: LOLA }).click();
  await expect(page).toHaveURL(/\/customers\/view/);
  await expect(page.getByRole("heading", { name: LOLA })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: LOLA_ID })).toBeVisible();
  // The sale from the counter test is in her history, linked to the sale page.
  await expect(page.getByRole("link", { name: /T\d\d-\d{6}/ }).first()).toBeVisible();

  await open(page, "/customers");
  await page.getByRole("button", { name: "Add customer" }).click();
  const dialog = page.getByRole("dialog", { name: "Add customer" });
  await dialog.getByLabel("Name").fill(`E2E Trading ${run}`);
  await dialog.getByLabel("Type").selectOption("business");
  await dialog.getByLabel("TIN").fill("111-222-333-000");
  await dialog.getByLabel(/Business address/).fill("Quezon City");
  await dialog.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByRole("heading", { name: `E2E Trading ${run}` })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "111-222-333-000" })).toBeVisible();
  await expect(page.getByText("No purchases yet")).toBeVisible();
  await page.context().close();
});

test("the owner adds a cashier, suspends and reactivates them, and creates and deletes a role", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await terminalPage(browser, "owner");
  await open(page, "/users");
  await page.getByRole("button", { name: "Add user" }).click();
  const dialog = page.getByRole("dialog", { name: "Add user" });
  await dialog.getByLabel("Full name").fill(`E2E Cashier ${run}`);
  await dialog.getByLabel("Username").fill(`e2e_${run}`);
  await dialog.getByLabel("Password", { exact: true }).fill("Cashier123");
  await dialog.getByLabel("Confirm password").fill("Cashier123");
  await dialog.getByLabel("PIN (optional)").fill("482913");
  await expect(dialog.getByRole("checkbox", { name: /Cashier/ })).toBeChecked();
  await dialog.getByRole("button", { name: "Create user" }).click();

  await expect(page).toHaveURL(/\/users\/view/);
  await expect(page.getByRole("heading", { name: `E2E Cashier ${run}` })).toBeVisible();
  await expect(page.getByRole("main").locator("span", { hasText: /^Active$/ })).toBeVisible();
  await page.getByRole("button", { name: "Suspend" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Suspend" }).click();
  await expect(page.getByRole("dialog", { name: `E2E Cashier ${run} is suspended` })).toBeVisible();
  await page.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByRole("dialog", { name: `E2E Cashier ${run} can sign in again` })).toBeVisible();

  // A role copied from Cashier, then deleted (nobody has it).
  await open(page, "/roles");
  await expect(page.getByRole("link", { name: "Owner" })).toBeVisible();
  await page.getByRole("button", { name: "New role" }).click(); // a link styled as a button (LinkButton)
  await page.getByLabel("Name").fill(`E2E Role ${run}`);
  await page.getByLabel("Start from").selectOption({ label: "Copy Cashier" });
  await expect(page.getByRole("checkbox", { name: /Use the point of sale/ })).toBeChecked();
  await page.getByRole("checkbox", { name: /View customers/ }).uncheck();
  await page.getByRole("button", { name: "Create role" }).click();
  await expect(page.getByRole("heading", { name: `E2E Role ${run}` })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /View customers/ })).not.toBeChecked();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete role" }).click();
  await expect(page.getByRole("heading", { name: "Roles" })).toBeVisible();
  await expect(page.getByRole("link", { name: `E2E Role ${run}` })).toHaveCount(0);
  await page.context().close();
});
