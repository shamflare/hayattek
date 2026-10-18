"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Card, CardBody, CardHeader } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { label, m } from "@/lib/i18n";

import {
  AttachmentUploader, DocumentList, documentCategoryForModality, FinalizeDialog, type ImagingReport,
  type ServiceRequest,
} from "./shared";

type Modality = Schemas["ModalityEnum"];

export interface ImagingEditorValue {
  modality: Modality;
  body_site: string;
  title: string;
  findings: string;
  impression: string;
}

export function ImagingReportEditor({
  patientId, request, report, mode = "draft", onSaved, onFinalized, onAmend, onCancelAmend,
}: {
  patientId: string;
  request?: ServiceRequest | null;
  report?: ImagingReport | null;
  mode?: "draft" | "amend";
  onSaved?: (report: ImagingReport) => void;
  onFinalized?: (report: ImagingReport) => void;
  onAmend?: (value: ImagingEditorValue, reason: string) => Promise<void>;
  onCancelAmend?: () => void;
}) {
  const firstItem = request?.items.find((i) => i.modality);
  const initialModality = (report?.modality ?? firstItem?.modality ?? "xray") as Modality;
  const initialSite = report?.body_site ?? firstItem?.body_site ?? "";
  const [form, setForm] = React.useState<ImagingEditorValue>({
    modality: initialModality,
    body_site: initialSite,
    title: report?.title ?? [label("modalities", initialModality), initialSite].filter(Boolean).join(" — "),
    findings: report?.findings ?? "",
    impression: report?.impression ?? "",
  });
  const [reason, setReason] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [finalizing, setFinalizing] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [dirty, setDirty] = React.useState(!report);

  const set = (key: keyof ImagingEditorValue) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setDirty(true);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const validate = (forFinal: boolean) => {
    const errs: Record<string, string> = {};
    if (!form.title.trim()) errs.title = "أدخل عنوان التقرير.";
    if (forFinal && !form.findings.trim() && !form.impression.trim()) errs.findings = "اكتب الموجودات أو الانطباع قبل الاعتماد.";
    if (mode === "amend" && !reason.trim()) errs.reason = "اكتب سبب التصحيح.";
    setErrors(errs);
    if (Object.keys(errs).length) toast.error(Object.values(errs)[0]);
    return !Object.keys(errs).length;
  };

  const body = () => ({ ...form, title: form.title.trim(), body_site: form.body_site.trim(), findings: form.findings.trim(), impression: form.impression.trim() });

  const saveDraft = async (): Promise<ImagingReport | null> => {
    if (!validate(false)) return null;
    setSaving(true);
    try {
      const saved = report
        ? await unwrap(api.PATCH("/api/v1/diagnostics/imaging-reports/{id}", { params: { path: { id: report.id } }, body: body() }))
        : await unwrap(api.POST("/api/v1/diagnostics/imaging-reports", {
            body: { ...body(), patient: patientId, service_request: request?.id ?? null },
          }));
      setDirty(false);
      onSaved?.(saved as unknown as ImagingReport);
      return saved as unknown as ImagingReport;
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
      const final = await unwrap(api.POST("/api/v1/diagnostics/imaging-reports/{id}/finalize", { params: { path: { id: saved.id } } }));
      toast.success("اعتُمد التقرير وأُرسل إلى الطبيب والمريض");
      setConfirmOpen(false);
      onFinalized?.(final);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setFinalizing(false);
    }
  };

  const submitAmend = async () => {
    if (!validate(true) || !onAmend) return;
    setSaving(true);
    try {
      await onAmend(body(), reason.trim());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={mode === "amend" ? "تصحيح تقرير التصوير" : "تقرير التصوير"} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="نوع التصوير" htmlFor="ir-mod">
            <Select id="ir-mod" value={form.modality} onChange={set("modality")}>
              {Object.entries(m.modalities).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </Select>
          </Field>
          <Field label="المنطقة / العضو" optional htmlFor="ir-site">
            <Input id="ir-site" value={form.body_site} onChange={set("body_site")} placeholder="مثال: الصدر، البطن" />
          </Field>
          <Field label="عنوان التقرير" htmlFor="ir-title" error={errors.title} className="sm:col-span-2">
            <Input id="ir-title" maxLength={200} value={form.title} onChange={set("title")} />
          </Field>
          <Field label="الموجودات" htmlFor="ir-findings" error={errors.findings} className="sm:col-span-2">
            <Textarea id="ir-findings" rows={7} value={form.findings} onChange={set("findings")} />
          </Field>
          <Field label="الانطباع / الخلاصة" htmlFor="ir-impression" className="sm:col-span-2">
            <Textarea id="ir-impression" rows={3} value={form.impression} onChange={set("impression")} />
          </Field>
          {mode === "amend" && (
            <Field label="سبب التصحيح" htmlFor="ir-reason" error={errors.reason} className="sm:col-span-2"
              hint="يظهر للطبيب والمريض مع النسخة المصححة.">
              <Textarea id="ir-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
        </CardBody>
      </Card>

      {mode === "draft" && (
        <Card>
          <CardHeader title="الصور والمرفقات" description="صور JPEG/PNG أو تقرير PDF. ملفات DICOM تُحفظ ولا تُعرض حالياً." />
          <CardBody className="space-y-3">
            <DocumentList documents={report?.documents ?? []} />
            <AttachmentUploader
              patientId={patientId}
              link={report ? { imaging_report: report.id } : null}
              category={documentCategoryForModality(form.modality)}
              defaultTitle={form.title || "صورة شعاعية"}
              accept="application/pdf,image/*,application/dicom,.dcm"
              onUploaded={() => report && onSaved?.(report)}
              disabledReason="احفظ المسودة أولاً لتتمكن من إرفاق الصور."
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
            <Button onClick={() => { if (validate(true)) setConfirmOpen(true); }} disabled={saving}>اعتماد التقرير</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onCancelAmend}>إلغاء</Button>
            <Button loading={saving} onClick={submitAmend}>حفظ التصحيح</Button>
          </>
        )}
      </div>

      <FinalizeDialog open={confirmOpen} onOpenChange={setConfirmOpen} onConfirm={finalize} loading={finalizing} what="تقرير التصوير" />
    </div>
  );
}
