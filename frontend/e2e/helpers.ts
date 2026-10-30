import { expect, type Page } from "@playwright/test";

/** Demo accounts from DemoDataSeeder (local database only). */
export const ACCOUNTS = {
  owner: { login: "owner", password: "password", name: "Store Owner" },
  manager: { login: "manager", password: "password", name: "Maria Santos" },
  cashier: { login: "cashier1", password: "password", name: "Juan Dela Cruz" },
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

/** Saved session of an account, written by auth.setup.ts (git-ignored). */
export function authFile(key: AccountKey): string {
  return `playwright/.auth/${key}.json`;
}

/** Signs in through the login form. Use only in tests about signing in; others use authFile(). */
export async function signIn(page: Page, account: (typeof ACCOUNTS)[AccountKey], path = "/") {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Username or email").fill(account.login);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("user-menu")).toContainText(account.name);
}

/** Opens a page with a saved session and waits until the app shell has loaded. */
export async function open(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.getByTestId("user-menu")).toBeVisible();
}
