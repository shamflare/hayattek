"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";

import { PageHeader } from "@/components/app/page-header";
import { PrescriptionForm } from "@/components/clinical/prescription-form";
import { usePatient } from "@/components/clinical/queries";
import { ErrorState } from "@/components/ui/surface";
import { ageLabel } from "@/lib/format";

function NewPrescription() {
  const params = useSearchParams();
  const patientId = params.get("patient") ?? "";
  const encounterId = params.get("encounter");
  const patient = usePatient(patientId);
  if (!patientId) return <ErrorState message="حدد المريض أولاً." />;
  const p = patient.data?.patient;
  return (
    <div className="animate-fade-up">
      <PageHeader back={encounterId ? `/app/encounters/${encounterId}` : `/app/patients/${patientId}`}
        eyebrow="وصفة جديدة" title={p?.full_name ?? "…"}
        description={p ? `${ageLabel(p.age_years, p.birth_date_precision)} · ${p.health_number}` : undefined} />
      <PrescriptionForm patientId={patientId} encounterId={encounterId} />
    </div>
  );
}

export default function NewPrescriptionPage() {
  return <React.Suspense><NewPrescription /></React.Suspense>;
}
