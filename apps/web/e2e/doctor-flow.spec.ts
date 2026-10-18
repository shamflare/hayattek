import { expect, type Page, test } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Hayat-Demo-2026!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#identifier", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/app\//);
}

test("reception registers a patient, doctor writes a visit and prints a prescription", async ({ browser }) => {
  const unique = `اختبار${Date.now().toString().slice(-6)}`;

  // 1. Reception creates the file.
  const desk = await browser.newPage();
  await login(desk, "reception@hayattek.test");
  await desk.goto("/app/patients/new");
  await desk.getByLabel("الاسم الأول").fill("مريض");
  await desk.getByLabel("اسم الأب").fill(unique);
  await desk.getByRole("radio", { name: "أنثى" }).click();
  await desk.getByRole("button", { name: "إنشاء الملف" }).click();
  // Earlier runs may have left similar names: the duplicate check must then ask first.
  const duplicate = desk.getByRole("button", { name: /ليس أحدهم/ });
  const created = desk.getByText("تم إنشاء الملف");
  await expect(duplicate.or(created)).toBeVisible();
  if (await duplicate.isVisible()) await duplicate.click();
  await expect(created).toBeVisible();
  // Reception must not see clinical data.
  await expect(desk.getByText("لا تظهر المعلومات الطبية لدورك")).toBeVisible();
  await desk.close();

  // 2. Doctor finds the patient with the quick search.
  const page = await browser.newPage();
  await login(page, "doctor@hayattek.test");
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("اسم المريض، الرقم الصحي، أو رقم الهاتف").fill(unique);
  await page.getByRole("button", { name: new RegExp(unique) }).first().click();
  await page.waitForURL(/\/app\/patients\/[0-9a-f-]{36}$/);
  const chartUrl = page.url();

  // 3. New visit → finalize.
  await page.getByRole("button", { name: "زيارة جديدة" }).first().click();
  await page.waitForURL(/\/app\/encounters\//);
  await page.getByLabel("سبب الزيارة").fill("صداع متكرر");
  await page.getByLabel("التقييم / الانطباع").fill("صداع توتري");
  await page.getByRole("button", { name: "اعتماد الزيارة" }).click();
  await page.getByRole("button", { name: "اعتماد", exact: true }).click();
  await expect(page.getByText("معتمد").first()).toBeVisible();

  // 4. Prescription from favorites → finalize → print opens.
  await page.goto(chartUrl);
  await page.getByRole("link", { name: "وصفة" }).first().click();
  await page.waitForURL(/\/app\/prescriptions\/new/);
  await page.getByRole("button", { name: /دواء تجريبي — سكري/ }).first().click();
  await page.getByRole("checkbox", { name: "صباحاً" }).click();
  await page.getByRole("checkbox", { name: "مساءً" }).click();
  await expect(page.getByText(/صباحاً ومساءً/)).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "اعتماد وطباعة" }).click();
  await page.getByRole("button", { name: "اعتماد وطباعة" }).last().click();
  const print = await popup;
  await expect(print.getByText("صادرة عبر منصة حياة")).toBeVisible();
  await expect(print.getByText(/دواء تجريبي — سكري/)).toBeVisible();
  await expect(print.getByText(/رمز التحقق/)).toBeVisible();

  // 5. Both records appear on the chart timeline.
  await page.goto(chartUrl);
  await expect(page.getByText("صداع متكرر")).toBeVisible();
  await expect(page.getByText(/وصفة RX-/)).toBeVisible();
});
