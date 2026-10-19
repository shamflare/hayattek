"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileUp, GitMerge, Pill, PackageCheck, XCircle } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { KpiTile, Pager, SearchBox, usePageFor } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceChips, Field, Input, Textarea } from "@/components/ui/field";
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, SkeletonList, type Tone } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { label } from "@/lib/i18n";

type CatalogImport = Schemas["CatalogImport"];
type AdminMedication = Schemas["AdminMedication"];
type PreviewRow = { row: number; action: string; name: string; strength: string; dosage_form: string; manufacturer: string; detail: string };
type ErrorRow = { row: number; field: string; message: string };

function readCookie(name: string): string | undefined {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1]) : undefined;
}

/** Multipart upload (the generated client focuses on JSON bodies). Platform admin: no context. */
async function uploadCatalog(form: FormData): Promise<CatalogImport> {
  const csrf = readCookie("hayat_csrftoken");
  const response = await fetch("/api/v1/admin/catalog/imports", {
    method: "POST", body: form, credentials: "same-origin", headers: csrf ? { "X-CSRFToken": csrf } : {},
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.message || "upload failed"), { status: response.status, body });
  return body;
}

const actionTone: Record<string, Tone> = { create: "success", update: "info", unchanged: "neutral", duplicate: "warning", error: "danger" };
const importTone: Record<string, Tone> = { previewed: "warning", committed: "success", discarded: "neutral", failed: "danger" };

// ---------------------------------------------------------------- import

