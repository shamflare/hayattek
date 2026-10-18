"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Ban, GitMerge, ShieldAlert, Undo2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceChips, Field, Textarea } from "@/components/ui/field";
import { Badge, Card, ErrorState, Skeleton, type Tone } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ageLabel, formatDate, formatDateTime, formatPhone, sexLabel } from "@/lib/format";
import { label, m } from "@/lib/i18n";

export type SuspectPair = Schemas["SuspectPair"];
export type MergeCase = Schemas["MergeCase"];
type Compare = Schemas["Compare"];
type Side = Schemas["CompareSide"];

const STRONG = ["health_card", "national_id_document", "family_booklet"];

export function ReasonBadges({ reasons }: { reasons: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {reasons.map((r) => <Badge key={r} tone={r === "same_national_id" ? "danger" : "warning"}>{label("mergeReasons", r)}</Badge>)}
    </div>
  );
}

const statusTone: Record<string, Tone> = { merged: "success", rejected: "neutral", reverted: "info", open: "warning" };
export function MergeStatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone[status] ?? "neutral"} dot>{label("mergeStatus", status)}</Badge>;
}

// ---------------------------------------------------------------- compare + decide

type Row = { label: string; get: (s: Side) => React.ReactNode; raw: (s: Side) => string };
const rows: Row[] = [
  { label: "الاسم الكامل", get: (s) => s.patient.full_name, raw: (s) => s.patient.full_name },
  { label: "اسم الأم", get: (s) => s.patient.mother_name || "—", raw: (s) => s.patient.mother_name ?? "" },
  { label: "الاسم بالإنجليزية", get: (s) => s.patient.full_name_en || "—", raw: (s) => s.patient.full_name_en ?? "" },
  { label: "الجنس", get: (s) => sexLabel(s.patient.sex), raw: (s) => s.patient.sex ?? "" },
  { label: "تاريخ الميلاد", get: (s) => s.patient.birth_date ? `${formatDate(s.patient.birth_date)} (${ageLabel(s.patient.age_years, s.patient.birth_date_precision)})` : "—", raw: (s) => s.patient.birth_date ?? "" },
  { label: "الهاتف", get: (s) => s.patient.phone ? <span className="num">{formatPhone(s.patient.phone)}</span> : "—", raw: (s) => s.patient.phone ?? "" },
  { label: "المدينة", get: (s) => [label("governorates", s.patient.governorate), s.patient.city].filter(Boolean).join(" — "), raw: (s) => `${s.patient.governorate ?? ""}${s.patient.city ?? ""}` },
  { label: "الرقم الصحي", get: (s) => <span className="num">{s.patient.health_number}</span>, raw: (s) => s.patient.health_number },
  { label: "أُنشئ الملف", get: (s) => formatDate(s.patient.created_at), raw: () => "" },
  { label: "منشآت مسجل فيها", get: (s) => <span className="num">{s.facts.facilities}</span>, raw: () => "" },
  { label: "حساب في التطبيق", get: (s) => s.facts.has_account ? "نعم" : "لا", raw: () => "" },
  { label: "أوصياء", get: (s) => <span className="num">{s.facts.guardians}</span>, raw: () => "" },
];

const countLabels: Record<string, string> = {
  encounters: "زيارات", conditions: "تشخيصات", allergies: "حساسيات", prescriptions: "وصفات",
  service_requests: "طلبات", lab_reports: "تحاليل", imaging_reports: "تقارير تصوير",
  documents: "مستندات", referrals: "إحالات",
};

/** Side-by-side comparison, choice of the surviving file, merge with evidence, or reject.
 * Render with `key` = the pair so each pair starts from a clean form. */
