"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { FlaskConical, LineChart, MessageSquareWarning } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/app/page-header";
import { useActivePatient } from "@/components/patient/active-patient";
import { CorrectionDialog } from "@/components/patient/correction-dialog";
import { LabTrendBody } from "@/components/patient/lab-trend-dialog";
import { portalKeys } from "@/components/patient/portal";
import { AttachedDocuments, ObservationTable, RecordMeta } from "@/components/patient/record-views";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/ui/field";
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton } from "@/components/ui/surface";
import { errorMessage, patientApi, unwrap } from "@/lib/api";

export default function LabsPage() {
  const { active } = useActivePatient();
  const patientId = active!.id;
  const [correct, setCorrect] = React.useState<{ id: string; title: string } | null>(null);
  const [testId, setTestId] = React.useState<string | null>(null);
  const trendRef = React.useRef<HTMLDivElement>(null);

  const query = useInfiniteQuery({
    queryKey: portalKeys.labs(patientId),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      unwrap(patientApi.GET("/api/v1/diagnostics/lab-reports", {
        params: { query: { patient: patientId, page: pageParam, page_size: 10 } },
      })),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
  });
  const reports = React.useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);

  // Tests that can be followed over time: catalogue-linked and numeric, counted across reports.
  const tests = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const r of reports) {
      for (const o of r.observations) {
        if (!o.test || o.value_numeric === null || o.value_numeric === undefined) continue;
        const cur = map.get(o.test);
        if (cur) cur.count += 1;
        else map.set(o.test, { id: o.test, name: o.name, count: 1 });
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [reports]);
  const selected = tests.find((t) => t.id === testId) ?? tests[0];

  const showTrend = (id: string) => {
    setTestId(id);
    trendRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="التحاليل" description="نتائج تحاليلك مع المجال المرجعي لكل مختبر، وتطور كل فحص عبر الزمن." />

      {query.isLoading ? (
        <div className="space-y-4">{[0, 1].map((i) => <Skeleton key={i} className="h-64 w-full rounded-card" />)}</div>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : reports.length === 0 ? (
        <Card>
          <EmptyState icon={<FlaskConical className="size-7" />} title="لا توجد نتائج تحاليل بعد"
            description="عندما يصدر مختبر مشترك في حياة نتيجة تحليل لك ستظهر هنا مباشرة. لديك نتائج ورقية قديمة؟ ارفعها من «الأشعة والمستندات»." />
        </Card>
      ) : (
        <div className="space-y-6">
          {selected && (
            <div ref={trendRef} className="scroll-mt-20">
              <Card>
                <CardHeader icon={<LineChart className="size-5" />} title="تطور الفحوص"
                  description="اختر فحصاً لترى قيمه السابقة. المنطقة المظللة هي المجال المرجعي." />
                <CardBody className="space-y-4">
                  {tests.length > 1 && (
                    <div className="-mx-5 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
                      <ChoiceChips className="flex-nowrap" value={selected.id}
                        options={tests.map((t) => ({ value: t.id, label: <bdi>{t.name}</bdi> }))}
                        onChange={(v) => setTestId(v as string)} />
                    </div>
                  )}
                  <LabTrendBody key={selected.id} patientId={patientId} testId={selected.id} testName={selected.name} />
                  <p className="text-xs leading-6 text-subtle">
                    الرسم للمتابعة فقط. فسّر النتائج دائماً مع طبيبك، فالمجال المرجعي قد يختلف بين المختبرات.
                  </p>
                </CardBody>
              </Card>
            </div>
          )}

          {reports.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-5 py-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold"><bdi>{r.title || "نتيجة تحليل"}</bdi></h2>
                  <RecordMeta className="mt-1.5" occurredAt={r.occurred_at}
                    authorName={r.external_lab_name || r.author_name} organizationName={r.organization_name}
                    status={r.status} source={r.source} />
                </div>
                {r.source !== "patient" && (
                  <Button variant="ghost" size="sm" onClick={() => setCorrect({ id: r.id, title: r.title || "نتيجة تحليل" })}>
                    <MessageSquareWarning className="size-4" /> طلب تصحيح
                  </Button>
                )}
              </div>
              <CardBody className="space-y-4">
                <ObservationTable observations={r.observations} onTrend={(o) => o.test && showTrend(o.test)} />
                {r.conclusion && (
                  <p className="rounded-2xl bg-sunken p-3 text-[15px] leading-7">
                    <span className="text-muted">الخلاصة: </span>{r.conclusion}
                  </p>
                )}
                <AttachedDocuments documents={r.documents} />
              </CardBody>
            </Card>
          ))}
          {query.hasNextPage && (
            <div className="text-center">
              <Button variant="outline" size="lg" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                عرض نتائج أقدم
              </Button>
            </div>
          )}
        </div>
      )}

      <CorrectionDialog patientId={patientId}
        target={correct ? { type: "lab_report", ...correct } : null} onClose={() => setCorrect(null)} />
    </div>
  );
}
