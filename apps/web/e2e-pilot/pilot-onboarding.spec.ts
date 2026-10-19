import { createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { type Browser, expect, type Page, test } from "@playwright/test";

/**
 * Pilot onboarding against a PRODUCTION build (DEBUG off, MFA enforced, no demo data).
 * A fresh platform admin (created with `manage.py createsuperuser`) onboards a clinic and a
 * doctor exactly as on the real server: one-time setup link, licence verification, MFA,
 * then the doctor's first patient, visit and prescription. Synthetic data only.
 *   PILOT_ADMIN_EMAIL=… PILOT_ADMIN_PASSWORD=… npx playwright test -c playwright.pilot.config.ts
 */

const ADMIN_EMAIL = process.env.PILOT_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.PILOT_ADMIN_PASSWORD ?? "";
// Where the admin's MFA secret is kept between runs (a git-ignored, throwaway location).
const ADMIN_MFA_FILE = process.env.PILOT_ADMIN_MFA_FILE ?? "";
const run = Date.now().toString().slice(-6);
const DOCTOR_EMAIL = `doctor.${run}@pilot.hayattek.test`;
const DOCTOR_PASSWORD = `Pilot-${run}-Doctor!`;

// ---- RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — what an authenticator app computes. ----
function base32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
const lastStep = new Map<string, number>();
/** A code from a time step not used before for this secret (servers reject replays). */
async function totp(secret: string): Promise<string> {
  let step = Math.floor(Date.now() / 30_000);
  while (step <= (lastStep.get(secret) ?? -1)) {
    await new Promise((r) => setTimeout(r, 1_000));
    step = Math.floor(Date.now() / 30_000);
  }
  lastStep.set(secret, step);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function login(page: Page, email: string, password: string, mfaSecret?: string) {
  await page.goto("/login");
  await page.fill("#identifier", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  if (mfaSecret) {
    await page.locator("#otp").fill(await totp(mfaSecret));
    await page.click("button[type=submit]");
  }
  await page.waitForURL(/\/app(\/|$)/);
}

/** Enrol MFA from the security page (production refuses staff work until this is done). */
async function enrolMfa(page: Page): Promise<string> {
  await expect(page.getByText("حسابك يتطلب تفعيل المصادقة الثنائية.")).toBeVisible();
  await page.goto("/app/settings/security");
  await page.getByRole("button", { name: "بدء التفعيل" }).click();
  const secret = (await page.locator("code").first().innerText()).trim();
  await page.getByLabel("رمز التحقق").fill(await totp(secret));
  await page.getByRole("button", { name: "تفعيل", exact: true }).click();
  await expect(page.getByText("فُعّلت المصادقة الثنائية.")).toBeVisible();
  return secret;
}

async function newPage(browser: Browser) {
  const context = await browser.newContext();
  return context.newPage();
}

test("platform admin onboards a clinic and a doctor who then treats a first patient", async ({ browser }) => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "PILOT_ADMIN_EMAIL / PILOT_ADMIN_PASSWORD not set");
  test.setTimeout(300_000);

  // 1. Admin: first login on a production build must require MFA enrolment.
  const admin = await newPage(browser);
  if (ADMIN_MFA_FILE && existsSync(ADMIN_MFA_FILE)) {
    await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD, readFileSync(ADMIN_MFA_FILE, "utf8").trim());
  } else {
    await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
    const adminSecret = await enrolMfa(admin);
    if (ADMIN_MFA_FILE) writeFileSync(ADMIN_MFA_FILE, adminSecret);
    // …and the next login asks for the code.
    await admin.context().clearCookies();
    await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD, adminSecret);
  }

  // 2. Admin creates the clinic.
  const clinic = `عيادة تجريبية ${run}`;
  await admin.goto("/app/admin/organizations");
  await admin.getByRole("button", { name: "إضافة منشأة" }).first().click();
  const orgDialog = admin.getByRole("dialog");
  await orgDialog.getByLabel("اسم المنشأة").fill(clinic);
  await orgDialog.getByLabel("النوع").selectOption({ label: "عيادة خاصة" });
  await orgDialog.getByLabel("المحافظة").selectOption({ label: "الرقة" });
  await orgDialog.getByRole("button", { name: "إضافة", exact: true }).click();
  await admin.waitForURL(/\/app\/admin\/organizations\/[0-9a-f-]{36}/).catch(async () => {
    await admin.getByRole("link", { name: new RegExp(clinic) }).first().click();
  });
  await expect(admin.getByText(clinic).first()).toBeVisible();

  // 3. Admin adds the doctor (also facility admin) and receives the one-time setup link.
  await admin.getByRole("button", { name: "إضافة عضو" }).first().click();
  const memberDialog = admin.getByRole("dialog");
  await memberDialog.getByLabel("الاسم الكامل").fill(`أحمد تجريبي ${run}`);
  await memberDialog.getByLabel("البريد الإلكتروني").fill(DOCTOR_EMAIL);
  await memberDialog.getByRole("checkbox", { name: "طبيب", exact: true }).click();
  await memberDialog.getByRole("checkbox", { name: "مدير المنشأة", exact: true }).click();
  await memberDialog.getByLabel("الاختصاص").selectOption({ label: "طب عام" });
  await memberDialog.getByLabel("رقم الترخيص").fill(`TEST-${run}`);
  await memberDialog.getByRole("button", { name: "إضافة", exact: true }).click();
  await expect(admin.getByText("تم إنشاء الحساب")).toBeVisible();
  const setupLink = (await admin.getByRole("dialog").locator("code").innerText()).trim();
  expect(setupLink).toMatch(/\/reset-password\?/);
  await admin.getByRole("button", { name: "تم" }).click();

  // 4. Admin verifies the licence (doctors cannot open records before this).
  await admin.goto("/app/admin/practitioners");
  const card = admin.locator("div", { hasText: `أحمد تجريبي ${run}` })
    .filter({ has: admin.getByRole("button", { name: "اعتماد" }) }).last();
  await card.getByRole("button", { name: "اعتماد" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "اعتماد", exact: true }).click();
  await expect(admin.getByRole("dialog")).toBeHidden();

  // 5. Doctor opens the link from the clinic, sets a password, logs in, enrols MFA.
  const doctor = await newPage(browser);
  await doctor.goto(new URL(setupLink).pathname + new URL(setupLink).search);
  await doctor.locator("#password").fill(DOCTOR_PASSWORD);
  await doctor.locator("#confirm").fill(DOCTOR_PASSWORD);
  await doctor.getByRole("button", { name: "حفظ كلمة المرور" }).click();
  await expect(doctor.getByRole("link", { name: "تسجيل الدخول" }).or(doctor.getByRole("button", { name: "تسجيل الدخول" })).first()).toBeVisible();
  await login(doctor, DOCTOR_EMAIL, DOCTOR_PASSWORD);
  const doctorSecret = await enrolMfa(doctor);
  await doctor.context().clearCookies();
  await login(doctor, DOCTOR_EMAIL, DOCTOR_PASSWORD, doctorSecret);

  // 6. Doctor registers the first patient (a solo clinic has no receptionist).
  await doctor.goto("/app/patients/new");
  await doctor.getByLabel("الاسم الأول").fill("مريضة");
  await doctor.getByLabel("اسم الأب").fill(`تجريبي${run}`);
  await doctor.getByRole("radio", { name: "أنثى" }).click();
  await doctor.getByRole("button", { name: "إنشاء الملف" }).click();
  await expect(doctor.getByText("تم إنشاء الملف")).toBeVisible();
  await doctor.getByRole("link", { name: /فتح الملف|ملف المريض/ }).first().click()
    .catch(async () => {
      await doctor.keyboard.press("Control+k");
      await doctor.getByPlaceholder("اسم المريض، الرقم الصحي، أو رقم الهاتف").fill(`تجريبي${run}`);
      await doctor.getByRole("button", { name: new RegExp(`تجريبي${run}`) }).first().click();
    });
  await doctor.waitForURL(/\/app\/patients\/[0-9a-f-]{36}$/);
  const chartUrl = doctor.url();

  // 7. Visit → finalize.
  await doctor.getByRole("button", { name: "زيارة جديدة" }).first().click();
  await doctor.waitForURL(/\/app\/encounters\//);
  await doctor.getByLabel("سبب الزيارة").fill("حرارة وسعال");
  await doctor.getByLabel("التقييم / الانطباع").fill("التهاب بلعوم");
  await doctor.getByRole("button", { name: "اعتماد الزيارة" }).click();
  await doctor.getByRole("button", { name: "اعتماد", exact: true }).click();
  await expect(doctor.getByText("معتمد").first()).toBeVisible();

  // 8. Prescription with an empty production catalog → free text → finalize → print.
  await doctor.goto(chartUrl);
  await doctor.getByRole("link", { name: "وصفة" }).first().click();
  await doctor.waitForURL(/\/app\/prescriptions\/new/);
  await doctor.getByPlaceholder("ابحث عن دواء بالاسم التجاري أو العلمي…").fill("باراسيتامول 500");
  await doctor.getByRole("button", { name: /غير موجود في الكتالوج/ }).click();
  await doctor.getByRole("checkbox", { name: "صباحاً" }).click();
  await doctor.getByRole("checkbox", { name: "مساءً" }).click();
  const popup = doctor.waitForEvent("popup");
  await doctor.getByRole("button", { name: "اعتماد وطباعة" }).click();
  await doctor.getByRole("button", { name: "اعتماد وطباعة" }).last().click();
  const print = await popup;
  await expect(print.getByText("صادرة عبر منصة حياة")).toBeVisible();
  await expect(print.getByText(/باراسيتامول 500/)).toBeVisible();
  await expect(print.getByText(/رمز التحقق/)).toBeVisible();

  // 9. Records are on the chart; AI scribe is off for this new doctor by default.
  await doctor.goto(chartUrl);
  await expect(doctor.getByText("حرارة وسعال")).toBeVisible();
  await expect(doctor.getByText(/وصفة RX-/)).toBeVisible();
});
