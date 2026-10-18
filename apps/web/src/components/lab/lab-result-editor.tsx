"use client";

import { useQuery } from "@tanstack/react-query";
import { GripVertical, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Card, CardBody, CardHeader } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/lib/hooks";
import { m } from "@/lib/i18n";

import {
  AttachmentUploader, DocumentList, FinalizeDialog, fromLocalInput, type LabReport,
  requestItemLabel, type ServiceRequest, toLocalInput,
} from "./shared";

type Interpretation = Schemas["InterpretationEnum"] | "";
type ObservationBody = Schemas["LabObservationRequest"];

interface Row {
  key: string;
  test: string | null;
  name: string;
  mode: "numeric" | "text";
  value: string;
  unit: string;
  low: string;
  high: string;
  refText: string;
  interpretation: Interpretation;
  /** The user picked the interpretation themselves: never overwrite it. */
  manual: boolean;
}

let seq = 0;
const newKey = () => `r${++seq}`;

function emptyRow(partial: Partial<Row> = {}): Row {
  return {
    key: newKey(), test: null, name: "", mode: "numeric", value: "", unit: "", low: "", high: "",
    refText: "", interpretation: "", manual: false, ...partial,
  };
}

function rowsFromReport(report: LabReport): Row[] {
  return report.observations.map((o) => emptyRow({
    test: o.test ?? null,
    name: o.name,
    mode: o.value_numeric != null ? "numeric" : "text",
    value: o.value_numeric != null ? trimDecimal(o.value_numeric) : o.value_text ?? "",
    unit: o.unit ?? "",
    low: o.reference_low != null ? trimDecimal(o.reference_low) : "",
    high: o.reference_high != null ? trimDecimal(o.reference_high) : "",
    refText: o.reference_text ?? "",
    interpretation: (o.interpretation ?? "") as Interpretation,
    manual: true,
  }));
}

function rowsFromRequest(request?: ServiceRequest | null): Row[] {
  const items = request?.items ?? [];
  if (!items.length) return [emptyRow()];
  return items.map((it) => emptyRow({ test: it.lab_test ?? null, name: requestItemLabel(it) }));
}

/** "12.5000" → "12.5" (the API returns 4 decimal places). */
export function trimDecimal(v: string): string {
  return v.includes(".") ? v.replace(/\.?0+$/, "") : v;
}

const NUMBER = /^-?\d+(\.\d+)?$/;
const toNum = (v: string) => (NUMBER.test(v.trim()) ? Number(v.trim()) : null);

/** Suggestion only, from the range the lab itself typed. No built-in reference ranges. */
function suggest(row: Row): Interpretation {
  if (row.mode !== "numeric") return "";
  const v = toNum(row.value);
  if (v === null) return "";
  const low = toNum(row.low);
  const high = toNum(row.high);
  if (low === null && high === null) return "";
  if (low !== null && v < low) return "low";
  if (high !== null && v > high) return "high";
  return "normal";
}

export interface LabEditorValue {
  title: string;
  conclusion: string;
  specimen_collected_at: string | null;
  observations: ObservationBody[];
}

/**
 * Structured lab result entry. In "draft" mode it creates/updates a draft and can finalize it;
 * in "amend" mode it collects the corrected values and a reason.
 */
