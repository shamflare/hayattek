/**
 * HayatTek AI review form + approve payload (pure, unit-tested in
 * `src/lib/__tests__/scribe-payload.test.ts`).
 *
 * Mirrors the web review page (apps/web/src/app/app/encounters/[id]/scribe/[sessionId]/page.tsx)
 * so both clients send the same `POST /scribe/sessions/{id}/approve` body. The server applies
 * only this payload (the doctor's edited values), never the raw AI draft, and creates the
 * prescription as a DRAFT.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DraftField<T = any> {
  value: T;
  sources: string[];
  confidence: number;
  needs_review: boolean;
  review_reason: string;
  speaker?: string;
}

export interface Segment { id: string; speaker: string; start: number; end: number; text: string }

export interface Pick<T = any> { include: boolean; value: T; field: DraftField<T> }

export type Diagnosis = { display: string; certainty?: string; code?: string }
export type AllergyValue = { substance: string; reaction?: string; severity?: string }
export type MedicationValue = {
  name?: string | null;
  text?: string;
  dose_amount?: string | null;
  dose_unit?: string | null;
  meal_relation?: string;
  schedule_type?: string;
  times_per_day?: number;
  times_of_day?: string[];
  in_catalog?: boolean;
}
export type LabOrderValue = { name: string; lab_test?: { id: string; code?: string; name?: string } | null }
export type ImagingOrderValue = { modality: string; description?: string }

export type DraftFields = {
  chief_complaint?: DraftField<string>;
  history?: DraftField<string>;
  duration?: DraftField<string>;
  examination?: DraftField<string>;
  follow_up?: DraftField<string>;
  negatives?: DraftField<string>[];
  vitals?: Record<string, DraftField<number | string>>;
  diagnoses?: DraftField<Diagnosis>[];
  allergies?: DraftField<AllergyValue>[];
  prescribed_medications?: DraftField<MedicationValue>[];
  current_medications?: DraftField<MedicationValue>[];
  lab_orders?: DraftField<LabOrderValue>[];
  imaging_orders?: DraftField<ImagingOrderValue>[];
  [key: string]: unknown;
};

export const TEXT_KEYS = ["reason", "complaint", "history", "examination", "assessment", "plan", "follow_up_note"] as const;
export type TextKey = (typeof TEXT_KEYS)[number];

export interface ReviewForm {
  reason: string;
  complaint: string;
  history: string;
  examination: string;
  assessment: string;
  plan: string;
  follow_up_note: string;
  vitals: Record<string, string>;
  diagnoses: Pick<Diagnosis>[];
  allergies: Pick<AllergyValue>[];
  meds: Pick<MedicationValue>[];
  labs: Pick<LabOrderValue>[];
  imaging: Pick<ImagingOrderValue>[];
  current: DraftField<MedicationValue>[];
  fields: DraftFields;
}

export type PickListKey = "diagnoses" | "allergies" | "meds" | "labs" | "imaging";

/** Current values of the encounter draft; kept where the AI has nothing to add. */
export type EncounterTexts = Partial<Record<TextKey, string | null>>;

export const VITALS: [key: string, label: string, unit: string][] = [
  ["bp_systolic", "الضغط الانقباضي", "mmHg"],
  ["bp_diastolic", "الضغط الانبساطي", "mmHg"],
  ["heart_rate", "النبض", "/د"],
  ["temperature_c", "الحرارة", "°C"],
  ["spo2", "الأكسجة", "%"],
  ["resp_rate", "التنفس", "/د"],
  ["weight_kg", "الوزن", "kg"],
  ["glucose_mg_dl", "سكر الدم", "mg/dL"],
];

export function draftFields(draft: unknown): DraftFields {
  const fields = (draft as { fields?: unknown } | null | undefined)?.fields;
  return fields && typeof fields === "object" ? (fields as DraftFields) : {};
}

export function draftWarnings(draft: unknown): string[] {
  const w = (draft as { warnings?: unknown } | null | undefined)?.warnings;
  return Array.isArray(w) ? w.filter((x): x is string => typeof x === "string") : [];
}

export function transcriptSegments(transcript: unknown): Segment[] {
  const s = (transcript as { segments?: unknown } | null | undefined)?.segments;
  return Array.isArray(s) ? (s as Segment[]) : [];
}

function pick<T>(list: DraftField<T>[] | undefined): Pick<T>[] {
  // Items that need review start unselected: the doctor opts them in explicitly.
  return (list ?? []).map((field) => ({ include: !field.needs_review, value: field.value, field }));
}

