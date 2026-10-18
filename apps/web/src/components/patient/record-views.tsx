"use client";

import { Building2, CalendarDays, Download, FileText, LineChart, Pill, UserRound } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { InterpretationBadge, RecordStatusBadge } from "@/components/ui/status";
import { Skeleton } from "@/components/ui/surface";
import { documentUrl, fetchDocumentBlob, type Schemas } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { label } from "@/lib/i18n";

import { ProvenanceTag } from "./portal";

type Prescription = Schemas["Prescription"];
type LabObservation = Schemas["LabObservation"];
type DocumentBrief = Schemas["DocumentBrief"];

/** Common header: date, author, facility, status — the "who stands behind this". */
export function RecordMeta({
  occurredAt, authorName, organizationName, status, source, className,
}: {
  occurredAt: string;
  authorName?: string | null;
  organizationName?: string | null;
  status: string;
  source: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted", className)}>
      <span className="inline-flex items-center gap-1.5">
        <CalendarDays className="size-4" /> {formatDate(occurredAt)}
      </span>
      {authorName && (
        <span className="inline-flex items-center gap-1.5">
          <UserRound className="size-4" /> {authorName}
        </span>
      )}
      {organizationName && (
        <span className="inline-flex items-center gap-1.5">
          <Building2 className="size-4" /> {organizationName}
        </span>
      )}
      <span className="flex flex-wrap items-center gap-1.5">
        {source !== "patient" && <RecordStatusBadge status={status} />}
        <ProvenanceTag source={source} status={status} />
      </span>
    </div>
  );
}

// ----------------------------------------------------------------- prescriptions

