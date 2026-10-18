"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, Sparkles, User, UserRound } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Badge, Card, CardBody, ErrorState, Skeleton } from "@/components/ui/surface";
import { api, errorMessage, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { label } from "@/lib/i18n";

/* eslint-disable @typescript-eslint/no-explicit-any */
type F = { value: any; sources: string[]; confidence: number; needs_review: boolean; review_reason: string; speaker?: string };
type Segment = { id: string; speaker: string; start: number; end: number; text: string };

const VITALS: [string, string, string][] = [
  ["bp_systolic", "الضغط الانقباضي", "mmHg"], ["bp_diastolic", "الضغط الانبساطي", "mmHg"],
  ["heart_rate", "النبض", "/د"], ["temperature_c", "الحرارة", "°C"], ["spo2", "الأكسجة", "%"],
  ["resp_rate", "التنفس", "/د"], ["weight_kg", "الوزن", "kg"], ["glucose_mg_dl", "سكر الدم", "mg/dL"],
];

const SPEAKER: Record<string, { label: string; tone: string; icon: React.ElementType }> = {
  doctor: { label: "الطبيب", tone: "bg-brand-50 text-brand-700 dark:text-brand-300", icon: UserRound },
  patient: { label: "المريض", tone: "bg-accent-soft text-accent", icon: User },
  unknown: { label: "متحدث غير محدد", tone: "bg-warning-soft text-warning", icon: AlertTriangle },
};

interface Pick<T> { include: boolean; value: T; field: F }

export default function ScribeReviewPage() {
  const { id: encounterId, sessionId } = useParams<{ id: string; sessionId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["scribe", "session", sessionId],
    queryFn: () => unwrap(api.GET("/api/v1/scribe/sessions/{id}", { params: { path: { id: sessionId } } })),
  });
  const [highlight, setHighlight] = React.useState<string[]>([]);
  const [form, setForm] = React.useState<any>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [finalize, setFinalize] = React.useState(false);

  React.useEffect(() => {
    if (!query.data || form) return;
    const f = (query.data.draft as any)?.fields ?? {};
    const vitals: Record<string, string> = {};
    for (const [k, v] of Object.entries(f.vitals ?? {})) vitals[k] = String((v as F).value ?? "");
    const pick = (list: F[] | undefined) => (list ?? []).map((field) => ({ include: !field.needs_review, value: field.value, field }));
    setForm({
      reason: "",
      complaint: f.chief_complaint?.value ?? "",
      history: [f.duration ? `المدة: ${f.duration.value}` : "", f.history?.value ?? "",
        ...(f.negatives ?? []).map((n: F) => `نفي: ${n.value}`)].filter(Boolean).join("\n"),
      examination: f.examination?.value ?? "",
      assessment: "",
      plan: "",
      follow_up_note: f.follow_up?.value ?? "",
      vitals,
      diagnoses: pick(f.diagnoses).map((d: Pick<any>) => ({ ...d, include: true })),
      allergies: pick(f.allergies),
      meds: pick(f.prescribed_medications),
      labs: pick(f.lab_orders),
      imaging: pick(f.imaging_orders),
      current: f.current_medications ?? [],
      fields: f,
    });
  }, [query.data, form]);

  const approve = useMutation({
    mutationFn: () => {
      const vitals: Record<string, number> = {};
      for (const [k, v] of Object.entries(form.vitals as Record<string, string>)) if (v !== "") vitals[k] = Number(v);
      const items = form.meds.filter((m: Pick<any>) => m.include).map((m: Pick<any>) => {
        const v = m.value;
        const base: any = { medication_name: v.name ?? "", dose_amount: v.dose_amount || null, dose_unit: v.dose_unit ?? "" ,
          meal_relation: v.meal_relation ?? "", instructions: v.text ?? "" };
        if (v.schedule_type === "times_per_day") return { ...base, schedule_type: "times_per_day", times_per_day: v.times_per_day };
        if (v.schedule_type === "times_of_day") return { ...base, schedule_type: "times_of_day", times_of_day: v.times_of_day };
        if (v.schedule_type === "as_needed") return { ...base, schedule_type: "as_needed" };
        return { ...base, schedule_type: "custom" }; // unstated schedule: keep the spoken words, doctor completes it
      });
      return unwrap(api.POST("/api/v1/scribe/sessions/{id}/approve", {
        params: { path: { id: sessionId } },
        body: {
          reason: form.reason, complaint: form.complaint, history: form.history,
          examination: form.examination, assessment: form.assessment, plan: form.plan,
          follow_up_note: form.follow_up_note, vitals,
          diagnoses: form.diagnoses.filter((d: Pick<any>) => d.include).map((d: Pick<any>) => d.value),
          allergies: form.allergies.filter((a: Pick<any>) => a.include).map((a: Pick<any>) => a.value),
          prescription_items: items,
          orders: [
            ...form.labs.filter((x: Pick<any>) => x.include).map((x: Pick<any>) => ({ kind: "lab", lab_test: x.value.lab_test?.id ?? null, description: x.value.name })),
            ...form.imaging.filter((x: Pick<any>) => x.include).map((x: Pick<any>) => ({ kind: "imaging", modality: x.value.modality, description: x.value.description })),
          ],
          finalize_encounter: finalize,
        } as never,
      }));
    },
    onSuccess: (s) => {
      toast.success("طُبّقت المسودة على الزيارة");
      qc.invalidateQueries({ queryKey: ["encounter", encounterId] });
      qc.invalidateQueries({ queryKey: ["scribe"] });
      const rx = (s.applied as any)?.prescription;
      router.push(rx ? `/app/prescriptions/${rx}` : `/app/encounters/${encounterId}`);
    },
    onError: (e) => { toast.error(errorMessage(e)); setConfirm(false); },
  });

  if (query.isLoading || (query.data && !form)) return <Skeleton className="h-[70vh] rounded-card" />;
  if (query.isError || !query.data) return <ErrorState message={errorMessage(query.error)} />;
  const session = query.data;
  if (session.status !== "ready") {
    return <ErrorState message={session.status === "approved" ? "اعتُمدت هذه المسودة مسبقاً." : "المسودة غير جاهزة بعد."} />;
  }
  const segments = ((session.transcript as any)?.segments ?? []) as Segment[];
  const warnings = ((session.draft as any)?.warnings ?? []) as string[];
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const src = (field?: F) => field ? { onMouseEnter: () => setHighlight(field.sources), onFocus: () => setHighlight(field.sources) } : {};
  const toggle = (list: string, i: number) => setForm({ ...form, [list]: form[list].map((x: Pick<any>, j: number) => j === i ? { ...x, include: !x.include } : x) });
  const reviewCount = [...form.diagnoses, ...form.allergies, ...form.meds, ...form.labs, ...form.imaging].filter((x: Pick<any>) => x.field.needs_review).length;

  return (
    <div className="animate-fade-up">
      <PageHeader back={`/app/encounters/${encounterId}`} eyebrow={<><Sparkles className="me-1 inline size-4" /> HayatTek AI</>}
        title="مراجعة المسودة الذكية" description="قارن كل معلومة بما قيل فعلاً، عدّل ما يلزم، واختر ما يُضاف إلى الزيارة. القرار الطبي لك." />

      {session.is_mock && (
        <div className="mb-4 flex gap-3 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
          <Info className="mt-0.5 size-5 shrink-0" />
          مزود تجريبي: النص ناتج عن تسجيل اصطناعي أو مزود محاكاة وليس تفريغاً حقيقياً للصوت. لا تستخدمه مع مرضى حقيقيين.
        </div>
      )}
      {warnings.map((w) => <div key={w} className="mb-3 rounded-2xl bg-sunken p-3 text-sm text-muted">{w}</div>)}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card className="lg:sticky lg:top-20">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <span className="font-semibold">ما قيل في التسجيل</span>
            <span className="num text-xs text-subtle">{Math.round(session.audio_seconds)} ث</span>
          </div>
          <ol className="max-h-[70vh] space-y-2 overflow-y-auto p-4">
            {segments.map((seg) => {
              const sp = SPEAKER[seg.speaker] ?? SPEAKER.unknown;
              return (
                <li key={seg.id} className={cn("rounded-2xl border p-3 transition", highlight.includes(seg.id) ? "border-brand-400 bg-brand-50 ring-4 ring-brand-100" : "border-line")}>
                  <div className="mb-1 flex items-center gap-2 text-xs">
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", sp.tone)}><sp.icon className="size-3" /> {sp.label}</span>
                    <span className="num text-subtle">{Math.floor(seg.start / 60)}:{String(Math.floor(seg.start % 60)).padStart(2, "0")}</span>
                  </div>
                  <p className="leading-7">{seg.text}</p>
                </li>
              );
            })}
          </ol>
        </Card>

        <div className="space-y-4">
          <Card><CardBody className="space-y-4">
            <Field label="سبب الزيارة" optional><Input value={form.reason} onChange={set("reason")} /></Field>
            <div {...src(form.fields.chief_complaint)}><Field label="الشكوى الأساسية (كما قالها المريض)"><Textarea rows={2} value={form.complaint} onChange={set("complaint")} /></Field></div>
            <div {...src(form.fields.history ?? form.fields.duration)}><Field label="القصة المرضية والمدة"><Textarea rows={3} value={form.history} onChange={set("history")} /></Field></div>
            <div {...src(form.fields.examination)}><Field label="الفحص السريري"><Textarea rows={2} value={form.examination} onChange={set("examination")} /></Field></div>
          </CardBody></Card>

          <Card><CardBody>
            <div className="mb-3 font-semibold">العلامات الحيوية المذكورة</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {VITALS.map(([k, l, u]) => {
                const field = form.fields.vitals?.[k] as F | undefined;
                return (
                  <label key={k} {...src(field)} className={cn("rounded-2xl border p-2.5", field?.needs_review ? "border-warning bg-warning-soft" : "border-line bg-sunken/40")}>
                    <span className="text-[11px] text-muted">{l}</span>
                    <div className="flex items-baseline gap-1">
                      <input value={form.vitals[k] ?? ""} onChange={(e) => setForm({ ...form, vitals: { ...form.vitals, [k]: e.target.value } })}
                        className="num w-full bg-transparent text-lg font-semibold outline-none" placeholder="—" inputMode="decimal" />
                      <span className="text-[10px] text-subtle">{u}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          </CardBody></Card>

          <PickList title="التشخيصات التي ذكرها الطبيب" empty="لم يُذكر تشخيص" items={form.diagnoses} onToggle={(i) => toggle("diagnoses", i)} onHover={setHighlight}
            render={(d) => <span>{d.display} {d.certainty === "suspected" && <Badge tone="warning">مشتبه — ليس تشخيصاً نهائياً</Badge>}</span>} />
          <PickList title="الحساسيات" empty="لم تُذكر حساسية" items={form.allergies} onToggle={(i) => toggle("allergies", i)} onHover={setHighlight}
            render={(a) => <span>{a.substance}{a.reaction ? ` — ${a.reaction}` : ""}</span>} />
          <PickList title="الأدوية التي قرر الطبيب وصفها" empty="لم يُذكر دواء" items={form.meds} onToggle={(i) => toggle("meds", i)} onHover={setHighlight}
            footer="تُنشأ وصفة كمسودة فقط، وتكمل الجرعات وتعتمدها بنفسك في محرر الوصفة."
            render={(m) => <span>{m.name ?? "دواء غير محدد"} {m.dose_amount ? <span className="num">{m.dose_amount} {m.dose_unit}</span> : <Badge tone="warning">بلا جرعة</Badge>} <span className="text-xs text-muted">{m.text}</span></span>} />
          <PickList title="التحاليل المطلوبة" empty="لا يوجد" items={form.labs} onToggle={(i) => toggle("labs", i)} onHover={setHighlight}
            render={(l) => <span>{l.lab_test?.name ?? l.name}</span>} />
          <PickList title="التصوير المطلوب" empty="لا يوجد" items={form.imaging} onToggle={(i) => toggle("imaging", i)} onHover={setHighlight}
            render={(x) => <span>{label("modalities", x.modality)}</span>} />
          {form.current.length > 0 && (
            <Card className="p-4">
              <div className="mb-2 font-semibold">أدوية يتناولها المريض (للعلم)</div>
              <ul className="space-y-1.5 text-sm">
                {form.current.map((c: F, i: number) => (
                  <li key={i} onMouseEnter={() => setHighlight(c.sources)} className={cn(c.needs_review && "text-warning")}>
                    {c.value.name ?? c.value.text} {c.needs_review && `— ${c.review_reason}`}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card><CardBody className="space-y-4">
            <Field label="التقييم (بقلمك)" optional><Textarea rows={2} value={form.assessment} onChange={set("assessment")} /></Field>
            <Field label="الخطة" optional><Textarea rows={2} value={form.plan} onChange={set("plan")} /></Field>
            <div {...src(form.fields.follow_up)}><Field label="المتابعة" optional><Input value={form.follow_up_note} onChange={set("follow_up_note")} /></Field></div>
          </CardBody></Card>

          <Card className="space-y-3 p-4">
            {reviewCount > 0 && <p className="flex items-center gap-2 text-sm text-warning"><AlertTriangle className="size-4" /> {reviewCount} عناصر تحتاج مراجعتك (غير محددة افتراضياً).</p>}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--brand-600)]" checked={finalize} onChange={(e) => setFinalize(e.target.checked)} />
              اعتماد الزيارة مباشرة بعد التطبيق (الوصفة تبقى مسودة)
            </label>
            <Button size="lg" className="w-full" onClick={() => setConfirm(true)}><CheckCircle2 className="size-5" /> تطبيق على الزيارة</Button>
          </Card>
        </div>
      </div>

      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="تطبيق المسودة على الزيارة؟" confirmLabel="تطبيق"
        loading={approve.isPending} onConfirm={() => approve.mutate()}
        description="ستُضاف المعلومات التي اخترتها إلى الزيارة باسمك وعلى مسؤوليتك، مع ملاحظة أنها أُعدّت بمساعدة HayatTek AI." />
    </div>
  );
}

function PickList({ title, items, render, onToggle, onHover, empty, footer }: {
  title: string; items: Pick<any>[]; render: (v: any) => React.ReactNode; onToggle: (i: number) => void;
  onHover: (ids: string[]) => void; empty: string; footer?: string;
}) {
  return (
    <Card className="p-4">
      <div className="mb-2 font-semibold">{title}</div>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} onMouseEnter={() => onHover(item.field.sources)}
              className={cn("flex items-start gap-3 rounded-xl border p-3", item.field.needs_review ? "border-warning/50 bg-warning-soft/50" : "border-line")}>
              <input type="checkbox" checked={item.include} onChange={() => onToggle(i)} className="mt-1 size-4 accent-[var(--brand-600)]" aria-label="تضمين" />
              <div className="flex-1 text-sm">
                {render(item.value)}
                {item.field.needs_review && <div className="mt-1 text-xs text-warning">{item.field.review_reason}</div>}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-subtle">{empty}</p>}
      {footer && <p className="mt-2 text-xs text-muted">{footer}</p>}
    </Card>
  );
}
