"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { ClipboardList, MessageSquareWarning } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/app/page-header";
import { useActivePatient } from "@/components/patient/active-patient";
import { CorrectionDialog } from "@/components/patient/correction-dialog";
import { portalKeys } from "@/components/patient/portal";
import { PrescriptionView } from "@/components/patient/record-views";
import { Button } from "@/components/ui/button";
import { Card, CardBody, EmptyState, ErrorState, Skeleton } from "@/components/ui/surface";
import { errorMessage, patientApi, unwrap } from "@/lib/api";

export default function PrescriptionsPage() {
  const { active } = useActivePatient();
  const patientId = active!.id;
  const [correct, setCorrect] = React.useState<{ id: string; title: string } | null>(null);

  const query = useInfiniteQuery({
    queryKey: portalKeys.prescriptions(patientId),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      unwrap(patientApi.GET("/api/v1/prescriptions", {
        params: { query: { patient: patientId, page: pageParam, page_size: 10 } },
      })),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
  });
  const list = query.data?.pages.flatMap((p) => p.results) ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="الوصفات" description="أدويتك كما كتبها الطبيب، مع طريقة تناول كل دواء." />

      <p className="mb-5 rounded-2xl bg-sunken px-4 py-3 text-sm leading-7 text-muted">
        اتبع دائماً تعليمات طبيبك والصيدلي. لا تغيّر الجرعة أو توقف الدواء دون استشارة طبيبك.
      </p>

      {query.isLoading ? (
        <div className="space-y-4">{[0, 1].map((i) => <Skeleton key={i} className="h-56 w-full rounded-card" />)}</div>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<ClipboardList className="size-7" />} title="لا توجد وصفات بعد"
            description="عندما يكتب لك طبيب وصفة عبر منصة حياة ستظهر هنا مع طريقة تناول كل دواء." />
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((rx) => (
            <Card key={rx.id}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
                <h2 className="font-semibold">وصفة <span className="num text-muted">{rx.number}</span></h2>
                <Button variant="ghost" size="sm" onClick={() => setCorrect({ id: rx.id, title: `وصفة ${rx.number}` })}>
                  <MessageSquareWarning className="size-4" /> طلب تصحيح
                </Button>
              </div>
              <CardBody>
                <PrescriptionView rx={rx} />
              </CardBody>
            </Card>
          ))}
          {query.hasNextPage && (
            <div className="text-center">
              <Button variant="outline" size="lg" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                عرض وصفات أقدم
              </Button>
            </div>
          )}
        </div>
      )}

      <CorrectionDialog patientId={patientId}
        target={correct ? { type: "prescription", ...correct } : null} onClose={() => setCorrect(null)} />
    </div>
  );
}