export function PrescriptionItems({ items }: { items: Prescription["items"] }) {
  if (items.length === 0) return <p className="text-sm text-muted">لا توجد أدوية في هذه الوصفة.</p>;
  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={item.id} className="rounded-2xl border border-line bg-sunken/40 p-4">
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <Pill className="size-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs text-subtle">
                  <span className="num">{index + 1}</span>.
                </span>
                <bdi className="text-[17px] font-semibold text-fg">{item.medication_name || "—"}</bdi>
                {item.strength && <span className="num text-sm text-muted">{item.strength}</span>}
                {item.dosage_form && (
                  <span className="text-sm text-muted">{label("dosageForms", item.dosage_form)}</span>
                )}
              </div>
              {/* The Arabic sig is what the patient follows: make it the most readable line. */}
              <p className="mt-2 text-lg leading-8 text-fg">{item.sig}</p>
              {item.instructions && (
                <p className="mt-1 text-[15px] leading-7 text-muted">{item.instructions}</p>
              )}
              {item.quantity && (
                <p className="mt-1 text-sm text-subtle">
                  الكمية: <span className="num">{Number(item.quantity)}</span> {item.quantity_unit}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function PrescriptionView({ rx }: { rx: Prescription }) {
  return (
    <div className="space-y-4">
      <RecordMeta occurredAt={rx.occurred_at} authorName={rx.author_name}
        organizationName={rx.organization_name} status={rx.status} source={rx.source} />
      {rx.diagnosis_text && (
        <p className="text-[15px] text-muted">
          التشخيص: <span className="text-fg">{rx.diagnosis_text}</span>
        </p>
      )}
      <PrescriptionItems items={rx.items} />
      {rx.notes && (
        <p className="rounded-2xl bg-brand-50 p-4 text-[15px] leading-7 text-fg">{rx.notes}</p>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- lab results

function numberText(value?: string | null): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

export function referenceText(o: Pick<LabObservation, "reference_low" | "reference_high" | "reference_text">) {
  const low = numberText(o.reference_low);
  const high = numberText(o.reference_high);
  if (low && high) return `${low} – ${high}`;
  if (low) return `≥ ${low}`;
  if (high) return `≤ ${high}`;
  return o.reference_text || "";
}

export function ObservationTable({
  observations, onTrend,
}: {
  observations: LabObservation[];
  /** Called with the catalogue test id when the patient asks for the history of a test. */
  onTrend?: (o: LabObservation) => void;
}) {
  if (observations.length === 0) return <p className="text-sm text-muted">لا توجد قيم مسجلة.</p>;
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <div className="hidden grid-cols-[1.6fr_1fr_1fr_auto] gap-3 bg-sunken px-4 py-2.5 text-xs font-medium text-muted sm:grid">
        <span>الفحص</span>
        <span>النتيجة</span>
        <span>المجال المرجعي</span>
        <span className="w-20" />
      </div>
      <ul className="divide-y divide-line">
        {observations.map((o) => {
          const value = o.value_numeric !== null && o.value_numeric !== undefined
            ? numberText(o.value_numeric) : o.value_text;
          const ref = referenceText(o);
          const flagged = o.interpretation && o.interpretation !== "normal";
          return (
            <li key={o.id}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[1.6fr_1fr_1fr_auto]">
              <div className="min-w-0">
                <div className="text-[15px] font-medium text-fg"><bdi>{o.name}</bdi></div>
                {o.method && <div className="text-xs text-subtle">{o.method}</div>}
              </div>
              <div className={cn("text-end sm:text-start", flagged && "font-semibold")}>
                <span className="num text-[17px]">{value || "—"}</span>{" "}
                {o.unit && <span className="num text-xs text-muted">{o.unit}</span>}
              </div>
              <div className="text-xs text-muted sm:text-sm">
                {ref ? (
                  <>
                    <span className="sm:hidden">المرجعي: </span>
                    <span className="num">{ref}</span>
                  </>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 sm:w-20">
                <InterpretationBadge value={o.interpretation || null} />
                {onTrend && o.test && o.value_numeric !== null && o.value_numeric !== undefined && (
                  <button type="button" onClick={() => onTrend(o)} aria-label={`تطور ${o.name} عبر الزمن`}
                    className="grid size-8 place-items-center rounded-lg text-brand-600 hover:bg-brand-50">
                    <LineChart className="size-4" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------- documents

export function AttachedDocuments({ documents }: { documents: DocumentBrief[] }) {
  const [open, setOpen] = React.useState<DocumentBrief | null>(null);
  if (documents.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted">الملفات المرفقة</p>
      <div className="flex flex-wrap gap-2">
        {documents.map((d) => (
          <Button key={d.id} variant="outline" size="sm" onClick={() => setOpen(d)}>
            <FileText className="size-4" /> {d.title || "ملف"}
          </Button>
        ))}
      </div>
      <DocumentViewer document={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Opens an image or PDF through the authenticated download endpoint (audited). */
export function DocumentViewer({
  document, onClose,
}: {
  document: { id: string; title: string; mime_type: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!document} onOpenChange={(o) => !o && onClose()}>
      {document && (
        <DialogContent size="xl" title={document.title || "مستند"}
          footer={
            <Button variant="outline" asChild>
              <a href={documentUrl(document.id, true)}><Download className="size-4" /> تنزيل</a>
            </Button>
          }>
          <DocumentPreview key={document.id} document={document} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function DocumentPreview({ document }: { document: { id: string; title: string; mime_type: string } }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const id = document.id;

  React.useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchDocumentBlob(id, false)
      .then((u) => {
        objectUrl = u;
        if (cancelled) URL.revokeObjectURL(u);
        else setUrl(u);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  const mime = document.mime_type;
  const previewable = mime.startsWith("image/") || mime === "application/pdf";

  return failed ? (
      <p className="py-10 text-center text-sm text-danger">تعذر فتح الملف. حاول التنزيل بدلاً من ذلك.</p>
    ) : !url ? (
      <Skeleton className="h-[60vh] w-full rounded-2xl" />
    ) : !previewable ? (
      <p className="py-10 text-center text-sm text-muted">
        لا يمكن عرض هذا النوع من الملفات هنا. استخدم زر التنزيل لفتحه على جهازك.
      </p>
    ) : mime === "application/pdf" ? (
      <iframe src={url} title={document.title} className="h-[70vh] w-full rounded-2xl border border-line bg-sunken" />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element -- blob URL, not optimisable
      <img src={url} alt={document.title} className="mx-auto max-h-[70vh] rounded-2xl object-contain" />
  );
}
