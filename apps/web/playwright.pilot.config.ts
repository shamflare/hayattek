import { defineConfig } from "@playwright/test";

/**
 * Pilot checks against a PRODUCTION stack (infra/prodcheck locally, or the real server).
 * Locally hayattek.com is mapped to 127.0.0.1 and the self-signed certificate is accepted;
 * against the real server set PILOT_BASE_URL=https://hayattek.com and PILOT_LOCAL=0.
 */
const local = process.env.PILOT_LOCAL !== "0";

export default defineConfig({
  testDir: "./e2e-pilot",
  timeout: 300_000,
  expect: { timeout: 20_000 },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PILOT_BASE_URL ?? "https://hayattek.com:58443",
    locale: "ar-SY",
    viewport: { width: 1366, height: 900 },
    actionTimeout: 30_000,
    ignoreHTTPSErrors: local,
    launchOptions: local ? { args: ["--host-resolver-rules=MAP hayattek.com 127.0.0.1"] } : {},
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
