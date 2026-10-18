import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { Avatar } from "@/components/ui/surface";
import type { Schemas } from "@/lib/api";
import { ageLabel, formatPhone, sexLabel } from "@/lib/format";

export function PatientRow({ patient }: { patient: Schemas["PatientList"] }) {
  return (
    <Link href={`/app/patients/${patient.id}`} className="flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-sunken">
      <Avatar name={patient.full_name} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{patient.full_name}</div>
        <div className="flex flex-wrap gap-x-2 text-xs text-muted">
          <span>{sexLabel(patient.sex)}</span>·
          <span>{ageLabel(patient.age_years, patient.birth_date_precision)}</span>·
          <span className="num">{patient.health_number}</span>
          {patient.phone && <span className="hidden sm:inline">· <span className="num">{formatPhone(patient.phone)}</span></span>}
        </div>
      </div>
      <ChevronLeft className="size-4 text-subtle" />
    </Link>
  );
}
