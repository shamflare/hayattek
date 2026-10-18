/**
 * End-to-end check of HayatTek AI + «حسابي المالي» on the Expo web build (dev only,
 * synthetic data only).
 *
 *   node scripts/scribe-wallet.cjs [outDir] [baseUrl] [apiUrl]
 *
 * Chromium runs with a FAKE microphone (`--use-fake-device-for-media-stream`), so the real
 * recorder -> WAV -> multipart upload path is exercised in the browser. Native Android/iOS
 * capture (expo-audio AudioStream) can only be verified on a device: docs/MOBILE_TEST_PLAN.md.
 *
 * Flow A (visit 1): dictation recorded from the fake mic, pause/resume, the first upload is
 *   aborted on purpose (simulated network drop) -> retry with the same client_key -> the API
 *   must still show ONE session for the encounter. Offline banner + disabled actions.
 * Flow B (visit 2): synthetic sample (conversation, consent) -> review -> toggles -> approve
 *   -> back on the visit with the draft-prescription notice. Then the wallet screen.
 */
const path = require("path");
const fs = require("fs");

const { chromium } = require(path.resolve(__dirname, "../../web/node_modules/@playwright/test"));

const OUT = process.argv[2] || path.resolve(__dirname, "../.screenshots");
const BASE = process.argv[3] || "http://localhost:8081";
const API = process.argv[4] || "http://127.0.0.1:8100";
const PASSWORD = "Hayat-Demo-2026!";
const PATIENT_HEALTH_NUMBER = process.env.HAYAT_PATIENT_HN || "2314504354";

fs.mkdirSync(OUT, { recursive: true });
const problems = [];
const checks = [];
const ok = (name, cond, detail = "") => {
  checks.push(`${cond ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) problems.push(`[check] ${name} ${detail}`);
};

const tid = (page, id) => page.locator(`[data-testid="${id}"]:visible`).first();
const idle = (p) => p.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
async function shot(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("saved", name);
}

async function apiToken() {
  const r = await fetch(`${API}/api/v1/auth/token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "doctor@hayattek.test", password: PASSWORD, device_name: "b5-e2e-check" }),
  });
  const j = await r.json();
  const membership = j.user.memberships.find((m) => (m.roles || []).includes("physician"));
  return { token: j.token, membership: membership.id };
}
async function apiGet(auth, p) {
  const r = await fetch(`${API}${p}`, { headers: { Authorization: `Token ${auth.token}`, "X-Hayat-Membership": auth.membership } });
  return r.json();
}

async function openVisit(page, reason) {
  await tid(page, "clinician-manual").fill(PATIENT_HEALTH_NUMBER);
  await tid(page, "clinician-identify").click();
  await tid(page, "clinician-patient").waitFor({ timeout: 20_000 });
  await tid(page, "clinician-new-visit").click();
  await tid(page, "clinician-visit").waitFor();
  await tid(page, "visit-reason").fill(reason);
}

