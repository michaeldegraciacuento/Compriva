import { expect, test } from "@playwright/test";

import { authFile, open } from "./helpers";

test.use({ storageState: authFile("owner") });

test("system status detects the web platform and reaches the cloud API", async ({ page }) => {
  await open(page);
  await page.getByTestId("nav-System status").click();
  await expect(page).toHaveURL(/\/system$/);

  await expect(page.getByTestId("check-platform")).toHaveAttribute("data-state", "ok");
  await expect(page.getByTestId("check-platform")).toContainText("web (auth: cookie)");

  // Browsers get a terminal ID kept in local storage, so they can be registered as POS terminals.
  await expect(page.getByTestId("check-device")).toContainText("browser terminal ID");
  await expect(page.getByTestId("check-localDb")).toContainText("not applicable");

  // Cross-origin call localhost:3000 → localhost:8000 exercises CORS and the response envelope.
  await expect(page.getByTestId("check-api")).toHaveAttribute("data-state", "ok", { timeout: 15_000 });
  await expect(page.getByTestId("check-api")).toContainText("ok · API v1");
});
