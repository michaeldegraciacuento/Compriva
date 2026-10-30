import { test as setup } from "@playwright/test";

import { ACCOUNTS, authFile, signIn } from "./helpers";

/**
 * Signs in each demo account once and saves its session cookies, so specs can
 * start signed in. Logging in per test would trip the server's login rate
 * limit (5 per minute per account), which stays on in every environment.
 */
for (const key of Object.keys(ACCOUNTS) as (keyof typeof ACCOUNTS)[]) {
  setup(`sign in as ${key}`, async ({ page }) => {
    await signIn(page, ACCOUNTS[key]);
    await page.context().storageState({ path: authFile(key) });
  });
}