(async () => {
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const auth = await apiToken();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light", locale: "ar-SY", permissions: ["microphone"] });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));
    page.on("requestfailed", (r) => problems.push(`[requestfailed] ${r.method()} ${r.url()} ${r.failure()?.errorText}`));
    page.on("console", (m) => { if (m.type() === "error") problems.push(`[console] ${m.text().slice(0, 300)}`); });

    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await tid(page, "login-identifier").waitFor({ timeout: 90_000 });
    await tid(page, "login-identifier").fill("doctor@hayattek.test");
    await tid(page, "login-password").fill(PASSWORD);
    await tid(page, "login-submit").click();
    await tid(page, "home-greeting").waitFor({ timeout: 30_000 });
    ok("dir=rtl", (await page.evaluate(() => document.documentElement.dir)) === "rtl");
    await page.getByRole("tab", { name: "المزيد" }).or(page.getByRole("link", { name: "المزيد" })).first().click();
    await tid(page, "enter-clinician-mode").click();
    await tid(page, "clinician-home").waitFor();

    /* ---------------------------------------------------------------- Flow A */
    await openVisit(page, "اختبار تسجيل HayatTek AI من الموبايل (تجريبي)");
    await tid(page, "visit-ai").waitFor({ timeout: 20_000 });
    await shot(page, "b5-01-visit-ai-entry");
    await tid(page, "visit-ai-open").click();
    await tid(page, "scribe-screen").waitFor({ timeout: 20_000 });
    const encA = new URL(page.url()).searchParams.get("encounter");
    ok("scribe screen opened with a draft encounter", !!encA, encA || "");
    await idle(page);
    await shot(page, "b5-02-scribe-setup-conversation");

    // Consent is mandatory for conversation mode.
    await tid(page, "scribe-start").click();
    await page.getByText("سجّل موافقة المريض على التسجيل أولاً", { exact: false }).first().waitFor({ timeout: 5000 });
    ok("conversation without consent is refused locally", true);

    await page.getByText("الإملاء الذكي", { exact: true }).first().click();
    await tid(page, "scribe-start").click();
    await tid(page, "scribe-indicator").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(2600);
    await shot(page, "b5-03-recording");
    await tid(page, "scribe-pause").click();
    await page.waitForTimeout(500);
    const t1 = await tid(page, "scribe-timer").innerText();
    await page.waitForTimeout(1500);
    const t2 = await tid(page, "scribe-timer").innerText();
    ok("pause stops the timer", t1 === t2, `${t1} / ${t2}`);
    await shot(page, "b5-04-paused");
    await tid(page, "scribe-resume").click();
    await page.waitForTimeout(1500);

    // Simulate a network drop on the first upload attempt.
    let aborted = 0;
    await page.route("**/api/v1/scribe/sessions/*/audio", async (route) => {
      if (aborted === 0) { aborted++; return route.abort("internetdisconnected"); }
      return route.continue();
    });
    let uploadBody = null;
    page.on("request", (r) => { if (r.url().endsWith("/audio") && r.method() === "POST") uploadBody = r.postDataBuffer(); });
    await tid(page, "scribe-finish").click();
    await tid(page, "scribe-upload-retry").waitFor({ timeout: 20_000 });
    await shot(page, "b5-05-upload-failed");
    const afterDrop = await apiGet(auth, `/api/v1/scribe/sessions?encounter=${encA}`);
    ok("one session after the dropped upload", afterDrop.count === 1, `count=${afterDrop.count} status=${afterDrop.results?.[0]?.status}`);

    // Offline: banner + retry disabled.
    await ctx.setOffline(true);
    const banner = page.locator('[data-testid="offline-banner"]:visible').first();
    await banner.waitFor({ timeout: 10_000 });
    const retryDisabled = await tid(page, "scribe-upload-retry").getAttribute("aria-disabled");
    ok("retry disabled while offline", retryDisabled === "true", `aria-disabled=${retryDisabled}`);
    await shot(page, "b5-06-offline");
    await ctx.setOffline(false);
    await banner.waitFor({ state: "hidden", timeout: 15_000 });

    await tid(page, "scribe-upload-retry").click();
    await tid(page, "scribe-session").waitFor({ timeout: 30_000 });
    const final = await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="scribe-session-status"]');
      return el && /جاهزة|تعذرت/.test(el.textContent) ? el.textContent : null;
    }, null, { timeout: 60_000 }).then((h) => h.jsonValue());
    ok("fake-mic recording processed", /جاهزة/.test(final), final);
    if (uploadBody) {
      const i = uploadBody.indexOf(Buffer.from("RIFF"));
      const wav = uploadBody.subarray(i);
      const rate = wav.readUInt32LE(24), ch = wav.readUInt16LE(22), bits = wav.readUInt16LE(34), fmt = wav.readUInt16LE(20);
      ok("uploaded file is WAV PCM 16 kHz mono 16-bit", fmt === 1 && rate === 16000 && ch === 1 && bits === 16, `fmt=${fmt} rate=${rate} ch=${ch} bits=${bits}`);
    } else {
      problems.push("[check] could not capture the upload body");
    }
    const afterRetry = await apiGet(auth, `/api/v1/scribe/sessions?encounter=${encA}`);
    ok("still ONE session after retry (client_key idempotency)", afterRetry.count === 1,
      `count=${afterRetry.count} status=${afterRetry.results?.[0]?.status} seconds=${afterRetry.results?.[0]?.audio_seconds}`);
    await shot(page, "b5-07-session-ready");
    // Clean up flow A: discard (deletes the synthetic audio).
    await page.getByText("تجاهل وحذف التسجيل", { exact: true }).first().click();
    await tid(page, "scribe-start").waitFor({ timeout: 20_000 });
    await page.goBack();
    await tid(page, "clinician-visit").waitFor();
    await page.goBack();
    await tid(page, "clinician-patient").waitFor();
    await page.goBack();
    await tid(page, "clinician-home").waitFor();

    /* ---------------------------------------------------------------- Flow B */
    await openVisit(page, "اختبار عينة اصطناعية HayatTek AI (تجريبي)");
    await tid(page, "visit-ai-open").click();
    await tid(page, "scribe-screen").waitFor({ timeout: 20_000 });
    const encB = new URL(page.url()).searchParams.get("encounter");
    await page.getByText("وافق شفهياً", { exact: true }).first().click();
    await tid(page, "scribe-sample-chest_pain_conversation").click();
    await tid(page, "scribe-samples").scrollIntoViewIfNeeded();
    await shot(page, "b5-08-sample-picker");
    await tid(page, "scribe-sample-use").click();
    await tid(page, "scribe-open-review").waitFor({ timeout: 60_000 });
    await shot(page, "b5-09-sample-ready");
    await tid(page, "scribe-open-review").click();
    await tid(page, "scribe-review").waitFor({ timeout: 20_000 });
    await idle(page);
    await shot(page, "b5-10-review-top");
    await tid(page, "review-vital-bp_systolic").scrollIntoViewIfNeeded();
    await shot(page, "b5-10b-review-vitals");
    await tid(page, "review-diagnoses").scrollIntoViewIfNeeded();
    await shot(page, "b5-11-review-diagnoses");
    await tid(page, "review-meds").scrollIntoViewIfNeeded();
    await shot(page, "b5-12-review-meds");
    await tid(page, "review-assessment").fill("اشتباه ذبحة صدرية مستقرة — بانتظار الفحوص (تجريبي)");
    await tid(page, "review-approve").scrollIntoViewIfNeeded();
    await shot(page, "b5-13-review-approve");

    let approveBody = null;
    page.on("request", (r) => { if (r.url().endsWith("/approve")) approveBody = r.postDataJSON(); });
    await tid(page, "review-approve").click();
    await tid(page, "confirm-dialog-ok").last().click();
    await tid(page, "visit-ai-applied").waitFor({ timeout: 30_000 });
    await idle(page);
    await shot(page, "b5-14-visit-applied");
    ok("approve payload has the web shape", !!approveBody && Array.isArray(approveBody.prescription_items) && Array.isArray(approveBody.orders) && approveBody.finalize_encounter === false,
      approveBody ? Object.keys(approveBody).join(",") : "none");
    const sessB = await apiGet(auth, `/api/v1/scribe/sessions?encounter=${encB}`);
    const applied = sessB.results?.[0]?.applied || {};
    ok("session approved", sessB.results?.[0]?.status === "approved", sessB.results?.[0]?.status);
    if (applied.prescription) {
      const rx = await apiGet(auth, `/api/v1/prescriptions/${applied.prescription}`);
      ok("prescription stays a DRAFT", rx.status === "draft", rx.status);
    }
    const enc = await apiGet(auth, `/api/v1/clinical/encounters/${encB}`);
    ok("encounter updated by approval", /HayatTek AI/.test(enc.notes || "") && enc.status === "draft", `status=${enc.status}`);
    ok("visit form reloaded from server", (await tid(page, "visit-assessment").inputValue()).includes("ذبحة"));

    /* ---------------------------------------------------------------- Wallet */
    await page.goBack();
    await tid(page, "clinician-patient").waitFor();
    await page.goBack();
    await tid(page, "clinician-home").waitFor();
    await tid(page, "clinician-wallet").click();
    await tid(page, "wallet-balance").waitFor({ timeout: 20_000 });
    await idle(page);
    await shot(page, "b5-15-wallet");
    const me = await apiGet(auth, "/api/v1/billing/me");
    const shown = await tid(page, "wallet-balance-value").innerText();
    ok("wallet balance matches the server", shown.replace(/[^\d.]/g, "") === me.balance.replace("-", ""), `${shown} vs ${me.balance}`);
    await page.mouse.wheel(0, 900);
    await shot(page, "b5-16-wallet-statement");

    /* ---------------------------------------------------------------- Flow C: offline, cached data */
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SY" });
    const pat = await pctx.newPage();
    await pat.goto(BASE, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await tid(pat, "login-identifier").waitFor({ timeout: 90_000 });
    await pctx.setOffline(true);
    await pat.locator('[data-testid="offline-banner"]:visible').first().waitFor({ timeout: 10_000 });
    ok("login disabled while offline", (await tid(pat, "login-submit").getAttribute("aria-disabled")) === "true");
    await shot(pat, "b5-17-login-offline");
    await pctx.setOffline(false);
    await pat.locator('[data-testid="offline-banner"]:visible').first().waitFor({ state: "hidden", timeout: 15_000 });
    await tid(pat, "login-identifier").fill("patient@hayattek.test");
    await tid(pat, "login-password").fill(PASSWORD);
    await tid(pat, "login-submit").click();
    await tid(pat, "home-greeting").waitFor({ timeout: 30_000 });
    await pat.getByRole("tab", { name: "السجل" }).or(pat.getByRole("link", { name: "السجل" })).first().click();
    await pat.locator('[data-testid="timeline-list"] [data-testid^="timeline-"]').first().waitFor({ timeout: 20_000 });
    const before = await pat.locator('[data-testid="timeline-list"] [data-testid^="timeline-"]').count();
    await pctx.setOffline(true);
    await pat.locator('[data-testid="offline-banner"]:visible').first().waitFor({ timeout: 10_000 });
    const after = await pat.locator('[data-testid="timeline-list"] [data-testid^="timeline-"]').count();
    ok("cached timeline stays visible offline", after > 0 && after === before, `${before} -> ${after}`);
    await shot(pat, "b5-18-timeline-offline-cached");
    await pctx.setOffline(false);
    await pctx.close();
  } catch (e) {
    problems.push(`[script] ${e.stack || e}`);
    for (const p of browser.contexts().flatMap((c) => c.pages())) await p.screenshot({ path: path.join(OUT, "b5-error.png") }).catch(() => {});
  } finally {
    await browser.close();
  }
  console.log(checks.join("\n"));
  console.log(problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "No problems.");
})();
