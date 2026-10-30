import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the real web app against the real Laravel API.
 * Requires the database server (XAMPP MySQL) to be running.
 * Existing dev servers on :8000 / :3000 are reused locally.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    // Signs in each demo account once (e2e/auth.setup.ts); specs reuse the saved sessions.
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  webServer: [
    {
      command: "php artisan serve --port=8000",
      cwd: "../backend",
      url: "http://127.0.0.1:8000/up",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "npm run dev",
      // A light page: the first compile of "/" can be slow on a cold cache.
      url: "http://localhost:3000/login",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
