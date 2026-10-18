/**
 * PHASE2 acceptance scenario (25 steps): HayatTek AI + postpaid wallet, end to end through the
 * real UI → Django → PostgreSQL. The AI provider is the mock with a synthetic recording; the
 * wallet logic is real. Requires `manage.py seed_demo` and the running dev stack.
 */
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Hayat-Demo-2026!";

async function login(browser: Browser, email: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto("/login");
  await page.fill("#identifier", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/app\//);
  return page;
}

async function wallet(request: APIRequestContext, practitionerId: string) {
  const r = await request.get(`/api/v1/billing/admin/practitioners/${practitionerId}`);
  expect(r.ok()).toBeTruthy();
  return r.json() as Promise<{ balance: string; amount_due: string; ai_enabled: boolean; total_charges: string }>;
}

async function newVisitForDemoPatient(doctor: Page) {
  await doctor.goto("/app/patients");
  await doctor.getByPlaceholder("ابحث بالاسم الثلاثي أو الرقم الصحي أو رقم الهاتف").fill("مريض تجريبي أول");
  await doctor.getByRole("link", { name: /مريض تجريبي أول/ }).first().click();
  await doctor.waitForURL(/\/app\/patients\/[0-9a-f-]{36}$/);
  await doctor.getByRole("button", { name: "زيارة جديدة" }).first().click();
  await doctor.waitForURL(/\/app\/encounters\/[0-9a-f-]{36}$/);
}

async function runSyntheticConversation(doctor: Page) {
  await doctor.getByRole("radio", { name: "وافق شفهياً" }).click();
  await doctor.locator("select").filter({ hasText: "اختر تسجيلاً" }).selectOption("chest_pain_conversation");
  await doctor.getByRole("button", { name: "استخدام" }).click();
  await expect(doctor.getByRole("link", { name: "مراجعة المسودة الذكية" })).toBeVisible({ timeout: 60_000 });
}

test("HayatTek AI + postpaid wallet acceptance (25 steps)", async ({ browser }) => {
  test.setTimeout(300_000);

  // 1-3. Super Admin opens the wallets section and picks the doctor.
  const admin = await login(browser, "admin@hayattek.test");
  await admin.goto("/app/admin/wallets");
  await admin.getByRole("link", { name: "د. أحمد التجريبي" }).click();
  await admin.waitForURL(/\/app\/admin\/wallets\/[0-9a-f-]{36}$/);
  const practitionerId = admin.url().split("/").pop()!;

  // 4. Enable HayatTek AI for him (idempotent across reruns).
  if ((await wallet(admin.request, practitionerId)).ai_enabled === false) {
    await admin.getByRole("button", { name: "تفعيل الخدمة" }).click();
    await admin.getByRole("button", { name: "تفعيل", exact: true }).click();
  }
  await expect(admin.getByRole("button", { name: "إيقاف الخدمة" })).toBeVisible();

  // 5. Set the per-minute price.
  await admin.getByRole("button", { name: "تعديل السعر" }).click();
  await admin.getByLabel("سعر الدقيقة (USD)").fill("0.10");
  await admin.getByRole("button", { name: "حفظ" }).click();
  await expect(admin.getByText("حُدّث السعر للجلسات القادمة")).toBeVisible();
  const before = await wallet(admin.request, practitionerId);

  // 6-8. Doctor signs in, opens a test patient and creates a visit.
  const doctor = await login(browser, "doctor@hayattek.test");
  await newVisitForDemoPatient(doctor);

  // 9-11. Smart listening with a synthetic test recording; processing runs.
  await runSyntheticConversation(doctor);

  // 12-13. A structured draft appears; the doctor reviews and edits it.
  await doctor.getByRole("link", { name: "مراجعة المسودة الذكية" }).click();
  await doctor.waitForURL(/\/scribe\//);
  await expect(doctor.getByText("ما قيل في التسجيل")).toBeVisible();
  await expect(doctor.getByText(/وجع بصدري/).first()).toBeVisible();
  await expect(doctor.getByText("مشتبه — ليس تشخيصاً نهائياً")).toBeVisible();
  await doctor.getByLabel("سبب الزيارة").fill("ألم صدري جهدي");
  await doctor.getByLabel("التقييم (بقلمك)").fill("ذبحة صدرية مستقرة محتملة — للتأكيد بالفحوص");

  // 14. Approve it into the medical record (visit finalized by the doctor's explicit choice).
  await doctor.getByText("اعتماد الزيارة مباشرة بعد التطبيق").click();
  await doctor.getByRole("button", { name: "تطبيق على الزيارة" }).click();
  await doctor.getByRole("button", { name: "تطبيق", exact: true }).click();
  await doctor.waitForURL(/\/app\/(prescriptions|encounters)\//);
  // The AI-proposed prescription is only a DRAFT awaiting the doctor's own approval.
  if (doctor.url().includes("/prescriptions/")) {
    await expect(doctor.getByText("مسودة وصفة")).toBeVisible();
  }

  // 15-17. The usage fee lands in the wallet and the admin sees the right debt.
  const afterUse = await wallet(admin.request, practitionerId);
  const charged = Number(before.balance) - Number(afterUse.balance);
  expect(charged).toBeCloseTo(0.2, 2); // 80 s → 2 billable minutes × 0.10
  await doctor.goto("/app/wallet");
  await expect(doctor.getByText("الرصيد الحالي")).toBeVisible();
  await expect(doctor.getByText("استهلاك الذكاء الاصطناعي").first()).toBeVisible();
  await admin.goto("/app/admin/wallets");
  await expect(admin.getByText("إجمالي الديون المستحقة")).toBeVisible();

  // 18-19. Record a partial payment; the balance moves correctly.
  await admin.goto(`/app/admin/wallets/${practitionerId}`);
  await admin.getByRole("button", { name: "تسجيل دفعة" }).click();
  await admin.getByLabel("المبلغ المستلم (USD)").fill("0.10");
  await admin.getByRole("button", { name: "تأكيد" }).click();
  await expect(admin.getByText("المتبقي على الطبيب")).toBeVisible();
  await admin.getByRole("button", { name: "تم" }).click();
  const afterPay = await wallet(admin.request, practitionerId);
  expect(Number(afterPay.balance) - Number(afterUse.balance)).toBeCloseTo(0.1, 2);
  expect(Number(afterPay.balance)).toBeLessThan(0); // still owes money

  // 20. Still in debt, the doctor keeps using the service.
  await newVisitForDemoPatient(doctor);
  await expect(doctor.getByRole("button", { name: "بدء الاستماع الذكي" })).toBeVisible();

  // 21-22. Manual stop by the Super Admin blocks new sessions.
  await admin.getByRole("button", { name: "إيقاف الخدمة" }).click();
  await admin.getByLabel("السبب").fill("اختبار القبول");
  await admin.getByRole("button", { name: "إيقاف", exact: true }).click();
  await expect(admin.getByRole("button", { name: "تفعيل الخدمة" })).toBeVisible();
  await doctor.reload();
  await expect(doctor.getByText("الخدمة غير مفعلة لحسابك")).toBeVisible();

  // 23-24. Re-enable; the doctor can use it again.
  await admin.getByRole("button", { name: "تفعيل الخدمة" }).click();
  await admin.getByRole("button", { name: "تفعيل", exact: true }).click();
  await expect(admin.getByRole("button", { name: "إيقاف الخدمة" })).toBeVisible();
  await doctor.reload();
  await runSyntheticConversation(doctor);
  const afterSecond = await wallet(admin.request, practitionerId);
  expect(Number(afterPay.balance) - Number(afterSecond.balance)).toBeCloseTo(0.2, 2);
  // Step 25 = the backend suites (tests/test_wallet.py, tests/test_scribe.py).
});
