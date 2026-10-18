// Dev helper: node scripts/shot.mjs <path> <out.png> [--login email] [--mobile] [--dark]
import { chromium } from "@playwright/test";

const [, , path = "/", out = "shot.png", ...rest] = process.argv;
const base = process.env.BASE_URL ?? "http://localhost:3100";
const loginIdx = rest.indexOf("--login");
const email = loginIdx >= 0 ? rest[loginIdx + 1] : null;
const mobile = rest.includes("--mobile");
const dark = rest.includes("--dark");

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: dark ? "dark" : "light",
  locale: "ar-SY",
});
const page = await context.newPage();
if (email) {
  await page.goto(base + "/login");
  await page.fill("#identifier", email);
  await page.fill("#password", process.env.DEMO_PASSWORD ?? "Hayat-Demo-2026!");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/app\//, { timeout: 60000 });
}
await page.goto(base + path, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(800);
await page.screenshot({ path: out, fullPage: rest.includes("--full") });
await browser.close();
console.log("saved", out);
