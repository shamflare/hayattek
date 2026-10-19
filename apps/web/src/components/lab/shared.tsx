"use client";

import { FileImage, FileText, Paperclip, Upload } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Avatar, Badge } from "@/components/ui/surface";
import { errorMessage, fetchDocumentBlob, type Schemas, uploadDocument } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ageLabel, sexLabel } from "@/lib/format";
import { label } from "@/lib/i18n";

export type ServiceRequest = Schemas["ServiceRequest"];
export type LabReport = Schemas["LabReport"];
export type ImagingReport = Schemas["ImagingReport"];
export type DocumentBrief = Schemas["DocumentBrief"];

/** Minimal identity the lab is allowed to see. */
export interface PatientIdentity {
  id: string;
  full_name: string;
  health_number: string;
  age_years: number | null;
  sex?: string | null;
}

export function PatientBriefCard({ patient, className, action }: {
  patient: PatientIdentity; className?: string; action?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border border-line bg-sunken/50 p-3", className)}>
      <Avatar name={patient.full_name} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{patient.full_name}</div>
        <div className="text-xs text-muted">
          {sexLabel(patient.sex)} · {ageLabel(patient.age_years)} · <span className="num">{patient.health_number}</span>
        </div>
      </div>
      {action}
    </div>
  );
}

export function requestItemLabel(item: Schemas["ServiceRequestItem"]): string {
  // Laboratories work with the English names written on requests (CBC, HbA1c…).
  if (item.lab_test_short_name || item.lab_test_name) return item.lab_test_short_name || item.lab_test_name || "";
  if (item.modality) {
    return [label("modalities", item.modality), item.body_site].filter(Boolean).join(" — ");
  }
  return item.description || "—";
}

export function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "routine") return <Badge>{label("priority", priority)}</Badge>;
  return <Badge tone="danger" dot className="font-semibold">{label("priority", priority)}</Badge>;
}

/** ISO string → value for <input type="datetime-local"> in the browser's local time. */
export function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function openDocument(id: string) {
  const win = window.open("", "_blank");
  try {
    const url = await fetchDocumentBlob(id);
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (err) {
    win?.close();
    toast.error(errorMessage(err, "تعذر فتح الملف."));
  }
}

export function DocumentList({ documents }: { documents: DocumentBrief[] }) {
  if (!documents.length) return null;
  return (
    <ul className="space-y-2">
      {documents.map((d) => {
        const Icon = d.mime_type.startsWith("image/") ? FileImage : FileText;
        return (
          <li key={d.id}>
            <button type="button" onClick={() => openDocument(d.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-elevated px-3 py-2.5 text-start text-sm transition-colors hover:border-brand-300">
              <Icon className="size-4 shrink-0 text-brand-600" />
              <span className="min-w-0 flex-1 truncate">{d.title}</span>
              <span className="text-xs text-subtle">{d.mime_type === "application/pdf" ? "PDF" : "صورة"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Upload files linked to a saved report. Files are final on upload (immutable documents). */
export function AttachmentUploader({
  patientId, link, category, defaultTitle, onUploaded, accept = "application/pdf,image/*", disabledReason,
}: {
  patientId: string;
  link: { lab_report: string } | { imaging_report: string } | null;
  category: string;
  defaultTitle: string;
  onUploaded: () => void;
  accept?: string;
  disabledReason?: string;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<File[] | null>(null);

  const upload = async (files: File[]) => {
    if (!link) return;
    setBusy(true);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("patient", patientId);
        form.append("file", file);
        form.append("category", category);
        form.append("title", files.length > 1 ? `${defaultTitle} — ${file.name}` : defaultTitle);
        for (const [k, v] of Object.entries(link)) form.append(k, v);
        await uploadDocument(form);
      }
      toast.success(files.length > 1 ? "أُرفقت الملفات" : "أُرفق الملف");
      onUploaded();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setPending(null);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <input ref={input} type="file" accept={accept} multiple hidden
        onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) setPending(files); }} />
      <Button type="button" variant="outline" size="sm" loading={busy} disabled={!link}
        title={!link ? disabledReason : undefined} onClick={() => input.current?.click()}>
        <Upload className="size-4" /> إرفاق ملف
      </Button>
      {!link && disabledReason && <p className="mt-1 text-xs text-subtle">{disabledReason}</p>}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title="إرفاق الملف بالتقرير؟"
        description="الملف المرفق لا يمكن تعديله بعد الرفع. إن أخطأت يُلغى ويُرفع بديل عنه. تأكد أنه يخص هذا المريض."
        confirmLabel="رفع"
        loading={busy}
        onConfirm={() => pending && upload(pending)}
      >
        <ul className="space-y-1 text-sm">
          {pending?.map((f) => (
            <li key={f.name} className="flex items-center gap-2 text-muted"><Paperclip className="size-3.5" /> {f.name}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  );
}

/** Confirmation text shared by lab and imaging finalization. */
export function FinalizeDialog({
  open, onOpenChange, onConfirm, loading, what,
}: { open: boolean; onOpenChange: (o: boolean) => void; onConfirm: () => void; loading?: boolean; what: string }) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`اعتماد ${what}؟`}
      description={
        <>
          بعد الاعتماد تصل النتيجة إلى <b className="text-fg">الطبيب الطالب</b> وإلى <b className="text-fg">المريض</b> في ملفه الصحي،
          ولا يمكن تعديلها بعد ذلك إلا بتصحيح موثق يُسجل سببه ويبقى الإصدار السابق محفوظاً.
        </>
      }
      confirmLabel="اعتماد وإرسال"
      loading={loading}
      onConfirm={onConfirm}
    />
  );
}

export function documentCategoryForModality(modality?: string | null): string {
  const direct = ["xray", "ultrasound", "ct", "mri", "ecg", "echo"];
  return modality && direct.includes(modality) ? modality : "medical_report";
}