/** Build the editable review form from the AI draft (+ the encounter's current texts). */
export function buildReviewForm(draft: unknown, encounter: EncounterTexts = {}): ReviewForm {
  const f = draftFields(draft);
  const vitals: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.vitals ?? {})) {
    if (v && v.value !== null && v.value !== undefined) vitals[k] = String(v.value);
  }
  const history = [
    f.duration ? `المدة: ${f.duration.value}` : "",
    f.history?.value ?? "",
    ...(f.negatives ?? []).map((n) => `نفي: ${n.value}`),
  ].filter(Boolean).join("\n");
  const keep = (k: TextKey) => encounter[k] ?? "";
  return {
    reason: keep("reason"),
    complaint: f.chief_complaint?.value || keep("complaint"),
    history: history || keep("history"),
    examination: f.examination?.value || keep("examination"),
    assessment: keep("assessment"), // the doctor's own words; the AI never writes it
    plan: keep("plan"),
    follow_up_note: f.follow_up?.value || keep("follow_up_note"),
    vitals,
    // Diagnoses the doctor said are pre-selected (suspected ones keep their badge).
    diagnoses: pick(f.diagnoses).map((d) => ({ ...d, include: true })),
    allergies: pick(f.allergies),
    meds: pick(f.prescribed_medications),
    labs: pick(f.lab_orders),
    imaging: pick(f.imaging_orders),
    current: f.current_medications ?? [],
    fields: f,
  };
}

export function togglePick(form: ReviewForm, list: PickListKey, index: number): ReviewForm {
  const items = form[list] as Pick[];
  return { ...form, [list]: items.map((x, j) => (j === index ? { ...x, include: !x.include } : x)) };
}

export function reviewCount(form: ReviewForm): number {
  return [...form.diagnoses, ...form.allergies, ...form.meds, ...form.labs, ...form.imaging]
    .filter((x) => x.field.needs_review).length;
}

/** "١٢٠" / "37,5" -> 120 / 37.5; empty or invalid -> null. */
export function parseVital(raw: string): number | null {
  const latin = raw.trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٫,]/g, ".");
  if (!latin) return null;
  const n = Number(latin);
  return Number.isFinite(n) ? n : null;
}

export function prescriptionItem(v: MedicationValue): Record<string, unknown> {
  const base = {
    medication_name: v.name ?? "",
    dose_amount: v.dose_amount || null,
    dose_unit: v.dose_unit ?? "",
    meal_relation: v.meal_relation ?? "",
    instructions: v.text ?? "",
  };
  if (v.schedule_type === "times_per_day") return { ...base, schedule_type: "times_per_day", times_per_day: v.times_per_day };
  if (v.schedule_type === "times_of_day") return { ...base, schedule_type: "times_of_day", times_of_day: v.times_of_day };
  if (v.schedule_type === "as_needed") return { ...base, schedule_type: "as_needed" };
  return { ...base, schedule_type: "custom" }; // unstated schedule: keep the spoken words, doctor completes it
}

export interface ApprovePayload {
  reason: string;
  complaint: string;
  history: string;
  examination: string;
  assessment: string;
  plan: string;
  follow_up_note: string;
  vitals: Record<string, number>;
  diagnoses: Diagnosis[];
  allergies: AllergyValue[];
  prescription_items: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  finalize_encounter: boolean;
}

/** Same body as the web review page builds. Only included items are sent. */
export function buildApprovePayload(form: ReviewForm, finalize: boolean): ApprovePayload {
  const vitals: Record<string, number> = {};
  for (const [k, raw] of Object.entries(form.vitals)) {
    const n = parseVital(raw);
    if (n !== null) vitals[k] = n;
  }
  const on = <T,>(list: Pick<T>[]) => list.filter((x) => x.include).map((x) => x.value);
  return {
    reason: form.reason,
    complaint: form.complaint,
    history: form.history,
    examination: form.examination,
    assessment: form.assessment,
    plan: form.plan,
    follow_up_note: form.follow_up_note,
    vitals,
    diagnoses: on(form.diagnoses),
    allergies: on(form.allergies),
    prescription_items: on(form.meds).map(prescriptionItem),
    orders: [
      ...on(form.labs).map((x) => ({ kind: "lab", lab_test: x.lab_test?.id ?? null, description: x.name })),
      ...on(form.imaging).map((x) => ({ kind: "imaging", modality: x.modality, description: x.description })),
    ],
    finalize_encounter: finalize,
  };
}

/* ------------------------------------------------------------------ session flow */

export type SessionStatus = "created" | "uploaded" | "processing" | "ready" | "approved" | "failed" | "discarded";
export type NextAction = "start" | "upload" | "wait" | "review" | "retry" | "done";

/**
 * What the recorder screen should do next for a session (or none). A session in
 * `created` still needs its audio; `discarded` means a new session with a NEW key.
 */
export function scribeNextAction(status: SessionStatus | null | undefined): NextAction {
  switch (status) {
    case "created": return "upload";
    case "uploaded":
    case "processing": return "wait";
    case "ready": return "review";
    case "failed": return "retry";
    case "approved": return "done";
    default: return "start";
  }
}

/** Session still being worked on for this encounter (newest first from the API). */
export function activeSession<S extends { status: string }>(sessions: S[]): S | undefined {
  return sessions.find((s) => s.status !== "approved" && s.status !== "discarded");
}

/**
 * Idempotency key for `POST /scribe/sessions`. Generated ONCE per recording attempt and
 * re-sent unchanged on every retry, so a dropped response never creates a second session.
 */
export function newClientKey(random: () => number = Math.random, now: () => number = Date.now): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID && random === Math.random) return g.crypto.randomUUID().replace(/-/g, "");
  let s = now().toString(36);
  while (s.length < 32) s += Math.floor(random() * 36).toString(36);
  return s.slice(0, 32);
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
