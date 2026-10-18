import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests against a running stack (docker compose + Django on :8100 + Next on :3100)
 * seeded with `manage.py seed_demo`. Synthetic data only.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3100",
    locale: "ar-SY",
    viewport: { width: 1366, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
