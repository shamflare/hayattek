"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, ClipboardList, FileUp, FlaskConical, History, Image as ImageIcon, PenLine, Plus,
  Save, Send, Stethoscope, Trash2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { OrderDialog, ConditionDialog, ReferralDialog, UploadDialog } from "@/components/clinical/quick-dialogs";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceChips, Field, Input, Textarea } from "@/components/ui/field";
import { FulfillmentBadge, RecordStatusBadge } from "@/components/ui/status";
import { Avatar, Badge, Card, CardBody, CardHeader, ErrorState, Kbd, Skeleton } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { ageLabel, formatDateTime, sexLabel } from "@/lib/format";
import { label, m } from "@/lib/i18n";

type Encounter = Schemas["Encounter"];
type TextKey = "reason" | "complaint" | "history" | "examination" | "assessment" | "plan" | "notes" | "follow_up_note";
type Draft = Pick<Encounter, TextKey | "encounter_type"> & { vitals: Record<string, string>; follow_up_date: string };

const VITALS: { key: string; label: string; unit: string; step?: string }[] = [
  { key: "bp_systolic", label: "الضغط الانقباضي", unit: "mmHg" },
  { key: "bp_diastolic", label: "الضغط الانبساطي", unit: "mmHg" },
  { key: "heart_rate", label: "النبض", unit: "/د" },
  { key: "temperature_c", label: "الحرارة", unit: "°C", step: "0.1" },
  { key: "spo2", label: "الأكسجة", unit: "%" },
  { key: "resp_rate", label: "التنفس", unit: "/د" },
  { key: "weight_kg", label: "الوزن", unit: "kg", step: "0.1" },
  { key: "height_cm", label: "الطول", unit: "cm" },
  { key: "glucose_mg_dl", label: "سكر الدم", unit: "mg/dL" },
];

function toDraft(e: Encounter): Draft {
  const vitals: Record<string, string> = {};
  for (const [k, v] of Object.entries((e.vitals ?? {}) as Record<string, number>)) vitals[k] = String(v);
  return {
    encounter_type: e.encounter_type, reason: e.reason, complaint: e.complaint, history: e.history,
    examination: e.examination, assessment: e.assessment, plan: e.plan, notes: e.notes,
    follow_up_note: e.follow_up_note, follow_up_date: e.follow_up_date ?? "", vitals,
  };
}

function toBody(d: Draft) {
  const vitals: Record<string, number> = {};
  for (const [k, v] of Object.entries(d.vitals)) if (v !== "" && !Number.isNaN(Number(v))) vitals[k] = Number(v);
  return { ...d, vitals, follow_up_date: d.follow_up_date || null };
}

