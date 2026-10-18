import { describe, expect, it } from "vitest";

import {
  activeSession, buildApprovePayload, buildReviewForm, formatClock, newClientKey, parseVital, prescriptionItem,
  reviewCount, scribeNextAction, togglePick,
} from "../scribe-payload";

const f = (value: unknown, extra: Partial<{ needs_review: boolean; review_reason: string; sources: string[] }> = {}) => ({
  value, sources: extra.sources ?? ["s1"], confidence: 0.85, needs_review: extra.needs_review ?? false,
  review_reason: extra.review_reason ?? "", speaker: "doctor",
});

// Shape captured from the mock provider for the synthetic "chest pain" sample.
const DRAFT = {
  provider: "rules-v1",
  warnings: [],
  fields: {
    chief_complaint: f("صرلي أسبوع عندي وجع بصدري"),
    duration: f("اسبوع"),
    history: f("شوي ضيق نفس"),
    negatives: [f("تعرق")],
    examination: f("الأصوات القلبية طبيعية"),
    follow_up: f("بعد اسبوع"),
    vitals: { bp_systolic: f(150), bp_diastolic: f(90), heart_rate: f(86) },
    diagnoses: [f({ display: "ذبحة صدرية مستقرة", certainty: "suspected" }, { needs_review: true, review_reason: "عبارة غير مؤكدة" })],
    allergies: [f({ substance: "البنسلين", reaction: "طفح" })],
    prescribed_medications: [
      f({ name: "Aspirin", text: "أسبرين مية ملغ", dose_amount: "100", dose_unit: "mg", meal_relation: "after", schedule_type: "times_per_day", times_per_day: 1 }),
      f({ name: null, text: "دوا ما بعرف اسمه", dose_amount: null, dose_unit: null }, { needs_review: true, review_reason: "دواء غير محدد" }),
    ],
    current_medications: [f({ name: "Amlodipine", text: "أملوديبين" })],
    lab_orders: [f({ name: "سكر صيامي", lab_test: { id: "lab-fbs", code: "FBS", name: "سكر صيامي" } })],
    imaging_orders: [f({ modality: "ecg", description: "تخطيط قلب" })],
  },
};

describe("buildReviewForm", () => {
  const form = buildReviewForm(DRAFT, { reason: "ألم صدر", assessment: "", plan: "راحة" });

  it("prefills text fields from the draft and keeps the doctor's own reason/plan", () => {
    expect(form.reason).toBe("ألم صدر");
    expect(form.plan).toBe("راحة");
    expect(form.assessment).toBe(""); // never written by the AI
    expect(form.complaint).toBe("صرلي أسبوع عندي وجع بصدري");
    expect(form.history).toBe("المدة: اسبوع\nشوي ضيق نفس\nنفي: تعرق");
    expect(form.follow_up_note).toBe("بعد اسبوع");
    expect(form.vitals).toEqual({ bp_systolic: "150", bp_diastolic: "90", heart_rate: "86" });
  });

  it("pre-selects safe items, leaves needs-review items unselected, always keeps diagnoses", () => {
    expect(form.diagnoses[0].include).toBe(true);
    expect(form.meds.map((m) => m.include)).toEqual([true, false]);
    expect(form.allergies[0].include).toBe(true);
    expect(reviewCount(form)).toBe(2);
  });

  it("falls back to the encounter's text when the AI has nothing", () => {
    const empty = buildReviewForm({ fields: {} }, { complaint: "سعال", history: "منذ يومين" });
    expect(empty.complaint).toBe("سعال");
    expect(empty.history).toBe("منذ يومين");
    expect(empty.meds).toEqual([]);
  });

  it("survives a missing/garbage draft", () => {
    expect(buildReviewForm(null).diagnoses).toEqual([]);
    expect(buildReviewForm("x").vitals).toEqual({});
  });
});

