"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, FileUp, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceChips, Field, Input, Select, Textarea } from "@/components/ui/field";
import { api, errorMessage, type Schemas, unwrap, uploadDocument } from "@/lib/api";
import { m } from "@/lib/i18n";

import { useRefreshChart } from "./queries";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  encounterId?: string;
  onDone?: () => void;
}

/* ------------------------------------------------------------------ allergy */

export function AllergyDialog({ open, onOpenChange, patientId, encounterId }: DialogProps) {
  const refresh = useRefreshChart(patientId);
  const [f, setF] = React.useState({ substance: "", category: "medication", reaction: "", severity: "unknown" });
  const save = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/clinical/allergies", {
      body: { patient: patientId, ...(encounterId ? { encounter: encounterId } : {}), ...f,
        finalize_now: !encounterId } as never,
    })),
    onSuccess: () => { toast.success("تم توثيق الحساسية"); refresh(); onOpenChange(false); setF({ substance: "", category: "medication", reaction: "", severity: "unknown" }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="توثيق حساسية" description="تظهر بشكل بارز لكل طبيب مخوّل يفتح الملف."
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button loading={save.isPending} disabled={!f.substance.trim()} onClick={() => save.mutate()}>حفظ واعتماد</Button></>}>
        <div className="space-y-4">
          <Field label="المادة المسببة"><Input autoFocus value={f.substance} onChange={(e) => setF({ ...f, substance: e.target.value })} placeholder="مثال: بنسلين" /></Field>
          <Field label="النوع">
            <ChoiceChips value={f.category} onChange={(v) => setF({ ...f, category: v as string })}
              options={[{ value: "medication", label: "دواء" }, { value: "food", label: "طعام" }, { value: "environment", label: "بيئية" }, { value: "other", label: "أخرى" }]} />
          </Field>
          <Field label="الشدة">
            <ChoiceChips value={f.severity} onChange={(v) => setF({ ...f, severity: v as string })}
              options={Object.entries(m.allergySeverity).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="التفاعل" optional><Input value={f.reaction} onChange={(e) => setF({ ...f, reaction: e.target.value })} placeholder="مثال: طفح جلدي، ضيق نفس" /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ condition */

export function ConditionDialog({ open, onOpenChange, patientId, encounterId, onDone }: DialogProps & { category?: string }) {
  const refresh = useRefreshChart(patientId);
  const [f, setF] = React.useState({ display: "", code: "", category: encounterId ? "encounter_diagnosis" : "problem_list", note: "" });
  const save = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/clinical/conditions", {
      body: { patient: patientId, ...(encounterId ? { encounter: encounterId } : {}), ...f,
        finalize_now: !encounterId } as never,
    })),
    onSuccess: () => {
      toast.success("تمت الإضافة"); refresh(); onDone?.(); onOpenChange(false);
      setF({ display: "", code: "", category: encounterId ? "encounter_diagnosis" : "problem_list", note: "" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={encounterId ? "إضافة تشخيص" : "إضافة مرض مزمن أو سابقة مرضية"}
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button loading={save.isPending} disabled={!f.display.trim()} onClick={() => save.mutate()}>حفظ</Button></>}>
        <div className="space-y-4">
          <Field label="التشخيص"><Input autoFocus value={f.display} onChange={(e) => setF({ ...f, display: e.target.value })} placeholder="اكتب التشخيص بالعربية أو الإنجليزية" /></Field>
          <Field label="رمز ICD-10" optional hint="يساعد على التوافق مع الأنظمة الأخرى لاحقاً.">
            <Input dir="ltr" className="num max-w-40 text-start" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="E11.9" />
          </Field>
          <Field label="التصنيف">
            <ChoiceChips value={f.category} onChange={(v) => setF({ ...f, category: v as string })}
              options={Object.entries(m.conditionCategory)
                .filter(([v]) => encounterId || v !== "encounter_diagnosis")
                .map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="ملاحظة" optional><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ lab / imaging order */

export function OrderDialog({ open, onOpenChange, patientId, encounterId, kind }: DialogProps & { kind: "lab" | "imaging" }) {
  const refresh = useRefreshChart(patientId);
  const [tests, setTests] = React.useState<{ id: string; name: string }[]>([]);
  const [freeText, setFreeText] = React.useState("");
  const [modality, setModality] = React.useState("xray");
  const [bodySite, setBodySite] = React.useState("");
  const [performer, setPerformer] = React.useState("");
  const [priority, setPriority] = React.useState("routine");
  const [notes, setNotes] = React.useState("");
  const [q, setQ] = React.useState("");

  const testsQuery = useQuery({
    queryKey: ["lab-tests"],
    queryFn: () => unwrap(api.GET("/api/v1/diagnostics/lab-tests", {})),
    enabled: open && kind === "lab",
    staleTime: 10 * 60_000,
  });
  const performers = useQuery({
    queryKey: ["directory", "orgs", kind],
    queryFn: () => unwrap(api.GET("/api/v1/directory/organizations", {
      params: { query: { kind: kind === "lab" ? "laboratory,hospital,medical_center" : "imaging_center,hospital,medical_center" } as never },
    })),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () => {
      const items = kind === "lab"
        ? [...tests.map((t) => ({ lab_test: t.id })), ...(freeText.trim() ? [{ description: freeText.trim() }] : [])]
        : [{ modality, body_site: bodySite, description: freeText }];
      return unwrap(api.POST("/api/v1/diagnostics/requests", {
        body: {
          patient: patientId, kind, priority, clinical_notes: notes, items,
          ...(encounterId ? { encounter: encounterId } : {}),
          ...(performer ? { performer_organization: performer } : {}),
        } as never,
      }));
    },
    onSuccess: (r) => {
      toast.success(`تم إرسال الطلب ${r.number}`);
      refresh(); onOpenChange(false); setTests([]); setFreeText(""); setNotes(""); setBodySite("");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const canSave = kind === "lab" ? tests.length > 0 || freeText.trim().length > 0 : Boolean(modality);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title={kind === "lab" ? "طلب تحليل" : "طلب تصوير طبي"}
        description="يصل الطلب إلكترونياً إلى الجهة المختارة، وتعود النتيجة إلى الملف بعد اعتمادها."
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>إرسال الطلب</Button></>}>
        <div className="space-y-5">
          {kind === "lab" ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} className="ps-9" placeholder="تصفية: سكر، CBC، كرياتينين…" />
                </div>
                {tests.length > 0 && (
                  <button type="button" onClick={() => setTests([])} className="flex shrink-0 items-center gap-1 text-sm text-muted hover:text-danger">
                    <span className="num font-semibold text-brand-600">{tests.length}</span> مختار — مسح <X className="size-3.5" />
                  </button>
                )}
              </div>
              <LabTestGrid all={testsQuery.data ?? []} loading={testsQuery.isLoading} filter={q}
                selected={tests} onToggle={(t) => setTests((all) => all.some((x) => x.id === t.id)
                  ? all.filter((x) => x.id !== t.id) : [...all, { id: t.id, name: t.name_ar }])} />
              <Field label="تحليل غير موجود في القائمة" optional>
                <Input value={freeText} onChange={(e) => setFreeText(e.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <Field label="نوع التصوير">
                <ChoiceChips value={modality} onChange={(v) => setModality(v as string)}
                  options={Object.entries(m.modalities).map(([value, label]) => ({ value, label }))} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="المنطقة" optional><Input value={bodySite} onChange={(e) => setBodySite(e.target.value)} placeholder="مثال: صدر، بطن" /></Field>
                <Field label="تفاصيل" optional><Input value={freeText} onChange={(e) => setFreeText(e.target.value)} /></Field>
              </div>
            </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الجهة المنفذة" optional hint="اتركه فارغاً إن كان المريض سيختار.">
              <Select value={performer} onChange={(e) => setPerformer(e.target.value)}>
                <option value="">— يختار المريض —</option>
                {(performers.data?.results ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </Field>
            <Field label="الأولوية">
              <ChoiceChips value={priority} onChange={(v) => setPriority(v as string)}
                options={[{ value: "routine", label: "عادي" }, { value: "urgent", label: "عاجل" }]} />
            </Field>
          </div>
          <Field label="ملاحظات سريرية للجهة المنفذة" optional>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ upload */

const LAB_CATEGORY_ORDER = [
  "دمويات", "سكر", "وظائف كلية", "وظائف كبد", "شحوم", "شوارد ومعادن", "فيتامينات وحديد",
  "هرمونات الدرق", "هرمونات", "تخثر", "التهابات وروماتيزم", "مصليات وأمراض معدية",
  "واسمات قلبية", "واسمات ورمية", "بول", "براز", "زروع ومسحات",
];

const fold = (s: string) => s.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

/** Every orderable test, grouped by category; tapping a test toggles it (highlighted when
 *  selected). The filter box only narrows the list. */
function LabTestGrid({ all, loading, filter, selected, onToggle }: {
  all: Schemas["LabTestType"][];
  loading: boolean;
  filter: string;
  selected: { id: string }[];
  onToggle: (t: Schemas["LabTestType"]) => void;
}) {
  const f = fold(filter.trim());
  const shown = f ? all.filter((t) => fold(`${t.name_ar} ${t.name_en} ${t.code}`).includes(f)) : all;
  const groups = new Map<string, Schemas["LabTestType"][]>();
  for (const t of shown) groups.set(t.category || "أخرى", [...(groups.get(t.category || "أخرى") ?? []), t]);
  const rank = (c: string) => { const i = LAB_CATEGORY_ORDER.indexOf(c); return i === -1 ? 999 : i; };
  const ordered = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b));

  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-sunken" />;
  if (!ordered.length) {
    return <p className="rounded-xl bg-sunken p-3 text-sm text-muted">{f ? "لا يوجد تحليل بهذا الاسم — اكتبه في خانة «تحليل غير موجود في القائمة»." : "لا توجد تحاليل في القائمة بعد."}</p>;
  }
  return (
    <div className="max-h-[22rem] space-y-4 overflow-y-auto rounded-xl border border-line p-3">
      {ordered.map(([category, items]) => (
        <section key={category}>
          <h3 className="mb-2 text-xs font-semibold text-muted">{category}</h3>
          <div className="flex flex-wrap gap-2">
            {items.map((t) => {
              const on = selected.some((x) => x.id === t.id);
              return (
                <button key={t.id} type="button" aria-pressed={on} onClick={() => onToggle(t)} title={t.name_en}
                  className={on
                    ? "inline-flex items-center gap-1 rounded-full border border-brand-600 bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
                    : "rounded-full border border-line px-3 py-1.5 text-sm transition hover:border-brand-400 hover:bg-brand-50"}>
                  {on && <Check className="size-3.5" />}{t.name_ar}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function UploadDialog({ open, onOpenChange, patientId, encounterId }: DialogProps) {
  const refresh = useRefreshChart(patientId);
  const [file, setFile] = React.useState<File | null>(null);
  const [category, setCategory] = React.useState("medical_report");
  const [title, setTitle] = React.useState("");
  const [date, setDate] = React.useState("");
  const [ocr, setOcr] = React.useState(false);
  const router = useRouter();
  const ocrPossible = Boolean(file && /^(application\/pdf|image\/(jpeg|png|tiff|webp))$/.test(file.type));
  const save = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("patient", patientId);
      form.append("file", file as File);
      form.append("category", category);
      form.append("title", title || (file?.name ?? "مستند"));
      if (date) form.append("document_date", date);
      if (encounterId) form.append("encounter", encounterId);
      if (ocr && ocrPossible) form.append("run_ocr", "true");
      return uploadDocument(form);
    },
    onSuccess: (doc: { id: string }) => {
      if (ocr && ocrPossible) {
        toast.success("تم رفع المستند وبدأت قراءته آلياً", {
          action: { label: "مراجعة القراءة", onClick: () => router.push(`/app/documents/${doc.id}/review`) },
        });
      } else toast.success("تم رفع المستند");
      refresh(); onOpenChange(false); setFile(null); setTitle(""); setOcr(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="رفع مستند أو صورة" description="PDF أو صورة (JPG/PNG/HEIC) أو ملف DICOM، حتى 25 ميغابايت."
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button loading={save.isPending} disabled={!file} onClick={() => save.mutate()}>رفع</Button></>}>
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong bg-sunken/50 px-4 py-8 text-center hover:border-brand-400">
            <FileUp className="size-8 text-brand-500" />
            <span className="font-medium">{file ? file.name : "اختر ملفاً أو صوّر بالكاميرا"}</span>
            <span className="text-xs text-subtle">يمكن استخدام الماسح الضوئي وحفظ النتيجة PDF ثم رفعها</span>
            <input type="file" className="sr-only" accept="application/pdf,image/*,.dcm,application/dicom" capture="environment"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <Field label="التصنيف">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(m.documentCategories).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="العنوان" optional><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="تاريخ المستند" optional><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <label className={`flex items-start gap-2 text-sm ${ocrPossible || !file ? "" : "opacity-50"}`}>
            <input type="checkbox" className="mt-1 size-4" checked={ocr} disabled={Boolean(file) && !ocrPossible}
              onChange={(e) => setOcr(e.target.checked)} />
            <span>قراءة المستند آلياً (OCR)
              <span className="block text-xs text-muted">يقترح القيم من صورة التحليل أو PDF لتراجعها قبل إنشاء أي سجل. لا يدعم DICOM أو HEIC.</span>
            </span>
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ referral */

export function ReferralDialog({ open, onOpenChange, patientId, encounterId }: DialogProps) {
  const refresh = useRefreshChart(patientId);
  const [specialty, setSpecialty] = React.useState("");
  const [org, setOrg] = React.useState("");
  const [practitioner, setPractitioner] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [priority, setPriority] = React.useState("routine");
  const [scopes, setScopes] = React.useState<string[]>(["summary", "encounters"]);
  const [consented, setConsented] = React.useState(false);

  const orgs = useQuery({
    queryKey: ["directory", "orgs", "all"],
    queryFn: () => unwrap(api.GET("/api/v1/directory/organizations")),
    enabled: open,
  });
  const practitioners = useQuery({
    queryKey: ["directory", "practitioners", org, specialty],
    queryFn: () => unwrap(api.GET("/api/v1/directory/practitioners", {
      params: { query: { ...(org ? { organization: org } : {}), ...(specialty ? { specialty } : {}) } as never },
    })),
    enabled: open && Boolean(org || specialty),
  });

  const save = useMutation({
    mutationFn: async () => {
      const referral = await unwrap(api.POST("/api/v1/referrals", {
        body: {
          patient: patientId, reason, priority, target_specialty: specialty,
          shared_scopes: consented ? scopes : [], patient_consented: consented,
          ...(org ? { target_organization: org } : {}),
          ...(practitioner ? { target_practitioner: practitioner } : {}),
          ...(encounterId ? { encounter: encounterId } : {}),
        } as never,
      }));
      return unwrap(api.POST("/api/v1/referrals/{id}/finalize", { params: { path: { id: referral.id } } }));
    },
    onSuccess: () => { toast.success("تم إرسال الإحالة"); refresh(); onOpenChange(false); setReason(""); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="إحالة المريض"
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button loading={save.isPending} disabled={!reason.trim() || !(specialty || org || practitioner)} onClick={() => save.mutate()}>إرسال الإحالة</Button></>}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الاختصاص">
              <Select value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
                <option value="">— أي اختصاص —</option>
                {Object.entries(m.specialties).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="المنشأة" optional>
              <Select value={org} onChange={(e) => { setOrg(e.target.value); setPractitioner(""); }}>
                <option value="">— أي منشأة —</option>
                {(orgs.data?.results ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </Field>
          </div>
          {(org || specialty) && (
            <Field label="الطبيب" optional>
              <Select value={practitioner} onChange={(e) => setPractitioner(e.target.value)}>
                <option value="">— أي طبيب مناسب —</option>
                {(practitioners.data?.results ?? []).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="سبب الإحالة"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Field label="الأولوية">
            <ChoiceChips value={priority} onChange={(v) => setPriority(v as string)}
              options={[{ value: "routine", label: "عادية" }, { value: "urgent", label: "عاجلة" }, { value: "emergency", label: "إسعافية" }]} />
          </Field>
          <div className="rounded-2xl border border-line p-4">
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--brand-600)]" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
              <span className="text-sm">وافق المريض على مشاركة أجزاء من ملفه مع الطبيب المحال إليه (لمدة 30 يوماً عند قبول الإحالة).</span>
            </label>
            {consented && (
              <ChoiceChips multiple className="mt-3" value={scopes} onChange={(v) => setScopes(v as string[])}
                options={Object.entries(m.scopes).map(([value, label]) => ({ value, label }))} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