export default function EncounterPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["encounter", id],
    queryFn: () => unwrap(api.GET("/api/v1/clinical/encounters/{id}", { params: { path: { id } } })),
  });
  const enc = query.data;
  const patient = useQuery({
    queryKey: ["patient", enc?.patient],
    queryFn: () => unwrap(api.GET("/api/v1/patients/{id}", { params: { path: { id: enc!.patient } } })),
    enabled: Boolean(enc?.patient),
  });

  if (query.isLoading) return <div className="space-y-4"><Skeleton className="h-24 rounded-card" /><Skeleton className="h-[60vh] rounded-card" /></div>;
  if (query.isError || !enc) return <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />;

  const p = patient.data?.patient;
  return (
    <div className="animate-fade-up">
      <Card className="mb-5 flex flex-wrap items-center gap-4 p-4">
        <Link href={`/app/patients/${enc.patient}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar name={p?.full_name} className="size-12" />
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{p?.full_name ?? "…"}</div>
            {p && <div className="text-sm text-muted">{sexLabel(p.sex)} · {ageLabel(p.age_years, p.birth_date_precision)} · <span className="num">{p.health_number}</span></div>}
          </div>
        </Link>
        <div className="flex items-center gap-2 text-sm text-muted">
          <Stethoscope className="size-4" /> {formatDateTime(enc.occurred_at)}
          <RecordStatusBadge status={enc.status} />
          {enc.version > 1 && <Badge tone="info">نسخة <span className="num">{enc.version}</span></Badge>}
        </div>
      </Card>
      {enc.can_edit ? (
        <EncounterEditor encounter={enc} onSaved={(e) => qc.setQueryData(["encounter", id], e)} />
      ) : (
        <EncounterView encounter={enc} />
      )}
    </div>
  );
}

/* ================================================================== editor (draft) */

function EncounterEditor({ encounter, onSaved }: { encounter: Encounter; onSaved: (e: Encounter) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(encounter));
  const [dirty, setDirty] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<Date | null>(null);
  const [confirm, setConfirm] = React.useState<"finalize" | "discard" | null>(null);
  const [dialog, setDialog] = React.useState<"diagnosis" | "lab" | "imaging" | "upload" | "referral" | null>(null);

  const save = useMutation({
    mutationFn: (d: Draft) => unwrap(api.PATCH("/api/v1/clinical/encounters/{id}", {
      params: { path: { id: encounter.id } }, body: toBody(d) as never,
    })),
    onSuccess: (e) => { onSaved(e); setDirty(false); setSavedAt(new Date()); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const finalize = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync(draft);
      return unwrap(api.POST("/api/v1/clinical/encounters/{id}/finalize", { params: { path: { id: encounter.id } } }));
    },
    onSuccess: (e) => {
      onSaved(e); toast.success("تم اعتماد الزيارة");
      qc.invalidateQueries({ queryKey: ["timeline", encounter.patient] });
      qc.invalidateQueries({ queryKey: ["summary", encounter.patient] });
      setConfirm(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const discard = useMutation({
    mutationFn: () => api.POST("/api/v1/clinical/encounters/{id}/entered-in-error", {
      params: { path: { id: encounter.id } }, body: { reason: "حذف مسودة" },
    }),
    onSuccess: () => { toast.success("حُذفت المسودة"); router.replace(`/app/patients/${encounter.patient}`); },
  });

  // Autosave 2.5s after the last keystroke; Ctrl+S saves immediately.
  React.useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => save.mutate(draft), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save.mutate(draft); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const setText = (k: TextKey) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDraft((d) => ({ ...d, [k]: e.target.value })); setDirty(true);
  };
  const setVital = (k: string, v: string) => { setDraft((d) => ({ ...d, vitals: { ...d.vitals, [k]: v } })); setDirty(true); };
  const refreshEncounter = () => qc.invalidateQueries({ queryKey: ["encounter", encounter.id] });

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <Card>
          <CardBody className="space-y-5">
            <ChoiceChips value={draft.encounter_type} onChange={(v) => { setDraft((d) => ({ ...d, encounter_type: v as Draft["encounter_type"] })); setDirty(true); }}
              options={Object.entries(m.encounterTypes).map(([value, label]) => ({ value: value as Draft["encounter_type"], label }))} />
            <Field label="سبب الزيارة"><Input autoFocus value={draft.reason} onChange={setText("reason")} placeholder="مثال: ألم صدري، مراجعة سكري" /></Field>
            <Field label="الشكاية والأعراض" optional><Textarea rows={3} value={draft.complaint} onChange={setText("complaint")} /></Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="العلامات الحيوية" description="أدخل ما تم قياسه فقط" />
          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {VITALS.map((v) => (
              <label key={v.key} className="rounded-2xl border border-line bg-sunken/40 p-3 focus-within:border-brand-400">
                <span className="text-xs text-muted">{v.label}</span>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <input inputMode="decimal" step={v.step} value={draft.vitals[v.key] ?? ""} onChange={(e) => setVital(v.key, e.target.value)}
                    className="num w-full bg-transparent text-xl font-semibold outline-none placeholder:text-line-strong" placeholder="—" />
                  <span className="text-xs text-subtle">{v.unit}</span>
                </div>
              </label>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-5">
            <Field label="القصة المرضية" optional><Textarea rows={3} value={draft.history} onChange={setText("history")} /></Field>
            <Field label="الفحص السريري" optional><Textarea rows={3} value={draft.examination} onChange={setText("examination")} /></Field>
            <Field label="التقييم / الانطباع" optional><Textarea rows={2} value={draft.assessment} onChange={setText("assessment")} /></Field>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">التشخيصات</span>
                <Button variant="ghost" size="sm" onClick={() => setDialog("diagnosis")}><Plus className="size-4" /> إضافة تشخيص</Button>
              </div>
              {encounter.conditions.length ? (
                <ul className="flex flex-wrap gap-2">
                  {encounter.conditions.map((c) => (
                    <li key={c.id} className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm text-brand-800 dark:text-brand-200">
                      {c.display}{c.code && <span className="num ms-1.5 text-xs opacity-70">{c.code}</span>}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-subtle">لم يُضف تشخيص بعد.</p>}
            </div>
            <Field label="الخطة والتوصيات" optional><Textarea rows={3} value={draft.plan} onChange={setText("plan")} /></Field>
            <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <Field label="موعد المراجعة" optional><Input type="date" value={draft.follow_up_date} onChange={(e) => { setDraft((d) => ({ ...d, follow_up_date: e.target.value })); setDirty(true); }} /></Field>
              <Field label="ملاحظة المراجعة" optional><Input value={draft.follow_up_note} onChange={setText("follow_up_note")} /></Field>
            </div>
            <Field label="ملاحظات خاصة" optional><Textarea rows={2} value={draft.notes} onChange={setText("notes")} /></Field>
          </CardBody>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between text-xs text-muted">
            <span>{save.isPending ? "جارٍ الحفظ…" : dirty ? "تغييرات غير محفوظة" : savedAt ? `حُفظت ${savedAt.toLocaleTimeString("ar-SY-u-nu-latn", { hour: "2-digit", minute: "2-digit" })}` : "مسودة"}</span>
            <span className="hidden lg:inline"><Kbd>Ctrl S</Kbd></span>
          </div>
          <div className="grid gap-2">
            <Button size="lg" onClick={() => setConfirm("finalize")}><CheckCircle2 className="size-5" /> اعتماد الزيارة</Button>
            <Button variant="outline" loading={save.isPending} onClick={() => save.mutate(draft)}><Save className="size-4" /> حفظ المسودة</Button>
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-3 text-sm font-semibold">ضمن هذه الزيارة</div>
          <div className="grid gap-2">
            <Button variant="secondary" asChild><Link href={`/app/prescriptions/new?patient=${encounter.patient}&encounter=${encounter.id}`}><ClipboardList className="size-4" /> كتابة وصفة</Link></Button>
            <Button variant="outline" onClick={() => setDialog("lab")}><FlaskConical className="size-4" /> طلب تحليل</Button>
            <Button variant="outline" onClick={() => setDialog("imaging")}><ImageIcon className="size-4" /> طلب تصوير</Button>
            <Button variant="outline" onClick={() => setDialog("upload")}><FileUp className="size-4" /> رفع مستند</Button>
            <Button variant="outline" onClick={() => setDialog("referral")}><Send className="size-4" /> إحالة</Button>
          </div>
          <LinkedItems encounter={encounter} />
        </Card>
        <Button variant="danger-ghost" className="w-full" onClick={() => setConfirm("discard")}><Trash2 className="size-4" /> حذف المسودة</Button>
      </aside>

      <ConfirmDialog open={confirm === "finalize"} onOpenChange={(o) => !o && setConfirm(null)} title="اعتماد الزيارة؟"
        description="بعد الاعتماد تُقفل الزيارة وتظهر للمريض وللأطباء المخوّلين. أي تعديل لاحق يكون تصحيحاً موثقاً بسبب ونسخة."
        confirmLabel="اعتماد" loading={finalize.isPending} onConfirm={() => finalize.mutate()} />
      <ConfirmDialog open={confirm === "discard"} onOpenChange={(o) => !o && setConfirm(null)} title="حذف المسودة؟" tone="danger"
        description="المسودة لم يرها أحد غيرك وستُحذف نهائياً." confirmLabel="حذف" loading={discard.isPending} onConfirm={() => discard.mutate()} />

      <ConditionDialog open={dialog === "diagnosis"} onOpenChange={(o) => setDialog(o ? "diagnosis" : null)} patientId={encounter.patient} encounterId={encounter.id} onDone={refreshEncounter} />
      <OrderDialog kind="lab" open={dialog === "lab"} onOpenChange={(o) => { setDialog(o ? "lab" : null); if (!o) refreshEncounter(); }} patientId={encounter.patient} encounterId={encounter.id} />
      <OrderDialog kind="imaging" open={dialog === "imaging"} onOpenChange={(o) => { setDialog(o ? "imaging" : null); if (!o) refreshEncounter(); }} patientId={encounter.patient} encounterId={encounter.id} />
      <UploadDialog open={dialog === "upload"} onOpenChange={(o) => setDialog(o ? "upload" : null)} patientId={encounter.patient} encounterId={encounter.id} />
      <ReferralDialog open={dialog === "referral"} onOpenChange={(o) => setDialog(o ? "referral" : null)} patientId={encounter.patient} encounterId={encounter.id} />
    </div>
  );
}

function LinkedItems({ encounter }: { encounter: Encounter }) {
  if (!encounter.prescriptions.length && !encounter.service_requests.length) return null;
  return (
    <ul className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
      {encounter.prescriptions.map((rx) => (
        <li key={rx.id}>
          <Link href={`/app/prescriptions/${rx.id}`} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1 hover:bg-sunken">
            <span className="flex items-center gap-2"><ClipboardList className="size-4 text-accent" /> <span className="num">{rx.number}</span></span>
            <RecordStatusBadge status={rx.status} />
          </Link>
        </li>
      ))}
      {encounter.service_requests.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-2 px-1 py-1">
          <span className="flex items-center gap-2">{r.kind === "lab" ? <FlaskConical className="size-4 text-info" /> : <ImageIcon className="size-4 text-warning" />}<span className="num">{r.number}</span></span>
          <FulfillmentBadge status={r.fulfillment_status} />
        </li>
      ))}
    </ul>
  );
}

/* ================================================================== read-only + amend */

function EncounterView({ encounter }: { encounter: Encounter }) {
  const qc = useQueryClient();
  const [amendOpen, setAmendOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const vitals = Object.entries((encounter.vitals ?? {}) as Record<string, number>);
  const sections: [string, string][] = [
    ["سبب الزيارة", encounter.reason], ["الشكاية", encounter.complaint], ["القصة المرضية", encounter.history],
    ["الفحص السريري", encounter.examination], ["التقييم", encounter.assessment], ["الخطة", encounter.plan],
    ["ملاحظات", encounter.notes],
  ];
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_300px]">
      <Card>
        <CardBody className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone="brand">{label("encounterTypes", encounter.encounter_type)}</Badge>
            <span>{encounter.author_name}</span>{encounter.organization_name && <span>· {encounter.organization_name}</span>}
          </div>
          {encounter.status === "entered_in_error" && (
            <div className="rounded-2xl bg-danger-soft p-3 text-sm text-danger">أُلغيت هذه الزيارة: {encounter.status_reason}</div>
          )}
          {encounter.status === "amended" && (
            <div className="rounded-2xl bg-info-soft p-3 text-sm text-info">صُححت هذه الزيارة: {encounter.status_reason}</div>
          )}
          {vitals.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {vitals.map(([k, v]) => {
                const meta = VITALS.find((x) => x.key === k);
                return (
                  <div key={k} className="rounded-2xl bg-sunken p-3">
                    <div className="text-xs text-muted">{meta?.label ?? k}</div>
                    <div className="num text-lg font-semibold">{v} <span className="text-xs font-normal text-subtle">{meta?.unit}</span></div>
                  </div>
                );
              })}
            </div>
          )}
          {sections.filter(([, v]) => v).map(([title, text]) => (
            <div key={title}>
              <div className="mb-1 text-sm font-semibold text-muted">{title}</div>
              <p className="whitespace-pre-wrap leading-8">{text}</p>
            </div>
          ))}
          {encounter.conditions.length > 0 && (
            <div>
              <div className="mb-2 text-sm font-semibold text-muted">التشخيصات</div>
              <div className="flex flex-wrap gap-2">
                {encounter.conditions.map((c) => <Badge key={c.id} tone="brand">{c.display}{c.code && ` · ${c.code}`}</Badge>)}
              </div>
            </div>
          )}
          {encounter.follow_up_date && (
            <div className="rounded-2xl bg-brand-50 p-3 text-sm">موعد المراجعة: <span className="num font-semibold">{encounter.follow_up_date}</span> {encounter.follow_up_note}</div>
          )}
        </CardBody>
      </Card>
      <aside className="space-y-3 lg:sticky lg:top-20">
        {encounter.can_amend && (
          <Button className="w-full" variant="outline" onClick={() => setAmendOpen(true)}><PenLine className="size-4" /> تصحيح موثق</Button>
        )}
        {encounter.version > 1 && (
          <Button className="w-full" variant="ghost" onClick={() => setHistoryOpen(true)}><History className="size-4" /> النسخ السابقة</Button>
        )}
        <Card className="p-4"><LinkedItems encounter={encounter} /></Card>
      </aside>
      <AmendDialog open={amendOpen} onOpenChange={setAmendOpen} encounter={encounter}
        onDone={(e) => qc.setQueryData(["encounter", encounter.id], e)} />
      <VersionsDialog open={historyOpen} onOpenChange={setHistoryOpen} id={encounter.id} />
    </div>
  );
}

function AmendDialog({ open, onOpenChange, encounter, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; encounter: Encounter; onDone: (e: Encounter) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [assessment, setAssessment] = React.useState(encounter.assessment);
  const [plan, setPlan] = React.useState(encounter.plan);
  const [notes, setNotes] = React.useState(encounter.notes);
  const amend = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/clinical/encounters/{id}/amend", {
      params: { path: { id: encounter.id } }, body: { reason, changes: { assessment, plan, notes } } as never,
    })),
    onSuccess: (e) => { onDone(e as Encounter); toast.success("تم التصحيح وحُفظت النسخة السابقة"); onOpenChange(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="تصحيح موثق" description="تُحفظ النسخة الحالية كما هي، ويظهر التصحيح مع سببه وتاريخه."
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button loading={amend.isPending} disabled={reason.trim().length < 3} onClick={() => amend.mutate()}>حفظ التصحيح</Button></>}>
        <div className="space-y-4">
          <Field label="سبب التصحيح"><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: خطأ في كتابة التشخيص" /></Field>
          <Field label="التقييم"><Textarea value={assessment} onChange={(e) => setAssessment(e.target.value)} /></Field>
          <Field label="الخطة"><Textarea value={plan} onChange={(e) => setPlan(e.target.value)} /></Field>
          <Field label="ملاحظات"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VersionsDialog({ open, onOpenChange, id }: { open: boolean; onOpenChange: (o: boolean) => void; id: string }) {
  const q = useQuery({
    queryKey: ["encounter-versions", id],
    queryFn: () => unwrap(api.GET("/api/v1/clinical/encounters/{id}/versions", { params: { path: { id } } })),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="سجل النسخ">
        <ol className="space-y-3">
          {((Array.isArray(q.data) ? q.data : q.data?.results ?? []) as Schemas["RecordVersionRow"][]).map((v) => (
            <li key={v.version} className="rounded-2xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold">النسخة <span className="num">{v.version}</span></span>
                <span className="text-muted">{v.changed_by} · {formatDateTime(v.created_at)}</span>
              </div>
              <div className="mt-1 text-sm text-muted">سبب التغيير: {v.reason}</div>
              <div className="mt-2 whitespace-pre-wrap rounded-xl bg-sunken p-3 text-sm leading-7">
                {String((v.snapshot as Record<string, unknown>).assessment ?? "")}
              </div>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
