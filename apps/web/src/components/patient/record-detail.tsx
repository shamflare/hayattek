"use client";

import { useQuery } from "@tanstack/react-query";
import { MessageSquareWarning } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FulfillmentBadge } from "@/components/ui/status";
import { Badge, ErrorState, Skeleton } from "@/components/ui/surface";
import { errorMessage, patientApi, type Schemas, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { label } from "@/lib/i18n";

import { CorrectionDialog } from "./correction-dialog";
import { LabTrendDialog } from "./lab-trend-dialog";
import { correctableTypes, InfoRow, portalKeys, recordTypeMeta, RecordTypeIcon } from "./portal";
import { AttachedDocuments, DocumentViewer, ObservationTable, PrescriptionItems, RecordMeta } from "./record-views";

type Loaded =
  | { type: "encounter"; data: Schemas["Encounter"] }
  | { type: "prescription"; data: Schemas["Prescription"] }
  | { type: "lab_report"; data: Schemas["LabReport"] }
  | { type: "imaging_report"; data: Schemas["ImagingReport"] }
  | { type: "document"; data: Schemas["Document"] }
  | { type: "service_request"; data: Schemas["ServiceRequest"] }
  | { type: "referral"; data: Schemas["Referral"] }
  | { type: "condition"; data: Schemas["Condition"] }
  | { type: "allergy"; data: Schemas["Allergy"] };

async function fetchRecord(type: string, id: string): Promise<Loaded> {
  const path = { params: { path: { id } } };
  switch (type) {
    case "encounter":
      return { type, data: await unwrap(patientApi.GET("/api/v1/clinical/encounters/{id}", path)) };
    case "prescription":
      return { type, data: await unwrap(patientApi.GET("/api/v1/prescriptions/{id}", path)) };
    case "lab_report":
      return { type, data: await unwrap(patientApi.GET("/api/v1/diagnostics/lab-reports/{id}", path)) };
    case "imaging_report":
      return { type, data: await unwrap(patientApi.GET("/api/v1/diagnostics/imaging-reports/{id}", path)) };
    case "document":
      return { type, data: await unwrap(patientApi.GET("/api/v1/documents/{id}", path)) };
    case "service_request":
      return { type, data: await unwrap(patientApi.GET("/api/v1/diagnostics/requests/{id}", path)) };
    case "referral":
      return { type, data: await unwrap(patientApi.GET("/api/v1/referrals/{id}", path)) };
    case "condition":
      return { type, data: await unwrap(patientApi.GET("/api/v1/clinical/conditions/{id}", path)) };
    case "allergy":
      return { type, data: await unwrap(patientApi.GET("/api/v1/clinical/allergies/{id}", path)) };
    default:
      throw new Error("unsupported record type");
  }
}

export interface RecordRef {
  type: string;
  id: string;
  title: string;
}

const vitalLabels: Record<string, [string, string]> = {
  bp_systolic: ["الضغط الانقباضي", "mmHg"],
  bp_diastolic: ["الضغط الانبساطي", "mmHg"],
  heart_rate: ["النبض", "/min"],
  temperature_c: ["الحرارة", "°C"],
  resp_rate: ["معدل التنفس", "/min"],
  spo2: ["الأكسجة", "%"],
  weight_kg: ["الوزن", "kg"],
  height_cm: ["الطول", "cm"],
  glucose_mg_dl: ["سكر الدم", "mg/dL"],
};

function Vitals({ vitals }: { vitals: unknown }) {
  if (!vitals || typeof vitals !== "object") return null;
  const entries = Object.entries(vitals as Record<string, unknown>).filter(
    ([k, v]) => k in vitalLabels && v !== null && v !== "",
  );
  if (entries.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {entries.map(([key, value]) => (
        <div key={key} className="rounded-xl bg-sunken px-3 py-2">
          <div className="text-xs text-muted">{vitalLabels[key][0]}</div>
          <div className="font-semibold">
            <span className="num">{String(value)}</span>{" "}
            <span className="num text-xs font-normal text-muted">{vitalLabels[key][1]}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function RecordBody({ record, patientId }: { record: Loaded; patientId: string }) {
  const [trend, setTrend] = React.useState<{ id: string; name: string } | null>(null);
  const [viewDoc, setViewDoc] = React.useState(false);

  switch (record.type) {
    case "encounter": {
      const e = record.data;
      return (
        <dl className="divide-y divide-line">
          <InfoRow label="نوع الزيارة">{label("encounterTypes", e.encounter_type)}</InfoRow>
          <InfoRow label="سبب الزيارة">{e.reason}</InfoRow>
          <InfoRow label="الشكوى">{e.complaint}</InfoRow>
          {e.vitals && Object.keys(e.vitals as object).length > 0 ? (
            <div className="py-3"><Vitals vitals={e.vitals} /></div>
          ) : null}
          {e.conditions.length > 0 && (
            <InfoRow label="التشخيص">
              <ul className="space-y-1">
                {e.conditions.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <bdi>{c.display}</bdi>
                    {c.code && <span className="num text-xs text-subtle">{c.code}</span>}
                  </li>
                ))}
              </ul>
            </InfoRow>
          )}
          <InfoRow label="التقييم">{e.assessment}</InfoRow>
          <InfoRow label="الخطة">{e.plan}</InfoRow>
          <InfoRow label="ملاحظات">{e.notes}</InfoRow>
          {e.follow_up_date && (
            <InfoRow label="موعد المراجعة">
              {formatDate(e.follow_up_date)} {e.follow_up_note && `— ${e.follow_up_note}`}
            </InfoRow>
          )}
          {e.prescriptions.length > 0 && (
            <InfoRow label="الوصفات">
              {e.prescriptions.map((p) => <span key={p.id} className="num me-2">{p.number}</span>)}
            </InfoRow>
          )}
        </dl>
      );
    }
    case "prescription":
      return <PrescriptionBodyOnly rx={record.data} />;
    case "lab_report": {
      const r = record.data;
      return (
        <div className="space-y-4">
          {r.external_lab_name && <p className="text-sm text-muted">المختبر: {r.external_lab_name}</p>}
          {r.specimen_collected_at && (
            <p className="text-sm text-muted">تاريخ سحب العينة: {formatDate(r.specimen_collected_at)}</p>
          )}
          <ObservationTable observations={r.observations}
            onTrend={(o) => o.test && setTrend({ id: o.test, name: o.name })} />
          {r.conclusion && <InfoRow label="الخلاصة">{r.conclusion}</InfoRow>}
          <AttachedDocuments documents={r.documents} />
          <LabTrendDialog patientId={patientId} test={trend} onClose={() => setTrend(null)} />
        </div>
      );
    }
    case "imaging_report": {
      const r = record.data;
      return (
        <div className="space-y-3">
          <dl className="divide-y divide-line">
            <InfoRow label="نوع التصوير">{label("modalities", r.modality)}</InfoRow>
            <InfoRow label="المنطقة">{r.body_site}</InfoRow>
            <InfoRow label="الموجودات">{r.findings}</InfoRow>
            <InfoRow label="الانطباع">{r.impression}</InfoRow>
          </dl>
          <AttachedDocuments documents={r.documents} />
        </div>
      );
    }
    case "document": {
      const d = record.data;
      return (
        <div className="space-y-3">
          <dl className="divide-y divide-line">
            <InfoRow label="النوع">{label("documentCategories", d.category)}</InfoRow>
            <InfoRow label="تاريخ المستند">{d.document_date ? formatDate(d.document_date) : null}</InfoRow>
            <InfoRow label="الوصف">{d.description}</InfoRow>
          </dl>
          <Button variant="outline" onClick={() => setViewDoc(true)}>عرض الملف</Button>
          <DocumentViewer document={viewDoc ? d : null} onClose={() => setViewDoc(false)} />
        </div>
      );
    }
    case "service_request": {
      const s = record.data;
      return (
        <dl className="divide-y divide-line">
          <InfoRow label="رقم الطلب"><span className="num">{s.number}</span></InfoRow>
          <InfoRow label="الحالة"><FulfillmentBadge status={s.fulfillment_status} /></InfoRow>
          <InfoRow label="الأولوية">{label("priority", s.priority)}</InfoRow>
          <InfoRow label="الجهة المنفذة">{s.performer_organization_name}</InfoRow>
          <InfoRow label="المطلوب">
            <ul className="space-y-1">
              {s.items.map((i) => (
                <li key={i.id}>
                  <bdi>{i.lab_test_name_ar || i.lab_test_name || (i.modality ? label("modalities", i.modality) : "")}</bdi>
                  {i.lab_test_name_ar && (i.lab_test_short_name || i.lab_test_name) && <span className="text-muted" dir="ltr"> ({i.lab_test_short_name || i.lab_test_name})</span>}
                  {i.body_site && <span className="text-muted"> — {i.body_site}</span>}
                  {i.description && <span className="text-muted"> — {i.description}</span>}
                </li>
              ))}
            </ul>
          </InfoRow>
          <InfoRow label="ملاحظات سريرية">{s.clinical_notes}</InfoRow>
        </dl>
      );
    }
    case "referral": {
      const r = record.data;
      return (
        <dl className="divide-y divide-line">
          <InfoRow label="إلى">
            {[r.target_practitioner_name, r.target_organization_name].filter(Boolean).join(" — ") ||
              (r.target_specialty ? label("specialties", r.target_specialty) : "—")}
          </InfoRow>
          <InfoRow label="الحالة"><Badge tone="brand">{label("referralState", r.state)}</Badge></InfoRow>
          <InfoRow label="السبب">{r.reason}</InfoRow>
          <InfoRow label="الأولوية">{label("priority", r.priority)}</InfoRow>
          <InfoRow label="ما شاركته">
            {r.shared_scopes.length ? r.shared_scopes.map((s) => label("scopes", s)).join("، ") : null}
          </InfoRow>
          <InfoRow label="رد الجهة">{r.response_note}</InfoRow>
        </dl>
      );
    }
    case "condition": {
      const c = record.data;
      return (
        <dl className="divide-y divide-line">
          <InfoRow label="التشخيص"><bdi>{c.display}</bdi> {c.code && <span className="num text-xs text-subtle">{c.code}</span>}</InfoRow>
          <InfoRow label="الفئة">{label("conditionCategory", c.category)}</InfoRow>
          <InfoRow label="تاريخ البدء">{c.onset_date ? formatDate(c.onset_date) : null}</InfoRow>
          <InfoRow label="ملاحظة">{c.note}</InfoRow>
        </dl>
      );
    }
    case "allergy": {
      const a = record.data;
      return (
        <dl className="divide-y divide-line">
          <InfoRow label="المادة"><bdi>{a.substance}</bdi></InfoRow>
          <InfoRow label="التفاعل">{a.reaction}</InfoRow>
          <InfoRow label="الشدة">{label("allergySeverity", a.severity)}</InfoRow>
        </dl>
      );
    }
  }
}

/** Detail of any timeline record, fetched on demand, with a "request a correction" action. */
export function RecordDetailDialog({
  patientId, record, onClose,
}: {
  patientId: string;
  record: RecordRef | null;
  onClose: () => void;
}) {
  const [correcting, setCorrecting] = React.useState(false);
  const query = useQuery({
    queryKey: portalKeys.record(patientId, record?.type ?? "", record?.id ?? ""),
    queryFn: () => fetchRecord(record!.type, record!.id),
    enabled: !!record,
  });
  const loaded = query.data;
  const meta = record ? recordTypeMeta(record.type) : null;
  const canCorrect =
    !!record && correctableTypes.has(record.type) && !!loaded && loaded.data.source !== "patient";

  return (
    <>
      <Dialog open={!!record && !correcting} onOpenChange={(o) => !o && onClose()}>
        {record && meta && (
          <DialogContent size="lg"
            title={
              <span className="flex items-center gap-3">
                <RecordTypeIcon type={record.type} className="size-9 rounded-xl" />
                <span className="min-w-0">
                  <span className="block text-xs font-normal text-muted">{meta.label}</span>
                  <bdi>{record.title}</bdi>
                </span>
              </span>
            }
            footer={canCorrect ? (
              <Button variant="ghost" onClick={() => setCorrecting(true)}>
                <MessageSquareWarning className="size-4" /> هل هناك خطأ؟ اطلب تصحيحاً
              </Button>
            ) : undefined}>
            {query.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : query.isError ? (
              <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
            ) : loaded ? (
              <div className="space-y-5">
                <RecordMeta occurredAt={loaded.data.occurred_at} authorName={loaded.data.author_name}
                  organizationName={loaded.data.organization_name} status={loaded.data.status}
                  source={loaded.data.source} className="rounded-2xl bg-sunken/60 p-3" />
                {loaded.data.source === "patient" && (
                  <p className="rounded-2xl border border-dashed border-accent/50 bg-accent-soft/60 p-3 text-sm leading-7 text-fg">
                    أضفتَ هذه المعلومة بنفسك. تظهر للأطباء على أنها من المريض، ولا تحل محل التشخيص الطبي.
                  </p>
                )}
                {loaded.data.status === "amended" && (
                  <p className="text-xs text-muted">
                    صُحّح هذا السجل بعد اعتماده{loaded.data.status_reason ? `: ${loaded.data.status_reason}` : "."}
                    {" "}النسخة السابقة محفوظة لدى الجهة.
                  </p>
                )}
                <RecordBody record={loaded} patientId={patientId} />
              </div>
            ) : null}
          </DialogContent>
        )}
      </Dialog>
      <CorrectionDialog patientId={patientId}
        target={correcting && record ? { type: record.type as Schemas["TargetTypeEnum"], id: record.id, title: record.title } : null}
        onClose={() => setCorrecting(false)} />
    </>
  );
}

/** Prescription detail without repeating the meta row (already shown above). */
function PrescriptionBodyOnly({ rx }: { rx: Schemas["Prescription"] }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">رقم الوصفة: <span className="num text-fg">{rx.number}</span></p>
      {rx.diagnosis_text && (
        <p className="text-[15px] text-muted">التشخيص: <span className="text-fg">{rx.diagnosis_text}</span></p>
      )}
      <PrescriptionItems items={rx.items} />
      {rx.notes && <p className="rounded-2xl bg-brand-50 p-4 text-[15px] leading-7 text-fg">{rx.notes}</p>}
    </div>
  );
}
