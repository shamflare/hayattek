"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FileImage, FileText, Upload, UploadCloud } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { useActivePatient } from "@/components/patient/active-patient";
import { portalKeys, ProvenanceTag } from "@/components/patient/portal";
import { DocumentViewer } from "@/components/patient/record-views";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/surface";
import { documentUrl, errorMessage, patientApi, type Schemas, unwrap, uploadDocument } from "@/lib/api";
import { bytesLabel, formatDate } from "@/lib/format";
import { label, m } from "@/lib/i18n";

type Doc = Schemas["Document"];

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/tiff";
const MAX_BYTES = 25 * 1024 * 1024;

export default function DocumentsPage() {
  const { active } = useActivePatient();
  const patientId = active!.id;
  const [viewing, setViewing] = React.useState<Doc | null>(null);
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const query = useInfiniteQuery({
    queryKey: portalKeys.documents(patientId),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      unwrap(patientApi.GET("/api/v1/documents", {
        params: { query: { patient: patientId, page: pageParam, page_size: 20 } },
      })),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
  });
  const docs = query.data?.pages.flatMap((p) => p.results) ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="الأشعة والمستندات"
        description="صور الأشعة والتقارير الطبية، ومن بينها ما رفعته بنفسك من أوراق قديمة."
        actions={<Button size="lg" onClick={() => setUploadOpen(true)}><Upload className="size-5" /> رفع تقرير</Button>} />

      {query.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-card" />)}</div>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : docs.length === 0 ? (
        <Card>
          <EmptyState icon={<FileText className="size-7" />} title="لا توجد مستندات بعد"
            description="ارفع صورة أو ملف PDF لتقاريرك وتحاليلك الورقية القديمة لتبقى في ملفك ويراها طبيبك عندما تسمح له."
            action={<Button onClick={() => setUploadOpen(true)}><Upload className="size-4" /> رفع أول تقرير</Button>} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {docs.map((d) => {
            const isImage = d.mime_type.startsWith("image/");
            const previewable = isImage || d.mime_type === "application/pdf";
            const ready = d.scan_status === "clean";
            return (
              <li key={d.id}
                className={`flex flex-col gap-3 rounded-card border bg-elevated p-4 shadow-soft sm:flex-row sm:items-center ${d.source === "patient" ? "border-dashed border-accent/50" : "border-line"}`}>
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-sunken text-muted">
                    {isImage ? <FileImage className="size-5" /> : <FileText className="size-5" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold leading-7"><bdi>{d.title || d.original_filename}</bdi></div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
                      <span>{label("documentCategories", d.category)}</span>
                      <span>{formatDate(d.document_date ?? d.occurred_at)}</span>
                      {d.source !== "patient" && d.organization_name && <span>{d.organization_name}</span>}
                      <span className="num text-xs text-subtle">{bytesLabel(d.size_bytes)}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <ProvenanceTag source={d.source} status={d.status} />
                      {d.scan_status === "pending" && <Badge tone="warning">قيد الفحص الأمني</Badge>}
                      {d.scan_status === "rejected" && <Badge tone="danger">رُفض الملف</Badge>}
                    </div>
                  </div>
                </div>
                {ready && (
                  <div className="flex gap-2 sm:shrink-0">
                    {previewable && (
                      <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => setViewing(d)}>
                        <Eye className="size-4" /> عرض
                      </Button>
                    )}
                    {(d.mime_type === "application/dicom" || d.mime_type === "application/zip") && (
                      <Button variant="secondary" className="flex-1 sm:flex-none" asChild>
                        <Link href={`/app/me/imaging/${d.id}`}><Eye className="size-4" /> عرض الصور</Link>
                      </Button>
                    )}
                    <Button variant="outline" className="flex-1 sm:flex-none" asChild>
                      <a href={documentUrl(d.id, true)}><Download className="size-4" /> تنزيل</a>
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
          {query.hasNextPage && (
            <li className="text-center">
              <Button variant="outline" size="lg" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                عرض المزيد
              </Button>
            </li>
          )}
        </ul>
      )}

      <DocumentViewer document={viewing} onClose={() => setViewing(null)} />
      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} patientId={patientId} />
    </div>
  );
}

function UploadDialog({ open, onOpenChange, patientId }: { open: boolean; onOpenChange: (o: boolean) => void; patientId: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <UploadForm onDone={() => onOpenChange(false)} patientId={patientId} />}
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so every opening starts from a clean form. */
function UploadForm({ onDone, patientId }: { onDone: () => void; patientId: string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = React.useState<File | null>(null);
  const [category, setCategory] = React.useState("medical_report");
  const [title, setTitle] = React.useState("");
  const [date, setDate] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("patient", patientId);
      form.append("file", file!);
      form.append("category", category);
      form.append("title", title.trim() || label("documentCategories", category));
      if (date) form.append("document_date", date);
      return uploadDocument(form, false);
    },
    onSuccess: () => {
      toast.success("رُفع المستند وأُضيف إلى ملفك.");
      queryClient.invalidateQueries({ queryKey: portalKeys.all(patientId) });
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const pick = (f: File | null) => {
    setError(null);
    if (f && f.size > MAX_BYTES) {
      setError("حجم الملف أكبر من 25 ميغابايت.");
      return;
    }
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, 120));
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
      <DialogContent title="رفع تقرير أو صورة" description="سيظهر في ملفك مع علامة «أضفته بنفسك» حتى يميّزه الأطباء."
        footer={
          <>
            <Button variant="ghost" onClick={onDone}>إلغاء</Button>
            <Button loading={upload.isPending} disabled={!file} onClick={() => upload.mutate()}>
              <Upload className="size-4" /> رفع
            </Button>
          </>
        }>
        <div className="space-y-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line-strong bg-sunken/50 px-4 py-8 text-center transition-colors hover:border-brand-400">
            <UploadCloud className="size-8 text-brand-600" />
            {file ? (
              <>
                <span className="font-medium"><bdi>{file.name}</bdi></span>
                <span className="num text-xs text-muted">{bytesLabel(file.size)}</span>
                <span className="text-xs text-brand-600">اضغط لاختيار ملف آخر</span>
              </>
            ) : (
              <>
                <span className="font-medium">اختر ملفاً أو التقط صورة</span>
                <span className="text-xs text-muted">PDF أو صورة، حتى 25 ميغابايت</span>
              </>
            )}
            <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          </label>
          <Field label="نوع المستند" htmlFor="doc-category">
            <Select id="doc-category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(m.documentCategories).map(([value, text]) => (
                <option key={value} value={value}>{text}</option>
              ))}
            </Select>
          </Field>
          <Field label="العنوان" htmlFor="doc-title" hint="مثال: تحليل دم شامل — مختبر الأمل">
            <Input id="doc-title" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="تاريخ التقرير" optional htmlFor="doc-date">
            <Input id="doc-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className="num text-start" />
          </Field>
          {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>}
        </div>
      </DialogContent>
  );
}
