"use client";

import { CheckCircle2, History, PenLine, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InterpretationBadge, RecordStatusBadge } from "@/components/ui/status";
import { Card, CardBody, CardHeader } from "@/components/ui/surface";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { label } from "@/lib/i18n";

import { trimDecimal } from "./lab-result-editor";
import { DocumentList, type ImagingReport, type LabReport } from "./shared";

function Provenance({ report, onAmend, printHref }: { report: LabReport | ImagingReport; onAmend?: () => void; printHref?: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-success/25 bg-success-soft/60 p-4 sm:flex-row sm:items-center">
      <CheckCircle2 className="hidden size-6 shrink-0 text-success sm:block" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex flex-wrap items-center gap-2 font-semibold">
          {report.title} <RecordStatusBadge status={report.status} />
          {report.version > 1 && <span className="num text-xs font-normal text-muted">v{report.version}</span>}
        </div>
        <div className="mt-1 text-muted">
          {report.author_name} · {report.organization_name} · اعتُمد {formatDateTime(report.finalized_at)}
        </div>
        {report.amended_at && (
          <div className="mt-1 flex items-start gap-1.5 text-info">
            <History className="mt-0.5 size-3.5 shrink-0" />
            <span>صُحح {formatDateTime(report.amended_at)}{report.status_reason ? ` — ${report.status_reason}` : ""}</span>
          </div>
        )}
        {report.status === "entered_in_error" && report.status_reason && (
          <div className="mt-1 text-danger">أُلغي: {report.status_reason}</div>
        )}
      </div>
      {printHref && report.status !== "draft" && (
        <Button variant="outline" size="sm" asChild>
          <a href={printHref} target="_blank" rel="noopener"><Printer className="size-4" /> طباعة</a>
        </Button>
      )}
      {onAmend && report.can_amend && (
        <Button variant="outline" size="sm" onClick={onAmend}><PenLine className="size-4" /> تصحيح موثق</Button>
      )}
    </div>
  );
}

export function LabReportView({ report, onAmend }: { report: LabReport; onAmend?: () => void }) {
  return (
    <div className="space-y-5">
      <Provenance report={report} onAmend={onAmend} />
      <Card>
        <CardHeader title="النتائج" description={report.specimen_collected_at
          ? <>سُحبت العينة {formatDateTime(report.specimen_collected_at)}</> : undefined} />
        <CardBody className="p-0 pt-3">
          <table className="w-full text-sm">
            <thead className="hidden sm:table-header-group">
              <tr className="border-b border-line text-xs text-subtle">
                <th className="px-5 py-2 text-start font-medium">التحليل</th>
                <th className="px-3 py-2 text-start font-medium">النتيجة</th>
                <th className="px-3 py-2 text-start font-medium">المرجع</th>
                <th className="px-5 py-2 text-start font-medium">التفسير</th>
              </tr>
            </thead>
            <tbody>
              {report.observations.map((o) => {
                const flagged = o.interpretation && o.interpretation !== "normal";
                const ref = o.reference_low != null || o.reference_high != null
                  ? `${o.reference_low != null ? trimDecimal(o.reference_low) : ""} – ${o.reference_high != null ? trimDecimal(o.reference_high) : ""}`
                  : o.reference_text || "—";
                return (
                  <tr key={o.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-5 py-3 last:border-0 sm:table-row sm:p-0", flagged && "bg-warning-soft/50")}>
                    <td className="w-full font-medium sm:w-auto sm:px-5 sm:py-3">{o.name}</td>
                    <td className="sm:px-3 sm:py-3">
                      <span className="num">
                        <span className={cn("font-semibold", flagged && "text-warning")}>
                          {o.value_numeric != null ? trimDecimal(o.value_numeric) : o.value_text}
                        </span>
                        {o.unit && <span className="text-xs text-muted"> {o.unit}</span>}
                      </span>
                    </td>
                    <td className="text-xs text-muted sm:px-3 sm:py-3"><span className="num">{ref}</span></td>
                    <td className="ms-auto sm:ms-0 sm:px-5 sm:py-3"><InterpretationBadge value={o.interpretation || null} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>
      {report.conclusion && (
        <Card><CardHeader title="الخلاصة" /><CardBody className="whitespace-pre-line text-sm leading-7">{report.conclusion}</CardBody></Card>
      )}
      {report.documents.length > 0 && (
        <Card><CardHeader title="المرفقات" /><CardBody><DocumentList documents={report.documents} /></CardBody></Card>
      )}
    </div>
  );
}

export function ImagingReportView({ report, onAmend }: { report: ImagingReport; onAmend?: () => void }) {
  return (
    <div className="space-y-5">
      <Provenance report={report} onAmend={onAmend} printHref={`/print/imaging/${report.id}`} />
      <Card>
        <CardHeader title={label("modalities", report.modality)} description={report.body_site || undefined} />
        <CardBody className="space-y-4 text-sm leading-7">
          <div>
            <div className="mb-1 text-xs font-semibold text-subtle">الموجودات</div>
            <p className="whitespace-pre-line">{report.findings || "—"}</p>
          </div>
          <div className="rounded-2xl bg-sunken/70 p-4">
            <div className="mb-1 text-xs font-semibold text-subtle">الانطباع</div>
            <p className="whitespace-pre-line font-medium">{report.impression || "—"}</p>
          </div>
        </CardBody>
      </Card>
      {report.documents.length > 0 && (
        <Card><CardHeader title="الصور والمرفقات" /><CardBody><DocumentList documents={report.documents} /></CardBody></Card>
      )}
    </div>
  );
}
