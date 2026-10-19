"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Printer, ScanLine, ScanText } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FulfillmentBadge, InterpretationBadge, RecordStatusBadge } from "@/components/ui/status";
import { Badge, ErrorState, Skeleton } from "@/components/ui/surface";
import { api, errorMessage, fetchDocumentBlob, type Schemas, unwrap } from "@/lib/api";
import { bytesLabel, formatDateTime } from "@/lib/format";
import { label } from "@/lib/i18n";

const OCR_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/tiff", "image/webp"];

type Item = Pick<Schemas["TimelineItem"], "type" | "id" | "title">;

function fetchRecord(item: Item): Promise<unknown> {
  const path = { params: { path: { id: item.id } } };
  switch (item.type) {
    case "lab_report": return unwrap(api.GET("/api/v1/diagnostics/lab-reports/{id}", path));
    case "imaging_report": return unwrap(api.GET("/api/v1/diagnostics/imaging-reports/{id}", path));
    case "document": return unwrap(api.GET("/api/v1/documents/{id}", path));
    case "service_request": return unwrap(api.GET("/api/v1/diagnostics/requests/{id}", path));
    case "referral": return unwrap(api.GET("/api/v1/referrals/{id}", path));
    case "condition": return unwrap(api.GET("/api/v1/clinical/conditions/{id}", path));
    case "allergy": return unwrap(api.GET("/api/v1/clinical/allergies/{id}", path));
    default: return Promise.reject(new Error("unsupported"));
  }
}

/** Read-only viewer for records that don't have their own page. */
export function RecordViewer({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["record", item?.type, item?.id],
    queryFn: () => fetchRecord(item as Item),
    enabled: Boolean(item),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = query.data as any;
  return (
    <Dialog open={Boolean(item)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title={item?.title ?? ""}
        description={r ? `${r.author_name}${r.organization_name ? ` · ${r.organization_name}` : ""} · ${formatDateTime(r.occurred_at)}` : undefined}>
        {query.isLoading ? <div className="space-y-3"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-32" /></div>
          : query.isError ? <ErrorState message={errorMessage(query.error)} />
          : r ? (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <RecordStatusBadge status={r.status} />
                {r.version > 1 && <Badge tone="info">النسخة <span className="num">{r.version}</span></Badge>}
                {r.status_reason && <Badge tone="neutral">{r.status_reason}</Badge>}
              </div>
              {item?.type === "lab_report" && <LabReportBody report={r} />}
              {item?.type === "imaging_report" && (
                <div className="space-y-3 text-[15px] leading-8">
                  <div><span className="text-muted">النوع:</span> {label("modalities", r.modality)} {r.body_site && `· ${r.body_site}`}</div>
                  {r.findings && <Block title="الموجودات" text={r.findings} />}
                  {r.impression && <Block title="الانطباع" text={r.impression} />}
                  <Attachments docs={r.documents} />
                  {r.status !== "draft" && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={`/print/imaging/${r.id}`} target="_blank" rel="noopener"><Printer className="size-4" /> طباعة التقرير</a>
                    </Button>
                  )}
                </div>
              )}
              {item?.type === "document" && <DocumentBody doc={r} />}
              {item?.type === "service_request" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2"><span className="text-muted">الحالة:</span><FulfillmentBadge status={r.fulfillment_status} /></div>
                  {r.performer_organization_name && <div><span className="text-muted">الجهة:</span> {r.performer_organization_name}</div>}
                  <ul className="list-disc space-y-1 ps-5">
                    {r.items.map((i: Schemas["ServiceRequestItem"]) => (
                      <li key={i.id}><bdi>{i.lab_test_short_name || i.lab_test_name || (i.modality ? label("modalities", i.modality) : "")}</bdi> {i.body_site} {i.description}</li>
                    ))}
                  </ul>
                  {r.clinical_notes && <Block title="ملاحظات" text={r.clinical_notes} />}
                </div>
              )}
              {item?.type === "referral" && (
                <div className="space-y-2 leading-8">
                  <div><span className="text-muted">إلى:</span> {r.target_practitioner_name ?? r.target_organization_name ?? label("specialties", r.target_specialty)}</div>
                  <div><span className="text-muted">الحالة:</span> {label("referralState", r.state)}</div>
                  <Block title="السبب" text={r.reason} />
                  {r.response_note && <Block title="الرد" text={r.response_note} />}
                </div>
              )}
              {item?.type === "condition" && <Block title={label("conditionCategory", r.category)} text={`${r.display}${r.code ? ` (${r.code})` : ""}`} />}
              {item?.type === "allergy" && <Block title="حساسية" text={`${r.substance} — ${label("allergySeverity", r.severity)}${r.reaction ? ` — ${r.reaction}` : ""}`} />}
            </div>
          ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-muted">{title}</div>
      <p className="whitespace-pre-wrap leading-8">{text}</p>
    </div>
  );
}

export function LabReportBody({ report }: { report: Schemas["LabReport"] }) {
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-sunken text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-start font-medium">التحليل</th>
              <th className="px-3 py-2 text-start font-medium">النتيجة</th>
              <th className="px-3 py-2 text-start font-medium">المجال المرجعي</th>
              <th className="px-3 py-2 text-start font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {report.observations.map((o) => (
              <tr key={o.id}>
                <td className="px-3 py-2.5 font-medium">{o.name}</td>
                <td className="px-3 py-2.5"><span className="num font-semibold">{o.value_numeric ? Number(o.value_numeric) : o.value_text}</span> <span className="text-xs text-muted">{o.unit}</span></td>
                <td className="px-3 py-2.5 text-xs text-muted">
                  {o.reference_text || (o.reference_low || o.reference_high ? <span className="num">{o.reference_low ? Number(o.reference_low) : "…"} – {o.reference_high ? Number(o.reference_high) : "…"}</span> : "—")}
                </td>
                <td className="px-3 py-2.5"><InterpretationBadge value={o.interpretation} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.conclusion && <Block title="الخلاصة" text={report.conclusion} />}
      {report.external_lab_name && <p className="text-xs text-muted">مختبر خارجي: {report.external_lab_name}</p>}
      <Attachments docs={report.documents} />
    </div>
  );
}

