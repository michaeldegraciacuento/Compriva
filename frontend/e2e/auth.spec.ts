import { expect, test } from "@playwright/test";

import { ACCOUNTS, authFile, open, signIn } from "./helpers";

/**
 * Web app authentication against the real Laravel API (Sanctum cookie session).
 * Requires the local database seeded with demo data (php artisan db:seed).
 */

test.describe("signing in", () => {
  test("protected routes redirect to login and return afterwards", async ({ page }) => {
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login\?next=%2Fprofile$/);

    await page.getByLabel("Username or email").fill(ACCOUNTS.manager.login);
    await page.getByLabel("Password").fill(ACCOUNTS.manager.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole("heading", { name: "My profile" })).toBeVisible();
    await expect(page.getByTestId("profile-roles")).toContainText("manager");
  });

  test("wrong credentials show one generic message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username or email").fill("owner");
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("The username or password is incorrect.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("sign out ends the session", async ({ page }) => {
    // Signs in through the form: signing out must not invalidate the shared saved session.
    await signIn(page, ACCOUNTS.owner);

    await page.getByTestId("user-menu").click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("as the owner", () => {
  test.use({ storageState: authFile("owner") });

  test("owner sees administration modules", async ({ page }) => {
    await open(page);

    for (const label of ["Users", "Roles", "Terminals & sync", "Settings", "Reports"]) {
      await expect(page.getByTestId(`nav-${label}`)).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  });
});

test.describe("as a cashier", () => {
  test.use({ storageState: authFile("cashier") });

  test("cashier sees only cashier modules", async ({ page }) => {
    await open(page);

    await expect(page.getByTestId("nav-Point of Sale")).toBeVisible();
    for (const label of ["Users", "Roles", "Devices", "Settings", "Reports", "Inventory"]) {
      await expect(page.getByTestId(`nav-${label}`)).toHaveCount(0);
    }
  });

  test("the API refuses what the UI hides", async ({ page }) => {
    await open(page);

    // Same browser session, calling an admin endpoint directly.
    const status = await page.evaluate(async () => {
      const response = await fetch("http://localhost:8000/api/v1/users", { credentials: "include", headers: { Accept: "application/json" } });
      return { code: response.status, body: await response.json() };
    });

    expect(status.code).toBe(403);
    expect(status.body.error.code).toBe("FORBIDDEN");
  });
});