describe("buildApprovePayload (same body as the web review page)", () => {
  const form = buildReviewForm(DRAFT, { reason: "ألم صدر" });

  it("sends only included items, numeric vitals and draft-prescription items", () => {
    const body = buildApprovePayload({ ...form, vitals: { ...form.vitals, spo2: "", temperature_c: "٣٧٫٥" } }, false);
    expect(body).toEqual({
      reason: "ألم صدر",
      complaint: "صرلي أسبوع عندي وجع بصدري",
      history: "المدة: اسبوع\nشوي ضيق نفس\nنفي: تعرق",
      examination: "الأصوات القلبية طبيعية",
      assessment: "",
      plan: "",
      follow_up_note: "بعد اسبوع",
      vitals: { bp_systolic: 150, bp_diastolic: 90, heart_rate: 86, temperature_c: 37.5 },
      diagnoses: [{ display: "ذبحة صدرية مستقرة", certainty: "suspected" }],
      allergies: [{ substance: "البنسلين", reaction: "طفح" }],
      prescription_items: [{
        medication_name: "Aspirin", dose_amount: "100", dose_unit: "mg", meal_relation: "after",
        instructions: "أسبرين مية ملغ", schedule_type: "times_per_day", times_per_day: 1,
      }],
      orders: [
        { kind: "lab", lab_test: "lab-fbs", description: "سكر صيامي" },
        { kind: "imaging", modality: "ecg", description: "تخطيط قلب" },
      ],
      finalize_encounter: false,
    });
  });

  it("include/exclude toggles change what is sent", () => {
    let edited = togglePick(form, "meds", 1); // opt the unclear medication in
    edited = togglePick(edited, "diagnoses", 0); // and drop the suspected diagnosis
    edited = togglePick(edited, "imaging", 0);
    const body = buildApprovePayload(edited, true);
    expect(body.diagnoses).toEqual([]);
    expect(body.orders).toEqual([{ kind: "lab", lab_test: "lab-fbs", description: "سكر صيامي" }]);
    expect(body.prescription_items[1]).toEqual({
      medication_name: "", dose_amount: null, dose_unit: "", meal_relation: "", instructions: "دوا ما بعرف اسمه", schedule_type: "custom",
    });
    expect(body.finalize_encounter).toBe(true);
    expect(form.meds[1].include).toBe(false); // toggling is immutable
  });

  it("maps every schedule type", () => {
    expect(prescriptionItem({ name: "X", schedule_type: "times_of_day", times_of_day: ["morning"] })).toMatchObject({ schedule_type: "times_of_day", times_of_day: ["morning"] });
    expect(prescriptionItem({ name: "X", schedule_type: "as_needed" })).toMatchObject({ schedule_type: "as_needed" });
    expect(prescriptionItem({ name: "X" })).toMatchObject({ schedule_type: "custom" });
  });
});

describe("parseVital", () => {
  it("parses Latin, Arabic-Indic and comma decimals", () => {
    expect(parseVital("120")).toBe(120);
    expect(parseVital("١٢٠")).toBe(120);
    expect(parseVital("37,5")).toBe(37.5);
    expect(parseVital("")).toBeNull();
    expect(parseVital("abc")).toBeNull();
  });
});

describe("session flow helpers", () => {
  it("maps every status to the next action", () => {
    expect(scribeNextAction(null)).toBe("start");
    expect(scribeNextAction("created")).toBe("upload");
    expect(scribeNextAction("uploaded")).toBe("wait");
    expect(scribeNextAction("processing")).toBe("wait");
    expect(scribeNextAction("ready")).toBe("review");
    expect(scribeNextAction("failed")).toBe("retry");
    expect(scribeNextAction("approved")).toBe("done");
    expect(scribeNextAction("discarded")).toBe("start");
  });
  it("finds the active session (ignores approved/discarded)", () => {
    expect(activeSession([{ status: "approved" }, { status: "failed", id: 2 }])).toEqual({ status: "failed", id: 2 });
    expect(activeSession([{ status: "discarded" }])).toBeUndefined();
  });
  it("client keys are 32 chars, deterministic for a given random source, and distinct otherwise", () => {
    let i = 0;
    const seq = () => ((i++ * 7) % 36) / 36;
    const a = newClientKey(seq, () => 1700000000000);
    expect(a).toHaveLength(32);
    i = 0;
    expect(newClientKey(seq, () => 1700000000000)).toBe(a);
    expect(newClientKey()).not.toBe(newClientKey());
  });
  it("formats the recording clock", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65.9)).toBe("01:05");
    expect(formatClock(-3)).toBe("00:00");
  });
});
