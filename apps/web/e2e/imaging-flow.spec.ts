import { expect, type Page, test } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Hayat-Demo-2026!";
const IMAGING_CENTER = "مركز الرقة للتصوير الطبي (تجريبي)";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#identifier", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/app\//);
}

/** Same-origin API call from the signed-in page (session cookie + CSRF + practice context). */
async function apiCall<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  return page.evaluate(async ({ method, path, body }) => {
    const csrf = document.cookie.split("; ").find((c) => c.startsWith("hayat_csrftoken="))?.split("=")[1];
    const membership = window.localStorage.getItem("hayat.membership");
    const res = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRFToken": decodeURIComponent(csrf) } : {}),
        ...(membership ? { "X-Hayat-Membership": membership } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  }, { method, path, body });
}

test("doctor orders imaging, imaging center drafts, finalizes and prints the report", async ({ browser }) => {
  const site = `الصدر ${Date.now().toString().slice(-5)}`;

  // 1. Doctor orders a chest X-ray for the demo patient at the demo imaging center (API).
  const doctor = await browser.newPage();
  await login(doctor, "doctor@hayattek.test");
  const patients = await apiCall<{ results: { id: string; full_name: string }[] }>(
    doctor, "GET", `/api/v1/patients?q=${encodeURIComponent("مريض تجريبي")}`);
  const patient = patients.data.results.find((p) => p.full_name.includes("مريض تجريبي"));
  expect(patient, "seed_demo patient").toBeTruthy();
  const centers = await apiCall<{ results: { id: string; name: string }[] }>(
    doctor, "GET", "/api/v1/directory/organizations?kind=imaging_center");
  const center = centers.data.results.find((o) => o.name === IMAGING_CENTER);
  expect(center, "seed_demo imaging center").toBeTruthy();
  const order = await apiCall<{ id: string; number: string }>(doctor, "POST", "/api/v1/diagnostics/requests", {
    patient: patient!.id, kind: "imaging", priority: "routine", performer_organization: center!.id,
    clinical_notes: "سعال منذ أسبوعين (اختبار آلي)", items: [{ modality: "xray", body_site: site }],
  });
  expect(order.status).toBe(201);

  // 2. Imaging staff: incoming list → order → draft report.
  const page = await browser.newPage();
  await login(page, "imaging@hayattek.test");
  await page.goto("/app/lab");
  await page.getByRole("link", { name: order.data.number }).first().click();
  await page.waitForURL(/\/app\/lab\/requests\//);
  await expect(page.getByText("تقرير التصوير").first()).toBeVisible();
  await expect(page.getByLabel("عنوان التقرير")).toHaveValue(new RegExp(site));
  await page.getByLabel("الموجودات").fill("مسودة: الساحتان الرئويتان صافيتان.");
  await page.getByRole("button", { name: "حفظ كمسودة" }).click();
  await expect(page.getByText("المسودة محفوظة — لا يراها أحد غيرك")).toBeVisible();

  // The draft is invisible to the ordering doctor (404).
  const reports = await apiCall<{ results: { id: string; service_request: string }[] }>(
    page, "GET", `/api/v1/diagnostics/imaging-reports?patient=${patient!.id}`);
  const draft = reports.data.results.find((r) => r.service_request === order.data.id);
  expect(draft).toBeTruthy();
  expect((await apiCall(doctor, "GET", `/api/v1/diagnostics/imaging-reports/${draft!.id}`)).status).toBe(404);

  // 3. Edit the draft, then finalize.
  await page.getByLabel("الموجودات").fill("الساحتان الرئويتان صافيتان، لا انصباب جنب.");
  await page.getByLabel("الانطباع / الخلاصة").fill("صورة صدر طبيعية (اختبار آلي).");
  await page.getByRole("button", { name: "حفظ كمسودة" }).click();
  await expect(page.getByText("المسودة محفوظة — لا يراها أحد غيرك")).toBeVisible();
  await page.getByRole("button", { name: "اعتماد التقرير" }).click();
  await page.getByRole("button", { name: "اعتماد وإرسال" }).click();
  await expect(page.getByText("صورة صدر طبيعية (اختبار آلي).")).toBeVisible();

  // 4. The ordering doctor now sees the final report.
  const seen = await apiCall<{ status: string; impression: string }>(
    doctor, "GET", `/api/v1/diagnostics/imaging-reports/${draft!.id}`);
  expect(seen.status).toBe(200);
  expect(seen.data.status).toBe("final");

  // 5. Print: facility, author, modality, findings, impression, status.
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "طباعة" }).click();
  const print = await popup;
  await expect(print.getByText("تقرير تصوير طبي")).toBeVisible();
  await expect(print.getByText(IMAGING_CENTER)).toBeVisible();
  await expect(print.getByText("أخصائي التصوير (تجريبي)")).toBeVisible();
  await expect(print.getByText("الساحتان الرئويتان صافيتان، لا انصباب جنب.")).toBeVisible();
  await expect(print.getByText(order.data.number)).toBeVisible();
  await expect(print.getByText("معتمد")).toBeVisible();
});
