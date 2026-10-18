/**
 * Visual smoke test of the Expo web build (dev only).
 *
 *   node scripts/screenshots.cjs [outDir] [baseUrl]
 *
 * Logs in with the synthetic demo accounts and screenshots the main patient and
 * clinician screens at 390x844. Uses the Playwright copy installed for apps/web.
 */
const path = require("path");
const fs = require("fs");

const { chromium } = require(path.resolve(__dirname, "../../web/node_modules/@playwright/test"));

const OUT = process.argv[2] || path.resolve(__dirname, "../.screenshots");
const BASE = process.argv[3] || "http://localhost:8081";
const PASSWORD = "Hayat-Demo-2026!";
const PATIENT_HEALTH_NUMBER = process.env.HAYAT_PATIENT_HN || "2314504354";

fs.mkdirSync(OUT, { recursive: true });
const problems = [];

async function newPage(browser, scheme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, locale: "ar-SY" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`[console] ${m.text().slice(0, 300)}`);
  });
  return page;
}

const idle = (p) => p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
const tid = (page, id) => page.locator(`[data-testid="${id}"]`).first();

async function shot(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("saved", name);
}

async function login(page, email) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await tid(page, "login-identifier").waitFor({ timeout: 60_000 });
  await tid(page, "login-identifier").fill(email);
  await tid(page, "login-password").fill(PASSWORD);
  await tid(page, "login-submit").click();
}

async function tab(page, label) {
  await page.getByRole("tab", { name: label }).or(page.getByRole("link", { name: label })).first().click();
}

(async () => {
  const browser = await chromium.launch();
  try {
    /* ------------------------------------------------------------- patient */
    const page = await newPage(browser, "light");
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await tid(page, "login-identifier").waitFor({ timeout: 90_000 });
    await shot(page, "m00-login");
    await login(page, "patient@hayattek.test");
    await tid(page, "home-greeting").waitFor({ timeout: 30_000 });
    await idle(page);
    await shot(page, "m01-home");

    await tab(page, "بطاقتي");
    await tid(page, "card-health-number").waitFor();
    await idle(page);
    await shot(page, "m02-card");

    await tab(page, "السجل");
    await page.locator('[data-testid^="timeline-"]').first().waitFor({ timeout: 20_000 });
    await shot(page, "m03-timeline");

    // Open each detail type that exists in the demo data.
    for (const type of ["prescription", "lab_report", "encounter", "document"]) {
      const row = page.locator(`[data-testid="timeline-${type}"]`).first();
      if (await row.count()) {
        await row.click();
        await tid(page, "record-detail").waitFor({ timeout: 20_000 });
        await idle(page);
        await shot(page, `m04-detail-${type}`);
        await page.goBack();
        await page.locator('[data-testid^="timeline-"]').first().waitFor();
      }
    }

    await tab(page, "المشاركة");
    await tid(page, "consent-screen").waitFor();
    await idle(page);
    await shot(page, "m05-consent-requests");
    await tid(page, "segment-grants").click();
    await shot(page, "m06-consent-grants");
    await tid(page, "segment-log").click();
    await idle(page);
    await shot(page, "m07-consent-log");

    await tab(page, "المزيد");
    await tid(page, "more-screen").waitFor();
    await shot(page, "m08-more");

    await page.getByText("الوصفات", { exact: true }).first().click();
    await tid(page, "prescriptions-list").waitFor({ timeout: 20_000 }).catch(() => {});
    await shot(page, "m09-prescriptions");
    await page.goBack();
    await page.getByText("التحاليل", { exact: true }).first().click();
    await idle(page);
    await shot(page, "m10-labs");
    await page.goBack();
    await page.getByText("المستندات", { exact: true }).first().click();
    await idle(page);
    await shot(page, "m11-documents");
    await page.goBack();
    await page.getByText("الإشعارات", { exact: true }).first().click();
    await idle(page);
    await shot(page, "m12-notifications");
    await page.close();

    /* ------------------------------------------------------------- dark */
    const dark = await newPage(browser, "dark");
    await login(dark, "patient@hayattek.test");
    await tid(dark, "home-greeting").waitFor({ timeout: 30_000 });
    await idle(dark);
    await shot(dark, "m13-home-dark");
    await tab(dark, "بطاقتي");
    await tid(dark, "card-health-number").waitFor();
    await idle(dark);
    await shot(dark, "m14-card-dark");
    await dark.close();

    /* ------------------------------------------------------------- clinician */
    const doc = await newPage(browser, "light");
    await login(doc, "doctor@hayattek.test");
    await tid(doc, "home-greeting").waitFor({ timeout: 30_000 });
    await tab(doc, "المزيد");
    await tid(doc, "enter-clinician-mode").waitFor({ timeout: 20_000 });
    await shot(doc, "c01-more-doctor");
    await tid(doc, "enter-clinician-mode").click();
    await tid(doc, "clinician-home").waitFor();
    await shot(doc, "c02-clinician-home");
    await tid(doc, "clinician-manual").fill(PATIENT_HEALTH_NUMBER);
    await tid(doc, "clinician-identify").click();
    await tid(doc, "clinician-patient").waitFor({ timeout: 20_000 });
    await idle(doc);
    await shot(doc, "c03-patient");
    await doc.mouse.wheel(0, 900);
    await shot(doc, "c04-patient-scrolled");
    if (await tid(doc, "clinician-new-visit").count()) {
      await tid(doc, "clinician-new-visit").click();
      await tid(doc, "clinician-visit").waitFor();
      await tid(doc, "visit-reason").fill("زيارة اختبار من تطبيق الموبايل (تجريبي)");
      await shot(doc, "c05-visit");
      await doc.goBack();
      await tid(doc, "clinician-new-rx").click();
      await tid(doc, "clinician-prescribe").waitFor();
      await idle(doc);
      const fav = doc.locator('[data-testid="favorite-option"]').first();
      if (await fav.count()) {
        await fav.click();
        await doc.waitForTimeout(1200);
      }
      await shot(doc, "c06-prescribe");
      await doc.mouse.wheel(0, 700);
      await shot(doc, "c07-prescribe-scrolled");
    } else {
      problems.push("[flow] doctor cannot author for this patient (no new-visit button)");
    }
    await doc.close();
  } catch (e) {
    problems.push(`[script] ${e.stack || e}`);
  } finally {
    await browser.close();
  }
  console.log(problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "No console/page errors.");
})();
