"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, CheckCircle2, FileSearch, Minus, Plus, RefreshCw, RotateCcw, ScanText, Trash2,
} from "lucide-react";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { LabResultEditor, TestPicker } from "@/components/lab/lab-result-editor";
import { LabReportView } from "@/components/lab/report-view";
import type { LabReport } from "@/components/lab/shared";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton } from "@/components/ui/surface";
import { api, errorMessage, fetchDocumentBlob, isApiError, type Schemas, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { label, m } from "@/lib/i18n";

/* ---------------------------------------------------------------- extraction shape (server: ocr_parsing.py) */

interface XField { value: string | null; confidence: number | null; raw: string }
interface XRow {
  name: XField; value_numeric: XField; value_text: XField; unit: XField;
  reference_low: XField; reference_high: XField; reference_text: XField; flag: XField;
  source_line: string; confidence: number; needs_review: boolean; issues: string[];
  low_confidence_fields: string[]; unparsed?: string;
}
interface XMeta { value: string | null; confidence: number | null; source_line?: string; needs_review: boolean; issues: string[] }
interface Extracted {
  document_type?: { value: string; confidence: number | null };
  date?: XMeta; issuer?: XMeta; rows?: XRow[]; review_threshold?: number;
}

type Interpretation = Schemas["InterpretationEnum"] | "";
type CellKey = "name" | "value" | "unit" | "low" | "high" | "refText";

interface Row {
  key: string;
  test: string | null;
  testLabel: string;
  name: string;
  mode: "numeric" | "text";
  value: string;
  unit: string;
  low: string;
  high: string;
  refText: string;
  interpretation: Interpretation;
  /** Cells the engine was unsure about (highlighted until edited). */
  weak: Set<CellKey>;
  /** Cells the engine could not read at all (left empty on purpose). */
  unreadable: Partial<Record<CellKey, string>>;
  source: string;
  issues: string[];
  needsReview: boolean;
  confirmed: boolean;
}

let seq = 0;
const newKey = () => `o${++seq}`;

function blankRow(): Row {
  return {
    key: newKey(), test: null, testLabel: "", name: "", mode: "numeric", value: "", unit: "", low: "",
    high: "", refText: "", interpretation: "", weak: new Set(), unreadable: {}, source: "", issues: [],
    needsReview: false, confirmed: true,
  };
}

function rowFromExtraction(x: XRow, threshold: number): Row {
  const weak = new Set<CellKey>();
  const map: [CellKey, XField][] = [
    ["name", x.name], ["value", x.value_numeric.value != null ? x.value_numeric : x.value_text],
    ["unit", x.unit], ["low", x.reference_low], ["high", x.reference_high], ["refText", x.reference_text],
  ];
  const unreadable: Row["unreadable"] = {};
  for (const [k, f] of map) {
    if (f.confidence != null && f.confidence < threshold) weak.add(k);
    if (f.value == null && f.raw) unreadable[k] = f.raw;
  }
  const flag = x.flag.value;
  return {
    key: newKey(), test: null, testLabel: "",
    name: x.name.value ?? "",
    mode: x.value_numeric.value != null || x.value_text.value == null ? "numeric" : "text",
    value: x.value_numeric.value ?? x.value_text.value ?? "",
    unit: x.unit.value ?? "",
    low: x.reference_low.value ?? "",
    high: x.reference_high.value ?? "",
    refText: x.reference_text.value ?? "",
    interpretation: flag === "H" ? "high" : flag === "L" ? "low" : "",
    weak, unreadable, source: x.source_line, issues: x.issues, needsReview: x.needs_review,
    confirmed: !x.needs_review,
  };
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/* ---------------------------------------------------------------- page */

export default function DocumentReviewPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const doc = useQuery({
    queryKey: ["document", id],
    queryFn: () => unwrap(api.GET("/api/v1/documents/{id}", { params: { path: { id } } })),
  });
  const ocr = useQuery({
    queryKey: ["document-ocr", id],
    queryFn: async () => {
      try {
        return await unwrap(api.GET("/api/v1/documents/{id}/ocr", { params: { path: { id } } }));
      } catch (err) {
        if (isApiError(err) && err.code === "ocr_not_found") return null;
        throw err;
      }
    },
    refetchInterval: (q) => (q.state.data?.status === "queued" ? 3000 : false),
  });

  const run = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/documents/{id}/ocr/run", { params: { path: { id } } })),
    onSuccess: (res) => {
      queryClient.setQueryData(["document-ocr", id], res);
      if (res.status === "done") toast.success("اكتملت القراءة الآلية — راجع القيم قبل الحفظ");
      else if (res.status === "failed") toast.error(label("ocrErrors", res.error_code) || "فشلت القراءة");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const patientId = doc.data?.patient;
  const back = patientId ? `/app/patients/${patientId}` : "/app/patients";

  if (doc.error || ocr.error) {
    const e = doc.error ?? ocr.error;
    return (
      <>
        <PageHeader title="مراجعة القراءة الآلية" back={back} />
        <ErrorState message={errorMessage(e)} onRetry={() => { doc.refetch(); ocr.refetch(); }} />
      </>
    );
  }

  const result = ocr.data;
  const reviewed = result?.status === "reviewed" && result.lab_report;

  return (
    <div className="pb-28">
      <PageHeader
        back={back}
        eyebrow="مراجعة القراءة الآلية (OCR)"
        title={doc.data ? doc.data.title : <Skeleton className="h-8 w-56" />}
        description={result ? (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={result.status === "done" ? "info" : result.status === "reviewed" ? "success" : result.status === "failed" ? "danger" : "neutral"}>
              {label("ocrStatus", result.status)}
            </Badge>
            {result.mean_confidence != null && (
              <span>متوسط الثقة <span className="num">{Math.round(result.mean_confidence)}%</span></span>
            )}
            {result.engine && <span className="text-subtle" dir="ltr">{result.engine} {result.engine_version}</span>}
          </span>
        ) : undefined}
        actions={result && !reviewed && result.status !== "queued" && (
          <Button variant="outline" loading={run.isPending} onClick={() => run.mutate()}>
            <RotateCcw className="size-4" /> إعادة القراءة
          </Button>
        )}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
        <div className="lg:sticky lg:top-4">
          {doc.data ? <OriginalViewer doc={doc.data} /> : <Skeleton className="h-[50vh] rounded-card" />}
        </div>

        <div className="min-w-0 space-y-5">
          {ocr.isLoading || !doc.data ? (
            <><Skeleton className="h-40 rounded-card" /><Skeleton className="h-72 rounded-card" /></>
          ) : reviewed ? (
            <ConvertedReport reportId={result.lab_report!} patientId={doc.data.patient} reviewer={result.reviewed_by_name} at={result.reviewed_at} />
          ) : result == null ? (
            <Card>
              <CardBody>
                <EmptyState icon={<ScanText className="size-7" />} title="لم تُشغَّل القراءة الآلية لهذا المستند"
                  description="يقرأ المحرك المحلي النص ويقترح القيم، ثم تراجعها أنت قبل إنشاء أي سجل."
                  action={<Button loading={run.isPending} onClick={() => run.mutate()}><FileSearch className="size-4" /> قراءة المستند آلياً</Button>} />
              </CardBody>
            </Card>
          ) : result.status === "queued" ? (
            <Card><CardBody className="flex items-center gap-3 py-8 text-muted">
              <RefreshCw className="size-5 animate-spin" /> جارٍ قراءة المستند… قد يستغرق ذلك بضع ثوانٍ لكل صفحة.
            </CardBody></Card>
          ) : (
            <ReviewForm key={`${result.id}-${result.updated_at}`} documentId={id} result={result}
              documentDate={doc.data.document_date ?? null}
              onConverted={(report) => {
                queryClient.setQueryData(["lab-report", report.id], report);
                queryClient.invalidateQueries({ queryKey: ["document-ocr", id] });
                queryClient.invalidateQueries({ queryKey: ["timeline"] });
              }} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- original document */

function OriginalViewer({ doc }: { doc: Schemas["Document"] }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [zoom, setZoom] = React.useState(1);
  const isPdf = doc.mime_type === "application/pdf";
  const viewable = isPdf || ["image/jpeg", "image/png", "image/webp"].includes(doc.mime_type);
  React.useEffect(() => {
    if (!viewable) return;
    let objectUrl: string | null = null;
    fetchDocumentBlob(doc.id).then((u) => { objectUrl = u; setUrl(u); }).catch(() => setFailed(true));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.id, viewable]);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <span className="text-sm font-semibold">المستند الأصلي</span>
        {!isPdf && viewable && (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" aria-label="تصغير" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><Minus className="size-4" /></Button>
            <span className="num w-12 text-center text-xs text-muted">{Math.round(zoom * 100)}%</span>
            <Button size="icon" variant="ghost" aria-label="تكبير" onClick={() => setZoom((z) => Math.min(4, z + 0.25))}><Plus className="size-4" /></Button>
          </div>
        )}
      </div>
      {!viewable ? (
        <p className="p-4 text-sm text-muted">لا يمكن معاينة هذا النوع داخل المتصفح.</p>
      ) : failed ? (
        <div className="p-4"><ErrorState message="تعذر تحميل الملف (قد يكون قيد الفحص الأمني)." /></div>
      ) : !url ? (
        <Skeleton className="h-[50vh] rounded-none" />
      ) : isPdf ? (
        <iframe src={url} title={doc.title} className="h-[55vh] w-full lg:h-[78vh]" />
      ) : (
        <div className="h-[55vh] overflow-auto bg-sunken lg:h-[78vh]" dir="ltr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={doc.title} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} className="block" />
        </div>
      )}
      <p className="border-t border-line px-4 py-2 text-xs text-subtle">الملف الأصلي محفوظ كما هو ولا يُعدَّل.</p>
    </Card>
  );
}

/* ---------------------------------------------------------------- review form */

function ReviewForm({
  documentId, result, documentDate, onConverted,
}: {
  documentId: string;
  result: Schemas["OcrResult"];
  documentDate: string | null;
  onConverted: (report: LabReport) => void;
}) {
  const x = (result.extracted ?? {}) as Extracted;
  const threshold = x.review_threshold ?? 0.8;
  const [rows, setRows] = React.useState<Row[]>(() => {
    const extracted = (x.rows ?? []).map((r) => rowFromExtraction(r, threshold));
    return extracted.length ? extracted : [blankRow()];
  });
  const [title, setTitle] = React.useState("نتيجة تحليل مستوردة من مستند");
  const [labName, setLabName] = React.useState(x.issuer?.value ?? "");
  const [date, setDate] = React.useState(x.date?.value ?? documentDate ?? "");
  const [labEdited, setLabEdited] = React.useState(false);
  const [dateEdited, setDateEdited] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const update = (key: string, patch: Partial<Row>, cell?: CellKey) => setRows((rs) => rs.map((r) => {
    if (r.key !== key) return r;
    const weak = new Set(r.weak);
    if (cell) weak.delete(cell);
    return { ...r, ...patch, weak };
  }));

  const pending = rows.filter((r) => !r.confirmed).length;

  const convert = useMutation({
    mutationFn: async () => {
      const errs: Record<string, string> = {};
      const used = rows.filter((r) => r.name.trim() || r.value.trim());
      if (!used.length) errs.form = "أدخل نتيجة واحدة على الأقل.";
      for (const r of used) {
        if (!r.confirmed) errs[r.key] = "أكّد مراجعة هذا السطر أو احذفه.";
        else if (!r.name.trim()) errs[r.key] = "أدخل اسم التحليل.";
        else if (!r.value.trim()) errs[r.key] = "القيمة فارغة: اكتبها من المستند الأصلي أو احذف السطر.";
        else if (r.mode === "numeric" && !NUMBER.test(r.value.trim())) errs[r.key] = "القيمة الرقمية غير صالحة (استخدم «نص» للقيم مثل Negative).";
        else if ((r.low && !NUMBER.test(r.low.trim())) || (r.high && !NUMBER.test(r.high.trim()))) errs[r.key] = "حدود المرجع يجب أن تكون أرقاماً.";
      }
      if (!title.trim()) errs.title = "أدخل عنوان التقرير.";
      setErrors(errs);
      if (Object.keys(errs).length) throw new Error(errs.form ?? errs.title ?? "راجع الأسطر المظللة قبل المتابعة.");
      return unwrap(api.POST("/api/v1/documents/{id}/ocr/convert-to-lab-report", {
        params: { path: { id: documentId } },
        body: {
          title: title.trim(),
          external_lab_name: labName.trim(),
          result_date: date || null,
          observations: used.map((r, i) => ({
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
          })),
        },
      }));
    },
    onSuccess: (report) => {
      toast.success("أُنشئت مسودة تقرير مختبر — راجعها ثم اعتمدها");
      onConverted(report as unknown as LabReport);
    },
    onError: (e) => toast.error(e instanceof Error && !("body" in e) ? e.message : errorMessage(e)),
  });

  const docType = x.document_type;
  return (
    <>
      {result.status === "failed" && (
        <Notice tone="danger" title="فشلت القراءة الآلية">{label("ocrErrors", result.error_code)} يمكنك إدخال القيم يدوياً من المستند.</Notice>
      )}
      {result.status === "unavailable" && (
        <Notice tone="neutral" title="محرك القراءة الآلية غير مفعّل">أدخل القيم يدوياً من المستند الأصلي؛ سير المراجعة نفسه يبقى متاحاً.</Notice>
      )}
      {result.status === "done" && (
        <Notice tone="warning" title="اقتراحات آلية — ليست نتائج معتمدة">
          الخلايا المظللة قرأها المحرك بثقة منخفضة، والخلايا الفارغة لم تُقرأ ولم يُخمَّن محتواها. قارن كل قيمة بالمستند الأصلي.
          {docType && docType.value !== "lab_result" && <> نوع المستند المتوقع: <b>{label("ocrDocType", docType.value)}</b>.</>}
        </Notice>
      )}

      <Card>
        <CardHeader title="بيانات التقرير" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="عنوان التقرير" htmlFor="ocr-title" error={errors.title} className="sm:col-span-2">
            <Input id="ocr-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="اسم المختبر" optional htmlFor="ocr-lab" hint={hintFor(x.issuer, labEdited)}>
            <Input id="ocr-lab" maxLength={200} value={labName}
              className={cn(!labEdited && x.issuer?.needs_review && x.issuer?.value && "border-warning bg-warning-soft/40")}
              onChange={(e) => { setLabEdited(true); setLabName(e.target.value); }} />
          </Field>
          <Field label="تاريخ النتيجة" optional htmlFor="ocr-date" hint={hintFor(x.date, dateEdited)}>
            <Input id="ocr-date" type="date" dir="ltr" value={date}
              className={cn(!dateEdited && x.date?.needs_review && x.date?.value && "border-warning bg-warning-soft/40")}
              onChange={(e) => { setDateEdited(true); setDate(e.target.value); }} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="النتائج المستخرجة"
          description={`${rows.length} سطر${pending ? ` · ${pending} بحاجة لتأكيد المراجعة` : ""}`} />
        <CardBody className="space-y-3">
          {rows.map((row, i) => (
            <ReviewRow key={row.key} row={row} index={i} error={errors[row.key]}
              onChange={(patch, cell) => update(row.key, patch, cell)}
              onRemove={() => setRows((rs) => rs.filter((r) => r.key !== row.key))} />
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, blankRow()])}>
            <Plus className="size-4" /> سطر جديد
          </Button>
        </CardBody>
      </Card>

      {result.text && (
        <details className="rounded-2xl border border-line bg-elevated p-4 text-sm">
          <summary className="cursor-pointer font-medium">النص المقروء كاملاً</summary>
          <pre dir="auto" className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap font-sans leading-7 text-muted">{result.text}</pre>
        </details>
      )}

      <div className="sticky bottom-20 z-20 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-line bg-elevated/95 p-3 shadow-float backdrop-blur lg:bottom-4">
        <span className="me-auto text-xs text-muted">
          تُنشأ مسودة لا يراها أحد غيرك حتى تعتمدها. لا يُحفظ إلا ما في هذا النموذج.
        </span>
        <Button loading={convert.isPending} onClick={() => convert.mutate()}>
          <CheckCircle2 className="size-4" /> إنشاء مسودة تقرير مختبر
        </Button>
      </div>
    </>
  );
}

function hintFor(meta: XMeta | undefined, edited: boolean): string | undefined {
  if (!meta || edited) return undefined;
  if (meta.value == null) return "لم يُقرأ من المستند — أدخله يدوياً إن وُجد.";
  const issues = meta.issues.filter((i) => i !== "not_found").map((i) => label("ocrIssues", i));
  return issues.length ? `تحقق: ${issues.join("، ")}` : undefined;
}

function Notice({ tone, title, children }: { tone: "warning" | "danger" | "neutral"; title: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex gap-3 rounded-2xl border p-4 text-sm leading-7",
      tone === "warning" ? "border-warning/30 bg-warning-soft/50" : tone === "danger" ? "border-danger/30 bg-danger-soft/50" : "border-line bg-sunken/60")}>
      <AlertTriangle className={cn("mt-1 size-4 shrink-0", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-muted")} />
      <div><div className="font-semibold">{title}</div><div className="text-muted">{children}</div></div>
    </div>
  );
}

function ReviewRow({
  row, index, error, onChange, onRemove,
}: {
  row: Row; index: number; error?: string;
  onChange: (patch: Partial<Row>, cell?: CellKey) => void; onRemove: () => void;
}) {
  const cellClass = (cell: CellKey) => cn("num h-10",
    row.weak.has(cell) && "border-warning bg-warning-soft/50",
    row.unreadable[cell] !== undefined && !row[cell === "refText" ? "refText" : cell] && "border-dashed border-danger/60");
  const placeholder = (cell: CellKey, fallback: string) =>
    row.unreadable[cell] !== undefined ? "غير مقروء" : fallback;

  return (
    <div className={cn("rounded-2xl border p-3",
      error ? "border-danger/50 bg-danger-soft/30" : row.confirmed ? "border-line" : "border-warning/50 bg-warning-soft/20")}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
        <Input aria-label={`اسم التحليل ${index + 1}`} placeholder={placeholder("name", "اسم التحليل")} value={row.name} dir="auto"
          className={cn("col-span-2 sm:col-span-1", cellClass("name"))} onChange={(e) => onChange({ name: e.target.value }, "name")} />
        <div className="flex gap-1">
          <Input aria-label="القيمة" dir="ltr" inputMode={row.mode === "numeric" ? "decimal" : "text"}
            placeholder={placeholder("value", row.mode === "numeric" ? "0.0" : "Negative")} value={row.value}
            className={cn("font-semibold", cellClass("value"))} onChange={(e) => onChange({ value: e.target.value }, "value")} />
          <button type="button" onClick={() => onChange({ mode: row.mode === "numeric" ? "text" : "numeric" })}
            className="h-10 shrink-0 rounded-xl border border-line px-2 text-xs text-muted hover:text-fg" title="تبديل بين قيمة رقمية ونصية">
            {row.mode === "numeric" ? "123" : "نص"}
          </button>
        </div>
        <Input aria-label="الوحدة" dir="ltr" placeholder={placeholder("unit", "الوحدة")} value={row.unit}
          className={cellClass("unit")} onChange={(e) => onChange({ unit: e.target.value }, "unit")} />
        <div className="col-span-2 flex items-center gap-1 sm:col-span-1" dir="ltr">
          <Input aria-label="الحد الأدنى" inputMode="decimal" placeholder="min" value={row.low}
            className={cn("px-2 text-center", cellClass("low"))} onChange={(e) => onChange({ low: e.target.value }, "low")} />
          <span className="text-subtle">–</span>
          <Input aria-label="الحد الأعلى" inputMode="decimal" placeholder="max" value={row.high}
            className={cn("px-2 text-center", cellClass("high"))} onChange={(e) => onChange({ high: e.target.value }, "high")} />
        </div>
        <Input aria-label="المرجع النصي" dir="ltr" placeholder="مرجع نصي (اختياري)" value={row.refText}
          className={cellClass("refText")} onChange={(e) => onChange({ refText: e.target.value }, "refText")} />
        <Select aria-label="التفسير" value={row.interpretation} className="h-10 text-sm"
          onChange={(e) => onChange({ interpretation: e.target.value as Interpretation })}>
          <option value="">التفسير —</option>
          {Object.entries(m.interpretation).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </Select>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <TestPicker onPick={(t) => onChange({ test: t.id, testLabel: t.short_name || t.name_en, name: row.name || t.name_en })} />
        {row.test && (
          <Badge tone="brand">{row.testLabel}
            <button type="button" aria-label="إزالة الربط بالدليل" className="ms-1" onClick={() => onChange({ test: null, testLabel: "" })}>×</button>
          </Badge>
        )}
        {row.issues.filter((i) => i !== "low_confidence").map((i) => <Badge key={i} tone="warning">{label("ocrIssues", i)}</Badge>)}
        {row.weak.size > 0 && <Badge tone="warning">ثقة منخفضة</Badge>}
        <span className="ms-auto flex items-center gap-1">
          {row.needsReview && (
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-sunken">
              <input type="checkbox" checked={row.confirmed} onChange={(e) => onChange({ confirmed: e.target.checked })} className="size-4 accent-[var(--color-brand-600)]" />
              راجعتُ هذا السطر
            </label>
          )}
          <Button type="button" variant="ghost" size="icon" aria-label="حذف السطر" onClick={onRemove}><Trash2 className="size-4" /></Button>
        </span>
      </div>
      {(row.source || Object.keys(row.unreadable).length > 0) && (
        <div className="mt-1.5 space-y-0.5 text-xs text-subtle">
          {row.source && <div>السطر المقروء: <bdi dir="auto" className="text-muted">{row.source}</bdi></div>}
          {Object.entries(row.unreadable).map(([k, raw]) => (
            <div key={k}>نص غير مفهوم في هذا الموضع: <bdi dir="ltr" className="num text-danger">{raw}</bdi> — لم تُملأ قيمة.</div>
          ))}
        </div>
      )}
      {error && <div className="mt-1.5 text-xs text-danger">{error}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- after conversion */

function ConvertedReport({ reportId, patientId, reviewer, at }: {
  reportId: string; patientId: string; reviewer?: string | null; at?: string | null;
}) {
  const queryClient = useQueryClient();
  const report = useQuery({
    queryKey: ["lab-report", reportId],
    queryFn: () => unwrap(api.GET("/api/v1/diagnostics/lab-reports/{id}", { params: { path: { id: reportId } } })),
  });
  if (report.error) return <ErrorState message={errorMessage(report.error)} onRetry={() => report.refetch()} />;
  if (!report.data) return <Skeleton className="h-72 rounded-card" />;
  const r = report.data as LabReport;
  const refresh = (saved: LabReport) => {
    queryClient.setQueryData(["lab-report", saved.id], saved);
    queryClient.invalidateQueries({ queryKey: ["document-ocr"] });
    queryClient.invalidateQueries({ queryKey: ["timeline"] });
  };
  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-2xl border border-success/30 bg-success-soft/50 p-4 text-sm leading-7">
        <CheckCircle2 className="mt-1 size-4 shrink-0 text-success" />
        <div>
          <div className="font-semibold">{r.status === "draft" ? "مسودة تقرير مختبر من هذا المستند" : "اعتُمد التقرير"}</div>
          <div className="text-muted">
            راجعها {reviewer ?? "—"}{at ? ` · ${formatDateTime(at)}` : ""}.
            {r.status === "draft" && " عدّل ما يلزم ثم اعتمد النتيجة لتظهر في ملف المريض."}
          </div>
        </div>
      </div>
      {r.status === "draft"
        ? <LabResultEditor patientId={patientId} report={r} onSaved={refresh} onFinalized={refresh} />
        : <LabReportView report={r} />}
    </div>
  );
}
