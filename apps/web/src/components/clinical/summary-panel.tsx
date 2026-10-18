"use client";

import { AlertTriangle, HeartPulse, Lock, Pill, Plus, UserRound } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Badge, Card, Skeleton } from "@/components/ui/surface";
import type { Schemas } from "@/lib/api";
import { formatDate, formatShortDate } from "@/lib/format";
import { label } from "@/lib/i18n";

import { AllergyDialog, ConditionDialog } from "./quick-dialogs";

type Summary = Schemas["PatientSummary"];

export function SummaryPanel({ patientId, summary, loading, canAuthor }: {
  patientId: string; summary?: Summary; loading: boolean; canAuthor: boolean;
}) {
  const [dialog, setDialog] = React.useState<"allergy" | "condition" | null>(null);
  if (loading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-card" />)}
      </div>
    );
  }
  if (!summary) return null;

  return (
    <div className="space-y-4">
      {summary.hidden_scopes.length > 0 && (
        <div className="flex gap-2.5 rounded-2xl border border-line bg-sunken p-3.5 text-xs leading-6 text-muted">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>أجزاء لا تملك صلاحية رؤيتها من منشآت أخرى: {summary.hidden_scopes.map((s) => label("scopes", s)).join("، ")}</span>
        </div>
      )}

      <Section
        tone="danger" icon={AlertTriangle} title="الحساسيات"
        empty="لا توجد حساسيات موثقة"
        onAdd={canAuthor ? () => setDialog("allergy") : undefined}
        count={summary.allergies.length}
      >
        {summary.allergies.map((a) => (
          <li key={a.id} className="rounded-xl bg-danger-soft px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-danger">{a.substance}</span>
              <Badge tone="danger">{label("allergySeverity", a.severity)}</Badge>
            </div>
            {a.reaction && <div className="mt-0.5 text-xs text-fg/80">{a.reaction}</div>}
            <Provenance by={a.author_name} org={a.organization_name} at={a.occurred_at} />
          </li>
        ))}
      </Section>

      <Section icon={HeartPulse} title="الأمراض المزمنة" empty="لا توجد أمراض مزمنة موثقة"
        onAdd={canAuthor ? () => setDialog("condition") : undefined} count={summary.chronic_conditions.length}>
        {summary.chronic_conditions.map((c) => (
          <li key={c.id} className="rounded-xl border border-line px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{c.display}</span>
              {c.code && <span className="num text-xs text-subtle">{c.code}</span>}
            </div>
            <Provenance by={c.author_name} org={c.organization_name} at={c.occurred_at} />
          </li>
        ))}
      </Section>

      <Section icon={Pill} title="الأدوية الحالية" empty="لا توجد أدوية حالية معروفة" count={summary.current_medications.length}>
        {summary.current_medications.map((med, i) => (
          <li key={`${med.prescription_id}-${i}`} className="rounded-xl border border-line px-3 py-2.5">
            <div className="font-medium">{med.name}</div>
            <div className="mt-0.5 text-xs text-muted">
              {med.prescriber} · {formatShortDate(med.prescribed_at)}
              {med.ends_on ? <> · حتى <span className="num">{formatShortDate(med.ends_on)}</span></> : " · مستمر"}
            </div>
          </li>
        ))}
      </Section>

      {summary.patient_reported.length > 0 && (
        <Card className="border-dashed border-accent/40 bg-accent-soft/40 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-accent">
            <UserRound className="size-4" /> صرّح بها المريض (غير موثقة طبياً)
          </div>
          <ul className="space-y-1.5 text-sm">
            {summary.patient_reported.map((r) => (
              <li key={r.id}><span className="text-muted">{label("reportedKinds", r.kind)}:</span> {r.text}</li>
            ))}
          </ul>
        </Card>
      )}

      <AllergyDialog open={dialog === "allergy"} onOpenChange={(o) => setDialog(o ? "allergy" : null)} patientId={patientId} />
      <ConditionDialog open={dialog === "condition"} onOpenChange={(o) => setDialog(o ? "condition" : null)} patientId={patientId} />
    </div>
  );
}

function Section({ icon: Icon, title, children, empty, onAdd, count, tone }: {
  icon: React.ElementType; title: string; children: React.ReactNode; empty: string;
  onAdd?: () => void; count: number; tone?: "danger";
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className={`flex items-center gap-2 font-semibold ${tone === "danger" && count ? "text-danger" : ""}`}>
          <Icon className="size-[18px]" /> {title}
          {count > 0 && <span className="num rounded-full bg-sunken px-2 text-xs text-muted">{count}</span>}
        </div>
        {onAdd && <Button variant="ghost" size="sm" onClick={onAdd}><Plus className="size-4" /> إضافة</Button>}
      </div>
      {count ? <ul className="space-y-2">{children}</ul> : <p className="text-sm text-subtle">{empty}</p>}
    </Card>
  );
}

function Provenance({ by, org, at }: { by: string; org?: string | null; at: string }) {
  return (
    <div className="mt-1 text-[11px] text-subtle" title={formatDate(at)}>
      {by}{org ? ` · ${org}` : ""} · {formatShortDate(at)}
    </div>
  );
}