function Attachments({ docs }: { docs?: { id: string; title: string; mime_type: string }[] }) {
  if (!docs?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {docs.map((d) => (
        <Button key={d.id} variant="outline" size="sm" onClick={() => openDocument(d.id, d.title)}>
          <FileText className="size-4" /> {d.title}
        </Button>
      ))}
    </div>
  );
}

function DocumentBody({ doc }: { doc: Schemas["Document"] }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const ready = doc.scan_status === "clean";
  const viewable = ready && ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(doc.mime_type);
  const isDicom = doc.mime_type === "application/dicom" || doc.mime_type === "application/zip";
  React.useEffect(() => {
    if (!viewable) return;
    let objectUrl: string | null = null;
    fetchDocumentBlob(doc.id).then((u) => { objectUrl = u; setUrl(u); }).catch(() => setFailed(true));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.id, viewable]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge>{label("documentCategories", doc.category)}</Badge>
        <span className="num">{bytesLabel(doc.size_bytes)}</span>
        {doc.description && <span>· {doc.description}</span>}
      </div>
      {viewable && !failed && (url ? (
        doc.mime_type === "application/pdf"
          ? <iframe src={url} className="h-[60vh] w-full rounded-2xl border border-line" title={doc.title} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={url} alt={doc.title} className="max-h-[60vh] w-full rounded-2xl border border-line object-contain" />
      ) : <Skeleton className="h-64" />)}
      {!ready ? <ScanNotice status={doc.scan_status} /> : <>
      {isDicom && <p className="text-sm text-muted">دراسة DICOM: تُعرض في عارض المراجعة (غير معتمد للتشخيص السريري).</p>}
      {!viewable && !isDicom && <p className="text-sm text-muted">لا يمكن معاينة هذا النوع داخل المتصفح. نزّله وافتحه بالعارض المناسب.</p>}
      <div className="flex flex-wrap gap-2">
        {isDicom && doc.scan_status === "clean" && (
          <Button asChild><Link href={`/app/imaging/${doc.id}`}><ScanLine className="size-4" /> عرض الصور</Link></Button>
        )}
        <Button variant="outline" onClick={() => openDocument(doc.id, doc.title, true)}>
          <Download className="size-4" /> تنزيل
        </Button>
        {doc.ocr_status ? (
          <Button asChild variant="secondary">
            <Link href={`/app/documents/${doc.id}/review`}><ScanText className="size-4" /> مراجعة القراءة الآلية</Link>
          </Button>
        ) : doc.category === "lab_result" && OCR_TYPES.includes(doc.mime_type) && (
          <Button asChild variant="ghost">
            <Link href={`/app/documents/${doc.id}/review`}><ScanText className="size-4" /> قراءة آلية (OCR)</Link>
          </Button>
        )}
      </div>
      </>}
    </div>
  );
}

/** Uploaded files open only after the malware scan passes (fail-closed quarantine). */
export function ScanNotice({ status }: { status: string }) {
  return status === "rejected" ? (
    <p className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">رُفض هذا الملف في الفحص الأمني ولا يمكن فتحه أو تنزيله.</p>
  ) : (
    <p className="rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
      الملف محفوظ لكنه <b>قيد الفحص الأمني</b>، ولا يمكن فتحه أو تنزيله أو قراءته آلياً قبل اجتياز الفحص. هذا يحمي النظام من الملفات الضارة.
    </p>
  );
}

/** Fetch through the API (practice-context header + audit) and open or save the file. */
export async function openDocument(id: string, title: string, download = false) {
  const url = await fetchDocumentBlob(id);
  const a = document.createElement("a");
  a.href = url;
  if (download) a.download = title;
  else a.target = "_blank";
  a.rel = "noopener";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