export function CompareDialog({ pair, onClose }: { pair: { a: string; b: string } | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [survivor, setSurvivor] = React.useState<"a" | "b">("a");
  const [step, setStep] = React.useState<"compare" | "merge" | "reject">("compare");
  const [checks, setChecks] = React.useState<string[]>([]);
  const [notes, setNotes] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);

  const query = useQuery({
    queryKey: ["patient-merges", "compare", pair?.a, pair?.b],
    queryFn: () => unwrap(api.GET("/api/v1/patient-merges/compare", { params: { query: { a: pair!.a, b: pair!.b } } })),
    enabled: Boolean(pair),
  });
  const data = query.data as Compare | undefined;
  const target = data ? (survivor === "a" ? data.a : data.b) : null;
  const source = data ? (survivor === "a" ? data.b : data.a) : null;

  const done = () => {
    queryClient.invalidateQueries({ queryKey: ["patient-merges"] });
    queryClient.invalidateQueries({ queryKey: ["patients"] });
    onClose();
  };
  const merge = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/patient-merges", {
      body: {
        source: source!.patient.id, target: target!.patient.id, evidence_checks: checks as never,
        evidence_notes: notes.trim(), reason: reason.trim(), confirm: confirmed,
      },
    })),
    onSuccess: () => { toast.success("تم دمج الملفين. يمكن التراجع من سجل القرارات."); done(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/patient-merges/reject", {
      body: { a: pair!.a, b: pair!.b, reason: reason.trim() },
    })),
    onSuccess: () => { toast.success("سُجل أن الملفين لشخصين مختلفين"); done(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const hasStrong = checks.some((c) => STRONG.includes(c));
  const canMerge = hasStrong && notes.trim().length >= 10 && reason.trim().length >= 5 && confirmed;
  const blocked = (data?.blockers.length ?? 0) > 0;

  const footer = step === "compare" ? (
    <>
      <Button variant="ghost" onClick={() => setStep("reject")} disabled={!data}><Ban className="size-4" /> ليسا الشخص نفسه</Button>
      <Button onClick={() => setStep("merge")} disabled={!data || blocked}><GitMerge className="size-4" /> متابعة إلى الدمج</Button>
    </>
  ) : step === "merge" ? (
    <>
      <Button variant="ghost" onClick={() => setStep("compare")}>رجوع</Button>
      <Button variant="danger" loading={merge.isPending} disabled={!canMerge} onClick={() => merge.mutate()}>
        <GitMerge className="size-4" /> دمج الملفين
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={() => setStep("compare")}>رجوع</Button>
      <Button loading={reject.isPending} disabled={reason.trim().length < 5} onClick={() => reject.mutate()}>حفظ القرار</Button>
    </>
  );

  return (
    <Dialog open={Boolean(pair)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl" footer={footer}
        title={step === "merge" ? "دمج الملفين" : step === "reject" ? "ملفان لشخصين مختلفين" : "مقارنة ملفين مشتبه بتكرارهما"}
        description={step === "compare" ? "قارن البيانات واختر الملف الذي يبقى. الدمج لا يتم إلا بعد التحقق من وثيقة هوية." : undefined}>
        {query.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
        ) : data && step === "compare" ? (
          <div className="space-y-5">
            <ReasonBadges reasons={data.reasons} />
            {data.blockers.length > 0 && (
              <div className="flex gap-2 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <div>
                  <div className="font-semibold">لا يمكن دمج هذين الملفين</div>
                  {data.blockers.map((b) => <div key={b}>{label("mergeWarnings", b)}</div>)}
                  <div className="mt-1 text-xs">إن كانت البيانات خاطئة صححها في الملف أولاً، ثم أعد المقارنة.</div>
                </div>
              </div>
            )}
            {data.warnings.length > 0 && (
              <div className="flex gap-2 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div>
                  <div className="font-semibold">اختلافات تستحق الانتباه</div>
                  {data.warnings.map((w) => <div key={w}>{label("mergeWarnings", w)}</div>)}
                </div>
              </div>
            )}
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-sunken text-xs text-muted">
                  <tr>
                    <th className="w-36 px-3 py-2 text-start font-medium" />
                    {(["a", "b"] as const).map((k) => (
                      <th key={k} className="px-3 py-2 text-start font-medium">
                        <label className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                          survivor === k ? "border-brand-500 bg-brand-50 text-brand-700 dark:text-brand-300" : "border-line bg-elevated text-fg")}>
                          <input type="radio" name="survivor" checked={survivor === k} onChange={() => setSurvivor(k)} className="accent-brand-600" />
                          {survivor === k ? "الملف الباقي" : "يُدمج في الآخر"}
                        </label>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((row) => {
                    const differs = row.raw(data.a) !== row.raw(data.b) && row.raw(data.a) !== "" && row.raw(data.b) !== "";
                    return (
                      <tr key={row.label} className={cn(differs && "bg-warning-soft/40")}>
                        <td className="px-3 py-2.5 text-xs text-muted">{row.label}</td>
                        <td className="px-3 py-2.5 font-medium">{row.get(data.a)}</td>
                        <td className="px-3 py-2.5 font-medium">{row.get(data.b)}</td>
                      </tr>
                    );
                  })}
                  {data.a.record_counts && data.b.record_counts && Object.keys(countLabels).map((key) => (
                    <tr key={key}>
                      <td className="px-3 py-2 text-xs text-muted">{countLabels[key]}</td>
                      <td className="px-3 py-2"><span className="num">{data.a.record_counts?.[key] ?? 0}</span></td>
                      <td className="px-3 py-2"><span className="num">{data.b.record_counts?.[key] ?? 0}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.a.record_counts && (
              <p className="text-xs text-muted">أعداد السجلات الطبية تظهر للطبيب فقط. ستنتقل كل السجلات إلى الملف الباقي دون حذف أي شيء.</p>
            )}
          </div>
        ) : data && step === "merge" && source && target ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-sunken/70 p-4 text-sm">
              <div><div className="text-xs text-muted">يُدمج</div><div className="font-semibold">{source.patient.full_name}</div><span className="num text-xs text-muted">{source.patient.health_number}</span></div>
              <ArrowLeft className="size-5 text-brand-600" />
              <div><div className="text-xs text-muted">في الملف الباقي</div><div className="font-semibold">{target.patient.full_name}</div><span className="num text-xs text-muted">{target.patient.health_number}</span></div>
            </div>
            <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
              <li>تنتقل كل السجلات والمستندات والموافقات والأوصياء والتسجيلات إلى الملف الباقي، دون حذف أي شيء.</li>
              <li>يبقى الرقم الصحي القديم وبطاقته صالحين ويقودان إلى الملف الباقي.</li>
              <li>يُسجل اسمك وسبب الدمج والأدلة في سجل التدقيق، ويمكن التراجع خلال المدة المسموحة.</li>
            </ul>
            <Field label="ما الذي تحققت منه؟" hint="مطلوب وثيقة هوية واحدة على الأقل (البطاقة، أو الهوية، أو دفتر العائلة).">
              <ChoiceChips multiple value={checks} onChange={(v) => setChecks(v as string[])}
                options={Object.entries(m.mergeEvidence).map(([value, text]) => ({ value, label: text }))} />
            </Field>
            {!hasStrong && checks.length > 0 && <p className="text-xs text-danger">لا يكفي هذا: أضف وثيقة هوية.</p>}
            <Field label="تفاصيل التحقق" htmlFor="m-notes" hint="مثال: اطلعت على الهوية رقم … وتطابق الاسم وتاريخ الميلاد مع الملفين.">
              <Textarea id="m-notes" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Field label="سبب الدمج" htmlFor="m-reason">
              <Textarea id="m-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: أُنشئ ملف ثانٍ بالخطأ لعدم إحضار البطاقة" />
            </Field>
            <label className="flex items-start gap-2 rounded-2xl border border-line p-3 text-sm">
              <input type="checkbox" className="mt-1 accent-brand-600" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>أؤكد أنني تحققت شخصياً من أن الملفين لنفس الشخص، وأتحمل مسؤولية هذا القرار.</span>
            </label>
          </div>
        ) : data && step === "reject" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">لن يُقترح هذان الملفان مجدداً كتكرار في منشأتك. لا يتغير أي شيء في الملفين.</p>
            <Field label="سبب القرار" htmlFor="r-reason">
              <Textarea id="r-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: توأمان، تحققت من هويتيهما" />
            </Field>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- history

function Summary({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  return (
    <div className="text-xs text-muted">
      <span className="font-medium text-fg">{title}: </span>
      {entries.map(([k, n], i) => <span key={k}>{i > 0 && "، "}{label("mergeTables", k)} (<span className="num">{n}</span>)</span>)}
    </div>
  );
}

export function MergeCaseCard({ item }: { item: MergeCase }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const revert = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/patient-merges/{id}/revert", {
      params: { path: { id: item.id } }, body: { reason: reason.trim() },
    })),
    onSuccess: () => {
      toast.success("تم التراجع عن الدمج وأُعيدت السجلات إلى ملفها الأصلي");
      setOpen(false); setReason("");
      queryClient.invalidateQueries({ queryKey: ["patient-merges"] });
      queryClient.invalidateQueries({ queryKey: ["patients"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const report = (item.revert_report ?? {}) as { created_after_merge?: { model: string; ids: string[] }[] };
  const after = report.created_after_merge ?? [];
  const evidence = (item.evidence_checks ?? []) as string[];
  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{item.source.full_name}</span>
          <span className="num text-xs text-muted">{item.source.health_number}</span>
          <ArrowLeft className="size-4 text-subtle" />
          <span className="font-semibold">{item.target.full_name}</span>
          <span className="num text-xs text-muted">{item.target.health_number}</span>
        </div>
        <MergeStatusBadge status={item.status} />
      </div>
      <div className="text-xs text-muted">
        {item.reviewed_by_name} · {label("roles", item.reviewer_role)} · {formatDateTime(item.reviewed_at)}
      </div>
      {item.decision_reason && <p className="text-sm"><span className="text-muted">السبب: </span>{item.decision_reason}</p>}
      {evidence.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{evidence.map((e) => <Badge key={e} tone="brand">{label("mergeEvidence", e)}</Badge>)}</div>
      )}
      {item.evidence_notes && <p className="text-sm text-muted">{item.evidence_notes}</p>}
      <Summary title="نُقل" counts={item.moved_summary} />
      <Summary title="بقي على الملف المدمج (موجود مسبقاً في الملف الباقي)" counts={item.kept_summary} />
      {item.status === "reverted" && (
        <div className="rounded-2xl bg-info-soft p-3 text-sm text-info">
          تراجع {item.reverted_by_name} {formatDateTime(item.reverted_at)} — {item.revert_reason}
          {after.length > 0 && (
            <div className="mt-1 text-xs">
              سجلات أُضيفت للملف الباقي بعد الدمج وبقيت فيه وتحتاج مراجعة يدوية:{" "}
              {after.map((g, i) => <span key={g.model}>{i > 0 && "، "}{label("mergeTables", g.model)} (<span className="num">{g.ids.length}</span>)</span>)}
            </div>
          )}
        </div>
      )}
      {item.can_revert && (
        <div className="flex justify-end border-t border-line pt-3">
          <Button size="sm" variant="danger-ghost" onClick={() => setOpen(true)}><Undo2 className="size-4" /> تراجع عن الدمج</Button>
        </div>
      )}
      <ConfirmDialog open={open} onOpenChange={setOpen} tone="danger" title="التراجع عن الدمج؟"
        confirmLabel="تراجع" loading={revert.isPending} onConfirm={() => reason.trim().length >= 5 && revert.mutate()}
        description="تعود السجلات التي نُقلت إلى ملفها الأصلي تماماً، ويعود الملف المدمج فعالاً. السجلات التي أُضيفت بعد الدمج تبقى في الملف الباقي وتُعرض للمراجعة.">
        <Field label="سبب التراجع" htmlFor="u-reason" error={reason && reason.trim().length < 5 ? "اكتب سبباً واضحاً." : undefined}>
          <Textarea id="u-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </Card>
  );
}
