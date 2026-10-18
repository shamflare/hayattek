"use client";

import {
  Activity, AlertTriangle, BadgeCheck, ClipboardList, FileText, FlaskConical, type LucideIcon,
  ScanLine, Send, Stethoscope, TestTubeDiagonal, UserRound,
} from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/cn";

/** Some endpoints return a bare array, others a paginated envelope. */
export function asList<T>(data: T[] | { results: T[] } | undefined | null): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.results;
}

/** Query keys of the patient portal. Always scoped to the active patient. */
export const portalKeys = {
  all: (patientId: string) => ["portal", patientId] as const,
  timeline: (patientId: string, types: string) => ["portal", patientId, "timeline", types] as const,
  record: (patientId: string, type: string, id: string) => ["portal", patientId, "record", type, id] as const,
  card: (patientId: string) => ["portal", patientId, "card"] as const,
  prescriptions: (patientId: string) => ["portal", patientId, "prescriptions"] as const,
  labs: (patientId: string) => ["portal", patientId, "labs"] as const,
  trend: (patientId: string, testId: string) => ["portal", patientId, "trend", testId] as const,
  documents: (patientId: string) => ["portal", patientId, "documents"] as const,
  accessLog: (patientId: string) => ["portal", patientId, "access-log"] as const,
  reported: (patientId: string) => ["portal", patientId, "reported"] as const,
  profile: (patientId: string) => ["portal", patientId, "profile"] as const,
  // Requests and grants cover every file the user manages (own + wards).
  requests: ["portal", "sharing", "requests"] as const,
  grants: ["portal", "sharing", "grants"] as const,
};

export type RecordType =
  | "encounter" | "prescription" | "lab_report" | "imaging_report" | "document"
  | "service_request" | "referral" | "condition" | "allergy";

export const recordTypes: Record<RecordType, { label: string; icon: LucideIcon; tint: string }> = {
  encounter: { label: "زيارة", icon: Stethoscope, tint: "bg-brand-50 text-brand-600" },
  prescription: { label: "وصفة", icon: ClipboardList, tint: "bg-accent-soft text-accent" },
  lab_report: { label: "تحليل", icon: FlaskConical, tint: "bg-info-soft text-info" },
  imaging_report: { label: "أشعة", icon: ScanLine, tint: "bg-info-soft text-info" },
  document: { label: "مستند", icon: FileText, tint: "bg-sunken text-muted" },
  service_request: { label: "طلب فحص", icon: TestTubeDiagonal, tint: "bg-warning-soft text-warning" },
  referral: { label: "إحالة", icon: Send, tint: "bg-brand-50 text-brand-600" },
  condition: { label: "تشخيص", icon: Activity, tint: "bg-brand-50 text-brand-600" },
  allergy: { label: "حساسية", icon: AlertTriangle, tint: "bg-danger-soft text-danger" },
};

export function recordTypeMeta(type: string) {
  return recordTypes[type as RecordType] ?? recordTypes.document;
}

export function RecordTypeIcon({ type, className }: { type: string; className?: string }) {
  const meta = recordTypeMeta(type);
  return (
    <div className={cn("grid size-11 shrink-0 place-items-center rounded-2xl", meta.tint, className)}>
      <meta.icon className="size-5" />
    </div>
  );
}

/** Correction requests are only accepted for these record types. */
export const correctableTypes = new Set([
  "encounter", "prescription", "lab_report", "imaging_report", "condition", "allergy", "document",
]);

/**
 * Who stands behind a piece of information: a professional (verified) or the patient
 * themself. Shown wherever both kinds can appear side by side.
 */
export function ProvenanceTag({ source, status }: { source: string; status?: string }) {
  if (source === "patient") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-accent/60 bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">
        <UserRound className="size-3.5" /> أضفتها بنفسك
      </span>
    );
  }
  if (source === "document_import") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2.5 py-0.5 text-xs font-medium text-info">
        <FileText className="size-3.5" /> منقول من مستند
      </span>
    );
  }
  if (status === "final" || status === "amended") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">
        <BadgeCheck className="size-3.5" /> موثّق من مختص
      </span>
    );
  }
  return null;
}

/** A small "label: value" row used in record details. */
export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-sm text-muted sm:w-36">{label}</dt>
      <dd className="min-w-0 whitespace-pre-line text-[15px] leading-7 text-fg">{children}</dd>
    </div>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("mb-3 text-lg font-semibold text-fg", className)}>{children}</h2>;
}
