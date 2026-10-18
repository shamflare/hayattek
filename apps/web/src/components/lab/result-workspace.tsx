"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { ErrorState, Skeleton } from "@/components/ui/surface";
import { api, errorMessage, unwrap } from "@/lib/api";

import { ImagingReportEditor } from "./imaging-report-editor";
import { LabResultEditor } from "./lab-result-editor";
import { ImagingReportView, LabReportView } from "./report-view";
import type { ImagingReport, LabReport, ServiceRequest } from "./shared";

type Kind = "lab" | "imaging";

/**
 * Finds the report already started for an order (if any) and shows the right step:
 * draft editor → finalized read-only view → documented amendment.
 * Without `request` (walk-in) it starts a new standalone report.
 */
export function ResultWorkspace({
  kind, patientId, request, onFinalized,
}: {
  kind: Kind;
  patientId: string;
  request?: ServiceRequest | null;
  onFinalized?: () => void;
}) {
  const queryClient = useQueryClient();
  const [chosenId, setReportId] = React.useState<string | null>(null);
  const [amending, setAmending] = React.useState(false);
  const base = kind === "lab" ? "/api/v1/diagnostics/lab-reports" : "/api/v1/diagnostics/imaging-reports";

  // Reports this lab already produced for the order (drafts are visible only to their author).
  const existing = useQuery({
    queryKey: [kind === "lab" ? "lab-reports" : "imaging-reports", "for-request", request?.id],
    queryFn: async () => {
      const page = kind === "lab"
        ? await unwrap(api.GET("/api/v1/diagnostics/lab-reports", { params: { query: { patient: patientId, page_size: 50 } as never } }))
        : await unwrap(api.GET("/api/v1/diagnostics/imaging-reports", { params: { query: { patient: patientId, page_size: 50 } as never } }));
      const mine = (page.results as Array<LabReport | ImagingReport>).filter(
        (r) => r.service_request === request?.id && r.status !== "entered_in_error");
      return mine[0]?.id ?? null;
    },
    enabled: !!request,
  });
  const reportId = chosenId ?? existing.data ?? null;

  const reportKey = [kind === "lab" ? "lab-report" : "imaging-report", reportId];
  const report = useQuery<LabReport | ImagingReport>({
    queryKey: reportKey,
    queryFn: (): Promise<LabReport | ImagingReport> => kind === "lab"
      ? unwrap(api.GET("/api/v1/diagnostics/lab-reports/{id}", { params: { path: { id: reportId! } } }))
      : unwrap(api.GET("/api/v1/diagnostics/imaging-reports/{id}", { params: { path: { id: reportId! } } })),
    enabled: !!reportId,
  });

  const onSaved = (saved: LabReport | ImagingReport) => {
    if (saved.id !== reportId) setReportId(saved.id);
    queryClient.setQueryData([kind === "lab" ? "lab-report" : "imaging-report", saved.id], saved);
    queryClient.invalidateQueries({ queryKey: [kind === "lab" ? "lab-report" : "imaging-report", saved.id] });
    queryClient.invalidateQueries({ queryKey: ["diagnostics"] });
  };
  const handleFinalized = (final: LabReport | ImagingReport) => {
    queryClient.setQueryData([kind === "lab" ? "lab-report" : "imaging-report", final.id], final);
    setReportId(final.id);
    queryClient.invalidateQueries({ queryKey: ["diagnostics"] });
    onFinalized?.();
  };
  const amend = async (changes: object, reason: string) => {
    await unwrap(api.POST(`${base}/{id}/amend` as "/api/v1/diagnostics/lab-reports/{id}/amend", {
      params: { path: { id: reportId! } },
      body: { reason, changes } as never,
    }));
    toast.success("حُفظ التصحيح وأُبلغ الطبيب والمريض بالنسخة الجديدة");
    setAmending(false);
    await queryClient.invalidateQueries({ queryKey: reportKey });
  };

  if (existing.error) return <ErrorState message={errorMessage(existing.error)} onRetry={() => existing.refetch()} />;
  if (report.error) return <ErrorState message={errorMessage(report.error)} onRetry={() => report.refetch()} />;
  if ((request && existing.isLoading) || (reportId && !report.data)) {
    return <div className="space-y-4"><Skeleton className="h-40 rounded-card" /><Skeleton className="h-64 rounded-card" /></div>;
  }

  const data = report.data as LabReport | ImagingReport | undefined;
  const isDraft = !data || data.status === "draft";

  if (kind === "lab") {
    const r = data as LabReport | undefined;
    if (isDraft) {
      return <LabResultEditor key="draft" patientId={patientId} request={request} report={r}
        onSaved={onSaved} onFinalized={handleFinalized} />;
    }
    if (amending && r) {
      return <LabResultEditor key={`amend-${r.version}`} mode="amend" patientId={patientId} request={request} report={r}
        onAmend={amend} onCancelAmend={() => setAmending(false)} />;
    }
    return <LabReportView report={r!} onAmend={() => setAmending(true)} />;
  }

  const r = data as ImagingReport | undefined;
  if (isDraft) {
    return <ImagingReportEditor key="draft" patientId={patientId} request={request} report={r}
      onSaved={onSaved} onFinalized={handleFinalized} />;
  }
  if (amending && r) {
    return <ImagingReportEditor key={`amend-${r.version}`} mode="amend" patientId={patientId} request={request} report={r}
      onAmend={amend} onCancelAmend={() => setAmending(false)} />;
  }
  return <ImagingReportView report={r!} onAmend={() => setAmending(true)} />;
}