export function ImportPanel() {
  const queryClient = useQueryClient();
  const [file, setFile] = React.useState<File | null>(null);
  const [source, setSource] = React.useState("");
  const [version, setVersion] = React.useState("");
  const [sourceDate, setSourceDate] = React.useState("");
  const [license, setLicense] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [synthetic, setSynthetic] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const history = useQuery({
    queryKey: ["admin", "catalog", "imports"],
    queryFn: () => unwrap(api.GET("/api/v1/admin/catalog/imports", { params: { query: { page_size: 20 } as never } })),
  });

  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("file", file!);
      form.append("source_name", source.trim());
      form.append("source_version", version.trim());
      if (sourceDate) form.append("source_date", sourceDate);
      form.append("license_text", license.trim());
      form.append("license_confirmed", String(confirmed));
      form.append("is_synthetic", String(synthetic));
      return uploadCatalog(form);
    },
    onSuccess: (imp) => {
      toast.success("جاهزة للمعاينة — لم يُضف شيء إلى الكتالوج بعد");
      setSelected(imp.id);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["admin", "catalog", "imports"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const canUpload = file && source.trim() && license.trim().length >= 10 && confirmed;
  const current = history.data?.results.find((i) => i.id === selected) ?? null;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="استيراد ملف أدوية" description="CSV أو JSON بترميز UTF-8. أعمدة: name, strength, dosage_form, route, unit, manufacturer, country_of_registration, registration_number, external_id (تقبل العناوين العربية أيضاً)." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="الملف" htmlFor="cat-file" className="sm:col-span-2">
            <Input id="cat-file" ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="مصدر البيانات" htmlFor="cat-source" hint="اسم الجهة المرخصة أو الكتالوج المعتمد.">
            <Input id="cat-source" maxLength={200} value={source} onChange={(e) => setSource(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الإصدار" optional htmlFor="cat-ver"><Input id="cat-ver" maxLength={60} value={version} onChange={(e) => setVersion(e.target.value)} /></Field>
            <Field label="تاريخ التحديث" optional htmlFor="cat-date"><Input id="cat-date" type="date" value={sourceDate} onChange={(e) => setSourceDate(e.target.value)} /></Field>
          </div>
          <Field label="الترخيص أو إذن إعادة الاستخدام" htmlFor="cat-license" className="sm:col-span-2"
            hint="مثال: اتفاقية رقم … مع الجهة … تسمح بإعادة استخدام البيانات داخل المنصة.">
            <Textarea id="cat-license" rows={2} maxLength={1000} value={license} onChange={(e) => setLicense(e.target.value)} />
          </Field>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-1 accent-brand-600" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>أؤكد أن لدينا إذناً موثقاً باستخدام هذه البيانات، وأنها ليست منسوخة من مصدر غير مصرح به.</span>
          </label>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-1 accent-brand-600" checked={synthetic} onChange={(e) => setSynthetic(e.target.checked)} />
            <span>بيانات اصطناعية للتطوير (تُعلَّم «اختبار» ولا تظهر في الإنتاج).</span>
          </label>
          <div className="flex justify-end sm:col-span-2">
            <Button loading={upload.isPending} disabled={!canUpload} onClick={() => upload.mutate()}><FileUp className="size-4" /> رفع ومعاينة</Button>
          </div>
        </CardBody>
      </Card>

      {current && <ImportPreview imp={current} onClose={() => setSelected(null)} />}

      <Card>
        <CardHeader title="سجل الاستيراد" />
        <CardBody className="p-0">
          {history.isLoading ? <div className="p-5"><SkeletonList rows={3} /></div>
            : history.isError ? <ErrorState message={errorMessage(history.error)} onRetry={() => history.refetch()} />
            : !history.data?.results.length ? <EmptyState icon={<FileUp className="size-6" />} title="لا توجد عمليات استيراد بعد" />
            : (
              <ul className="divide-y divide-line">
                {history.data.results.map((imp) => (
                  <li key={imp.id}>
                    <button type="button" onClick={() => setSelected(imp.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-start text-sm hover:bg-sunken/60">
                      <span className="font-medium">{imp.source_name}</span>
                      {imp.source_version && <span className="num text-xs text-muted">{imp.source_version}</span>}
                      {imp.is_synthetic && <Badge tone="accent">اصطناعي</Badge>}
                      <Badge tone={importTone[imp.status] ?? "neutral"} dot>{label("catalogImportStatus", imp.status)}</Badge>
                      <span className="text-xs text-muted">
                        جديد <span className="num">{imp.created_count}</span> · تحديث <span className="num">{imp.updated_count}</span> · مكرر <span className="num">{imp.duplicate_count}</span> · أخطاء <span className="num">{imp.error_count}</span>
                      </span>
                      <span className="ms-auto text-xs text-muted">{imp.imported_by_name} · {formatDateTime(imp.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </CardBody>
      </Card>
    </div>
  );
}

function ImportPreview({ imp, onClose }: { imp: CatalogImport; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const act = useMutation({
    mutationFn: (what: "commit" | "discard") => unwrap(api.POST(`/api/v1/admin/catalog/imports/{id}/${what}` as "/api/v1/admin/catalog/imports/{id}/commit", {
      params: { path: { id: imp.id } },
    })),
    onSuccess: (r) => {
      toast.success(r.status === "committed" ? `تم الاستيراد: ${r.created_count} جديد، ${r.updated_count} محدّث` : "أُلغي الاستيراد");
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["admin", "catalog"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const preview = (imp.preview ?? []) as PreviewRow[];
  const errors = (imp.error_report ?? []) as ErrorRow[];
  return (
    <Card>
      <CardHeader title={`${imp.status === "previewed" ? "معاينة" : "نتيجة"}: ${imp.original_filename}`}
        description={<>{imp.source_name}{imp.source_date ? ` · ${formatDate(imp.source_date)}` : ""} · <span className="num">{imp.total_rows}</span> سطر · {imp.license_text}</>}
        action={<Button variant="ghost" size="sm" onClick={onClose}>إغلاق</Button>} />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <KpiTile label="جديد" value={imp.created_count} tone="brand" />
          <KpiTile label="تحديث" value={imp.updated_count} />
          <KpiTile label="دون تغيير" value={imp.unchanged_count} />
          <KpiTile label="مكرر" value={imp.duplicate_count} tone={imp.duplicate_count ? "warning" : "neutral"} />
          <KpiTile label="أسطر بأخطاء" value={imp.error_count} tone={imp.error_count ? "danger" : "neutral"} />
        </div>
        {errors.length > 0 && (
          <div className="rounded-2xl border border-danger/30 bg-danger-soft/50 p-3 text-sm">
            <div className="mb-1 font-semibold text-danger">أسطر لن تُستورد</div>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
              {errors.map((e, i) => <li key={i}>السطر <span className="num">{e.row}</span> — {e.field}: {e.message}</li>)}
            </ul>
          </div>
        )}
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-sunken text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-start font-medium">السطر</th>
                <th className="px-3 py-2 text-start font-medium">الصنف</th>
                <th className="px-3 py-2 text-start font-medium">الشكل</th>
                <th className="px-3 py-2 text-start font-medium">الشركة</th>
                <th className="px-3 py-2 text-start font-medium">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {preview.map((r) => (
                <tr key={r.row}>
                  <td className="px-3 py-2"><span className="num">{r.row}</span></td>
                  <td className="px-3 py-2 font-medium">{r.name} <span className="num font-normal text-muted">{r.strength}</span></td>
                  <td className="px-3 py-2">{r.dosage_form ? label("dosageForms", r.dosage_form) : "—"}</td>
                  <td className="px-3 py-2 text-muted">{r.manufacturer || "—"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={actionTone[r.action] ?? "neutral"}>{label("catalogRowAction", r.action)}</Badge>
                    {r.detail && <div className="mt-0.5 text-xs text-muted">{r.detail}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {imp.status === "previewed" && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" loading={act.isPending && act.variables === "discard"} onClick={() => act.mutate("discard")}>إلغاء الاستيراد</Button>
            <Button disabled={imp.created_count + imp.updated_count === 0} onClick={() => setConfirmOpen(true)}><CheckCircle2 className="size-4" /> تأكيد الاستيراد</Button>
          </div>
        )}
        <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title="تأكيد الاستيراد؟" confirmLabel="استيراد"
          loading={act.isPending} onConfirm={() => act.mutate("commit")}
          description={<>يُضاف <span className="num">{imp.created_count}</span> صنفاً ويُحدّث <span className="num">{imp.updated_count}</span>. تُتجاهل الأسطر المكررة والخاطئة. يُسجل الاستيراد باسمك مع المصدر والترخيص.</>} />
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------- browse

const SOURCES = [
  { value: "", label: "الكل" },
  { value: "imported", label: "مستورد" },
  { value: "synthetic_test", label: "اصطناعي" },
  { value: "practitioner", label: "أضافه طبيب" },
];

function MedicationLine({ med }: { med: AdminMedication }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 font-medium">
        {med.name} <span className="num font-normal text-muted">{med.strength}</span>
        <span className="text-xs font-normal text-muted">({label("dosageForms", med.dosage_form)})</span>
        {med.is_synthetic && <Badge tone="accent">اختبار</Badge>}
        {!med.is_active && <Badge tone="neutral">غير فعال</Badge>}
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
        <span>{label("catalogSource", med.source)}</span>
        {med.manufacturer && <span>{med.manufacturer}</span>}
        {med.country_of_registration && <span>{med.country_of_registration}</span>}
        {med.registration_number && <span className="num">{med.registration_number}</span>}
        {med.source_name && <span>المصدر: {med.source_name}{med.source_version ? ` (${med.source_version})` : ""}</span>}
        {med.added_by_name && <span>أضافه: {med.added_by_name}</span>}
        {med.favorites_count > 0 && <span>في مفضلة <span className="num">{med.favorites_count}</span> طبيب</span>}
      </div>
    </div>
  );
}

export function BrowsePanel() {
  const queryClient = useQueryClient();
  const [q, setQ] = React.useState("");
  const [source, setSource] = React.useState("");
  const [inactive, setInactive] = React.useState(false);
  const query = useDebounced(q.trim(), 300);
  const [page, setPage] = usePageFor(`${query}|${source}|${inactive}`);
  const list = useQuery({
    queryKey: ["admin", "catalog", "medications", { query, source, inactive, page }],
    queryFn: () => unwrap(api.GET("/api/v1/admin/catalog/medications", {
      params: { query: { q: query || undefined, source: source || undefined, is_active: inactive ? false : undefined, page } as never },
    })),
    placeholderData: keepPreviousData,
  });
  const toggle = useMutation({
    mutationFn: (med: AdminMedication) => unwrap(api.PATCH("/api/v1/admin/catalog/medications/{id}", {
      params: { path: { id: med.id } }, body: { is_active: !med.is_active },
    })),
    onSuccess: (m) => { toast.success(m.is_active ? "أُعيد تفعيل الصنف" : "أُوقف الصنف ولن يظهر في البحث"); queryClient.invalidateQueries({ queryKey: ["admin", "catalog"] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBox value={q} onChange={setQ} placeholder="ابحث بالاسم أو المادة أو الرمز…" className="sm:w-80" />
        <ChoiceChips value={source} onChange={(v) => setSource(v as string)} options={SOURCES} />
        <label className="flex items-center gap-2 text-sm text-muted sm:ms-auto">
          <input type="checkbox" className="accent-brand-600" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> غير الفعالة فقط
        </label>
      </div>
      <Card className="p-0">
        {list.isLoading ? <div className="p-5"><SkeletonList rows={6} /></div>
          : list.isError ? <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
          : !list.data?.results.length ? <EmptyState icon={<Pill className="size-6" />} title="لا توجد أصناف مطابقة" />
          : (
            <ul className="divide-y divide-line">
              {list.data.results.map((med) => (
                <li key={med.id} className="flex items-center gap-3 px-5 py-3">
                  <MedicationLine med={med} />
                  <Button size="sm" variant={med.is_active ? "danger-ghost" : "outline"} className="ms-auto shrink-0"
                    loading={toggle.isPending && toggle.variables?.id === med.id} onClick={() => toggle.mutate(med)}>
                    {med.is_active ? <><XCircle className="size-4" /> إيقاف</> : <><CheckCircle2 className="size-4" /> تفعيل</>}
                  </Button>
                </li>
              ))}
            </ul>
          )}
      </Card>
      {list.data && <Pager page={page} count={list.data.count} onPage={setPage} />}
    </div>
  );
}

// ---------------------------------------------------------------- unknown medications

export function ReviewPanel() {
  const queryClient = useQueryClient();
  const [merging, setMerging] = React.useState<AdminMedication | null>(null);
  const pending = useQuery({
    queryKey: ["admin", "catalog", "pending"],
    queryFn: () => unwrap(api.GET("/api/v1/admin/catalog/medications", {
      params: { query: { review_status: "pending", page_size: 50 } as never },
    })),
  });
  const review = useMutation({
    mutationFn: ({ med, decision, target }: { med: AdminMedication; decision: "keep" | "merge"; target?: string }) =>
      unwrap(api.POST("/api/v1/admin/catalog/medications/{id}/review", {
        params: { path: { id: med.id } }, body: { decision, target: target ?? null },
      })),
    onSuccess: (m) => {
      toast.success(m.review_status === "merged" ? `دُمج في ${m.merged_into_name}` : "اعتُمد الدواء وصار متاحاً لكل الأطباء");
      setMerging(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "catalog"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">أدوية خاصة أضافها أطباء لعدم وجودها في الكتالوج. كل دواء يظهر لصاحبه فقط حتى تعتمده للجميع؛ وإن كان مكرراً فادمجه في صنف معتمد.</p>
      {pending.isLoading ? <Card className="p-5"><SkeletonList rows={3} /></Card>
        : pending.isError ? <ErrorState message={errorMessage(pending.error)} onRetry={() => pending.refetch()} />
        : !pending.data?.results.length ? <Card><EmptyState icon={<PackageCheck className="size-6" />} title="لا توجد أدوية بانتظار المراجعة" /></Card>
        : (
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {pending.data.results.map((med) => (
                <li key={med.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                  <MedicationLine med={med} />
                  <div className="flex shrink-0 gap-2 sm:ms-auto">
                    <Button size="sm" variant="outline" loading={review.isPending && review.variables?.med.id === med.id && review.variables.decision === "keep"}
                      onClick={() => review.mutate({ med, decision: "keep" })}>اعتماد للجميع</Button>
                    <Button size="sm" onClick={() => setMerging(med)}><GitMerge className="size-4" /> دمج في صنف…</Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      <MergeIntoDialog key={merging?.id ?? "none"} med={merging} onClose={() => setMerging(null)} loading={review.isPending}
        onPick={(target) => merging && review.mutate({ med: merging, decision: "merge", target })} />
    </div>
  );
}

function MergeIntoDialog({ med, onClose, onPick, loading }: {
  med: AdminMedication | null; onClose: () => void; onPick: (id: string) => void; loading: boolean;
}) {
  const [q, setQ] = React.useState(med?.name ?? "");
  const query = useDebounced(q.trim(), 300);
  const results = useQuery({
    queryKey: ["admin", "catalog", "merge-target", query],
    queryFn: () => unwrap(api.GET("/api/v1/admin/catalog/medications", {
      params: { query: { q: query || undefined, is_active: true, source: "imported,synthetic_test", page_size: 10 } as never },
    })),
    enabled: Boolean(med),
  });
  return (
    <Dialog open={Boolean(med)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title="دمج في صنف من الكتالوج"
        description={med ? `«${med.name} ${med.strength}» — تنتقل مفضلات الأطباء إلى الصنف المختار، وتبقى الوصفات السابقة كما كُتبت.` : undefined}>
        <div className="space-y-3">
          <SearchBox value={q} onChange={setQ} placeholder="ابحث عن الصنف المعتمد…" />
          {results.isLoading ? <SkeletonList rows={3} /> : !results.data?.results.length ? (
            <p className="py-6 text-center text-sm text-muted">لا توجد نتائج</p>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {results.data.results.filter((r) => r.id !== med?.id).map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <MedicationLine med={r} />
                  <Button size="sm" className="ms-auto shrink-0" loading={loading} onClick={() => onPick(r.id)}>اختيار</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
