"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ErrorState, Skeleton } from "@/components/ui/surface";
import { errorMessage, patientApi, unwrap } from "@/lib/api";

import { LabTrendChart } from "./lab-trend-chart";
import { portalKeys } from "./portal";

export function useLabTrend(patientId: string, testId: string | null | undefined) {
  return useQuery({
    queryKey: portalKeys.trend(patientId, testId ?? ""),
    queryFn: () =>
      unwrap(patientApi.GET("/api/v1/diagnostics/lab-reports/trend", {
        params: { query: { patient: patientId, test: testId! } },
      })),
    enabled: !!patientId && !!testId,
  });
}

export function LabTrendBody({ patientId, testId, testName }: { patientId: string; testId: string; testName: string }) {
  const query = useLabTrend(patientId, testId);
  if (query.isLoading) return <Skeleton className="h-48 w-full rounded-2xl" />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  return <LabTrendChart series={query.data?.series ?? []} testName={testName} />;
}

export function LabTrendDialog({
  patientId, test, onClose,
}: {
  patientId: string;
  test: { id: string; name: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!test} onOpenChange={(o) => !o && onClose()}>
      {test && (
        <DialogContent title={`تطور: ${test.name}`}
          description="القيم المعتمدة لهذا الفحص من كل المختبرات، مرتبة زمنياً.">
          <LabTrendBody patientId={patientId} testId={test.id} testName={test.name} />
        </DialogContent>
      )}
    </Dialog>
  );
}