export function LabResultEditor({
  patientId, request, report, mode = "draft", onSaved, onFinalized, onAmend, onCancelAmend,
}: {
  patientId: string;
  request?: ServiceRequest | null;
  report?: LabReport | null;
  mode?: "draft" | "amend";
  onSaved?: (report: LabReport) => void;
  onFinalized?: (report: LabReport) => void;
  onAmend?: (value: LabEditorValue, reason: string) => Promise<void>;
  onCancelAmend?: () => void;
}) {
  const defaultTitle = React.useMemo(() => {
    const names = (request?.items ?? []).map(requestItemLabel).filter(Boolean);
    return names.length ? `نتائج: ${names.join("، ")}`.slice(0, 200) : "نتيجة تحليل مخبري";
  }, [request]);

  const [rows, setRows] = React.useState<Row[]>(() => (report ? rowsFromReport(report) : rowsFromRequest(request)));
  const [title, setTitle] = React.useState(report?.title ?? defaultTitle);
  const [conclusion, setConclusion] = React.useState(report?.conclusion ?? "");
  const [specimenAt, setSpecimenAt] = React.useState(toLocalInput(report?.specimen_collected_at));
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [finalizing, setFinalizing] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(!report);

  const touch = () => setDirty(true);
  const updateRow = (key: string, patch: Partial<Row>) => {
    touch();
    setRows((rs) => rs.map((r) => {
      if (r.key !== key) return r;
      const next = { ...r, ...patch };
      if (!next.manual) next.interpretation = suggest(next);
      return next;
    }));
  };

  const collect = (): LabEditorValue | null => {
    const errs: Record<string, string> = {};
    const used = rows.filter((r) => r.name.trim() || r.value.trim());
    if (!used.length) errs.form = "أدخل نتيجة واحدة على الأقل.";
    const observations: ObservationBody[] = used.map((r, i) => {
      if (!r.name.trim()) errs[r.key] = "أدخل اسم التحليل.";
      else if (!r.value.trim()) errs[r.key] = "أدخل قيمة النتيجة.";
      else if (r.mode === "numeric" && toNum(r.value) === null) errs[r.key] = "القيمة الرقمية غير صالحة. استخدم «نص» للقيم مثل Positive.";
      else if ((r.low && toNum(r.low) === null) || (r.high && toNum(r.high) === null)) errs[r.key] = "حدود المرجع يجب أن تكون أرقاماً.";
      return {
        position: i,
        test: r.test,
        name: r.name.trim(),
        value_numeric: r.mode === "numeric" ? r.value.trim() : null,
        value_text: r.mode === "text" ? r.value.trim() : "",
        unit: r.unit.trim(),
        reference_low: r.low.trim() || null,
        reference_high: r.high.trim() || null,
        reference_text: r.refText.trim(),
        interpretation: r.interpretation,
      };
    });
    if (!title.trim()) errs.title = "أدخل عنوان التقرير.";
    if (mode === "amend" && !reason.trim()) errs.reason = "اكتب سبب التصحيح.";
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error(errs.form ?? errs.title ?? errs.reason ?? "راجع الحقول المظللة.");
      return null;
    }
    return { title: title.trim(), conclusion: conclusion.trim(), specimen_collected_at: fromLocalInput(specimenAt), observations };
  };

  const saveDraft = async (): Promise<LabReport | null> => {
    const value = collect();
    if (!value) return null;
    setSaving(true);
    try {
      const saved = report
        ? await unwrap(api.PATCH("/api/v1/diagnostics/lab-reports/{id}", { params: { path: { id: report.id } }, body: value }))
        : await unwrap(api.POST("/api/v1/diagnostics/lab-reports", {
            body: { ...value, patient: patientId, service_request: request?.id ?? null },
          }));
      setDirty(false);
      onSaved?.(saved as unknown as LabReport);
      return saved as unknown as LabReport;
    } catch (err) {
      toast.error(errorMessage(err));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const finalize = async () => {
    setFinalizing(true);
    try {
      const saved = dirty || !report ? await saveDraft() : report;
      if (!saved) return;
      const final = await unwrap(api.POST("/api/v1/diagnostics/lab-reports/{id}/finalize", { params: { path: { id: saved.id } } }));
      toast.success("اعتُمدت النتيجة وأُرسلت إلى الطبيب والمريض");
      setConfirmOpen(false);
      onFinalized?.(final);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setFinalizing(false);
    }
  };

  const submitAmend = async () => {
    const value = collect();
    if (!value || !onAmend) return;
    setSaving(true);
    try {
      await onAmend(value, reason.trim());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={mode === "amend" ? "تصحيح النتائج" : "النتائج"}
          description="أدخل القيم والوحدات وحدود المرجع كما يصدرها مختبرك. التفسير المقترح يُحسب من الحدود التي تدخلها ويمكنك تغييره." />
        <CardBody className="space-y-3">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_36px] gap-2 px-1 text-xs text-subtle lg:grid">
            <span>التحليل</span><span>القيمة</span><span>الوحدة</span><span>المرجع</span><span>التفسير</span><span />
          </div>
          {rows.map((row, index) => (
            <ObservationRow key={row.key} row={row} index={index} error={errors[row.key]}
              onChange={(patch) => updateRow(row.key, patch)}
              onRemove={rows.length > 1 ? () => { touch(); setRows((rs) => rs.filter((r) => r.key !== row.key)); } : undefined} />
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={() => { touch(); setRows((rs) => [...rs, emptyRow()]); }}>
              <Plus className="size-4" /> سطر جديد
            </Button>
            <TestPicker onPick={(t) => { touch(); setRows((rs) => {
              const blank = rs.find((r) => !r.name.trim() && !r.value.trim());
              const filled = { test: t.id, name: t.name_ar || t.name_en };
              return blank ? rs.map((r) => (r.key === blank.key ? { ...r, ...filled } : r)) : [...rs, emptyRow(filled)];
            }); }} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="بيانات التقرير" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="عنوان التقرير" htmlFor="lr-title" error={errors.title} className="sm:col-span-2">
            <Input id="lr-title" maxLength={200} value={title} onChange={(e) => { touch(); setTitle(e.target.value); }} />
          </Field>
          <Field label="وقت سحب العينة" optional htmlFor="lr-specimen">
            <Input id="lr-specimen" type="datetime-local" dir="ltr" value={specimenAt}
              onChange={(e) => { touch(); setSpecimenAt(e.target.value); }} />
          </Field>
          <div className="hidden sm:block" />
          <Field label="الخلاصة / ملاحظات المختبر" optional htmlFor="lr-conclusion" className="sm:col-span-2">
            <Textarea id="lr-conclusion" rows={3} value={conclusion} onChange={(e) => { touch(); setConclusion(e.target.value); }} />
          </Field>
          {mode === "amend" && (
            <Field label="سبب التصحيح" htmlFor="lr-reason" error={errors.reason} className="sm:col-span-2"
              hint="يظهر للطبيب والمريض مع النسخة المصححة.">
              <Textarea id="lr-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: تصحيح وحدة قياس الكرياتينين" />
            </Field>
          )}
        </CardBody>
      </Card>

      {mode === "draft" && (
        <Card>
          <CardHeader title="المرفقات" description="أرفق نسخة PDF الموقعة من التقرير إن وجدت." />
          <CardBody className="space-y-3">
            <DocumentList documents={report?.documents ?? []} />
            <AttachmentUploader
              patientId={patientId}
              link={report ? { lab_report: report.id } : null}
              category="lab_result"
              defaultTitle={title || "تقرير المختبر"}
              onUploaded={() => report && onSaved?.(report)}
              disabledReason="احفظ المسودة أولاً لتتمكن من إرفاق الملفات."
            />
          </CardBody>
        </Card>
      )}

      <div className="sticky bottom-20 z-20 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-line bg-elevated/95 p-3 shadow-float backdrop-blur lg:bottom-4">
        {mode === "draft" ? (
          <>
            <span className="me-auto text-xs text-muted">
              {report ? (dirty ? "تغييرات غير محفوظة" : "المسودة محفوظة — لا يراها أحد غيرك") : "لم تُحفظ بعد"}
            </span>
            <Button variant="outline" loading={saving && !finalizing} onClick={() => saveDraft()}>حفظ كمسودة</Button>
            <Button onClick={() => { if (collect()) setConfirmOpen(true); }} disabled={saving}>اعتماد النتيجة</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onCancelAmend}>إلغاء</Button>
            <Button loading={saving} onClick={submitAmend}>حفظ التصحيح</Button>
          </>
        )}
      </div>

      <FinalizeDialog open={confirmOpen} onOpenChange={setConfirmOpen} onConfirm={finalize} loading={finalizing} what="نتيجة التحليل" />
    </div>
  );
}

function ObservationRow({
  row, index, error, onChange, onRemove,
}: {
  row: Row; index: number; error?: string;
  onChange: (patch: Partial<Row>) => void; onRemove?: () => void;
}) {
  const suggestion = suggest(row);
  const flagged = row.interpretation && row.interpretation !== "normal";
  return (
    <div className={cn("rounded-2xl border p-3 lg:border-0 lg:p-0",
      error ? "border-danger/40 bg-danger-soft/40 lg:rounded-xl lg:p-1" : "border-line")}>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_36px] lg:items-start">
        <div className="col-span-2 flex items-center gap-1 lg:col-span-1">
          <GripVertical className="hidden size-4 shrink-0 text-subtle lg:block" aria-hidden />
          <Input aria-label={`اسم التحليل ${index + 1}`} placeholder="اسم التحليل" value={row.name}
            onChange={(e) => onChange({ name: e.target.value })} className="h-10" />
        </div>
        <div className="col-span-2 flex gap-1 sm:col-span-1">
          <Input aria-label="القيمة" dir="ltr" inputMode={row.mode === "numeric" ? "decimal" : "text"}
            placeholder={row.mode === "numeric" ? "0.0" : "Positive"} value={row.value}
            onChange={(e) => onChange({ value: e.target.value })}
            className={cn("num h-10 font-semibold", flagged && "border-warning text-warning")} />
          <button type="button" onClick={() => onChange({ mode: row.mode === "numeric" ? "text" : "numeric" })}
            className="h-10 shrink-0 rounded-xl border border-line px-2 text-xs text-muted hover:text-fg"
            title="تبديل بين قيمة رقمية ونصية">
            {row.mode === "numeric" ? "123" : "نص"}
          </button>
        </div>
        <Input aria-label="الوحدة" dir="ltr" placeholder="mg/dL" value={row.unit}
          onChange={(e) => onChange({ unit: e.target.value })} className="num h-10" />
        <div className="col-span-2 sm:col-span-1">
          {row.mode === "numeric" ? (
            <div className="flex items-center gap-1" dir="ltr">
              <Input aria-label="الحد الأدنى" inputMode="decimal" placeholder="min" value={row.low}
                onChange={(e) => onChange({ low: e.target.value })} className="num h-10 px-2 text-center" />
              <span className="text-subtle">–</span>
              <Input aria-label="الحد الأعلى" inputMode="decimal" placeholder="max" value={row.high}
                onChange={(e) => onChange({ high: e.target.value })} className="num h-10 px-2 text-center" />
            </div>
          ) : (
            <Input aria-label="المرجع النصي" placeholder="مثال: Negative" value={row.refText} dir="ltr"
              onChange={(e) => onChange({ refText: e.target.value })} className="h-10" />
          )}
        </div>
        <div className="col-span-2 flex items-center gap-1 sm:col-span-1">
          <Select aria-label="التفسير" value={row.interpretation}
            onChange={(e) => onChange({ interpretation: e.target.value as Interpretation, manual: true })}
            className={cn("h-10 text-sm", flagged && "border-warning")}>
            <option value="">—</option>
            {Object.entries(m.interpretation).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </Select>
          {onRemove && (
            <Button type="button" variant="ghost" size="icon" aria-label="حذف السطر" onClick={onRemove} className="lg:hidden">
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
        <div className="hidden lg:block">
          {onRemove && (
            <Button type="button" variant="ghost" size="icon" aria-label="حذف السطر" onClick={onRemove}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>
      {(error || (row.manual && suggestion && suggestion !== row.interpretation) || (!row.manual && suggestion)) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 px-1 text-xs">
          {error && <span className="text-danger">{error}</span>}
          {!row.manual && suggestion && (
            <span className="flex items-center gap-1 text-subtle"><Sparkles className="size-3" /> تفسير مقترح من الحدود المدخلة</span>
          )}
          {row.manual && suggestion && suggestion !== row.interpretation && (
            <button type="button" className="flex items-center gap-1 text-brand-600 hover:underline"
              onClick={() => onChange({ interpretation: suggestion, manual: false })}>
              <Sparkles className="size-3" /> المقترح: {m.interpretation[suggestion as keyof typeof m.interpretation]}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function TestPicker({ onPick }: { onPick: (t: Schemas["LabTestType"]) => void }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const query = useDebounced(q.trim(), 250);
  const ref = React.useRef<HTMLDivElement>(null);
  const { data, isFetching } = useQuery({
    queryKey: ["lab-tests", query],
    queryFn: () => unwrap(api.GET("/api/v1/diagnostics/lab-tests", { params: { query: { q: query || undefined } } })),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen((o) => !o)}>
        <Search className="size-4" /> من دليل التحاليل
      </Button>
      {open && (
        <div className="absolute start-0 top-10 z-30 w-[min(22rem,calc(100vw-3rem))] rounded-2xl border border-line bg-elevated p-2 shadow-float">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم أو الرمز (CBC)…" className="h-10" />
          <ul className="mt-2 max-h-64 overflow-y-auto">
            {isFetching && !data && <li className="px-3 py-2 text-sm text-subtle">جارٍ البحث…</li>}
            {data?.length === 0 && <li className="px-3 py-2 text-sm text-subtle">لا يوجد تحليل مطابق. اكتب الاسم يدوياً في سطر جديد.</li>}
            {data?.slice(0, 50).map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => { onPick(t); setOpen(false); setQ(""); }}
                  className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-start text-sm hover:bg-sunken">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t.name_ar}</span>
                    <span className="block truncate text-xs text-subtle" dir="ltr">{t.name_en}</span>
                  </span>
                  <span className="num shrink-0 rounded-md bg-sunken px-1.5 py-0.5 text-xs text-muted">{t.code}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
