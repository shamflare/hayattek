"use client";

import { useQuery } from "@tanstack/react-query";
import { CopyCheck, GitCompareArrows, History, Lock } from "lucide-react";
import * as React from "react";

import { PageHeader } from "@/components/app/page-header";
import { CompareDialog, MergeCaseCard, ReasonBadges, type SuspectPair } from "@/components/patient/merge";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, ErrorState, SkeletonList } from "@/components/ui/surface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage, unwrap } from "@/lib/api";
import { ageLabel, formatPhone } from "@/lib/format";
import { useSession } from "@/lib/session";

function PatientMini({ p }: { p: SuspectPair["a"] }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-semibold">{p.full_name}</div>
      <div className="flex flex-wrap gap-x-3 text-xs text-muted">
        <span className="num">{p.health_number}</span>
        <span>{ageLabel(p.age_years, p.birth_date_precision)}</span>
        {p.phone && <span className="num">{formatPhone(p.phone)}</span>}
      </div>
    </div>
  );
}

export default function DuplicatesPage() {
  const { has, isClinician } = useSession();
  const allowed = has("receptionist") || isClinician;
  const [tab, setTab] = React.useState("suspects");
  const [pair, setPair] = React.useState<{ a: string; b: string } | null>(null);

  const suspects = useQuery({
    queryKey: ["patient-merges", "suspects"],
    queryFn: () => unwrap(api.GET("/api/v1/patient-merges/suspects")),
    enabled: allowed,
  });
  const history = useQuery({
    queryKey: ["patient-merges", "history"],
    queryFn: () => unwrap(api.GET("/api/v1/patient-merges", { params: { query: { page_size: 50 } as never } })),
    enabled: allowed && tab === "history",
  });

  if (!allowed) {
    return (
      <>
        <PageHeader title="الملفات المكررة" />
        <Card><EmptyState icon={<Lock className="size-6" />} title="غير متاح لدورك"
          description="مراجعة الملفات المكررة متاحة لموظف الاستقبال والطبيب المعتمد في المنشأة." /></Card>
      </>
    );
  }

  return (
    <div className="animate-fade-up">
      <PageHeader back="/app/patients" title="الملفات المكررة"
        description="ملفات مسجلة في منشأتك يُشتبه أنها لنفس الشخص. لا يحدث أي دمج تلقائياً: قارن، وتحقق من الهوية، ثم قرر." />
      <Tabs value={tab} onValueChange={setTab} dir="rtl">
        <TabsList className="mb-4">
          <TabsTrigger value="suspects"><GitCompareArrows className="size-4" /> مشتبه بتكرارها
            {suspects.data && <span className="num rounded-full bg-sunken px-1.5 text-xs text-muted">{suspects.data.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="history"><History className="size-4" /> سجل القرارات</TabsTrigger>
        </TabsList>

        <TabsContent value="suspects">
          {suspects.isLoading ? <Card className="p-5"><SkeletonList rows={4} /></Card>
            : suspects.isError ? <ErrorState message={errorMessage(suspects.error)} onRetry={() => suspects.refetch()} />
            : !suspects.data?.length ? (
              <Card><EmptyState icon={<CopyCheck className="size-6" />} title="لا توجد ملفات مشتبه بتكرارها"
                description="نقارن الهاتف وسنة الميلاد والرقم الوطني وتشابه الاسم بين مرضى منشأتك فقط." /></Card>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {suspects.data.map((p) => (
                  <Card key={`${p.a.id}-${p.b.id}`} className="flex flex-col gap-3 p-4 sm:p-5">
                    <div className="grid grid-cols-2 gap-3">
                      <PatientMini p={p.a} />
                      <PatientMini p={p.b} />
                    </div>
                    <ReasonBadges reasons={p.reasons} />
                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
                      <span className="text-xs text-muted">تشابه الاسم <span className="num">{Math.round(p.name_similarity * 100)}%</span></span>
                      <Button size="sm" variant="outline" onClick={() => setPair({ a: p.a.id, b: p.b.id })}>
                        <GitCompareArrows className="size-4" /> مقارنة وقرار
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
        </TabsContent>

        <TabsContent value="history">
          {history.isLoading ? <Card className="p-5"><SkeletonList rows={3} /></Card>
            : history.isError ? <ErrorState message={errorMessage(history.error)} onRetry={() => history.refetch()} />
            : !history.data?.results.length ? (
              <Card><EmptyState icon={<History className="size-6" />} title="لا توجد قرارات بعد"
                description="كل دمج أو رفض أو تراجع يظهر هنا مع اسم المسؤول والسبب والأدلة." /></Card>
            ) : (
              <div className="space-y-3">{history.data.results.map((c) => <MergeCaseCard key={c.id} item={c} />)}</div>
            )}
        </TabsContent>
      </Tabs>
      <CompareDialog key={pair ? `${pair.a}-${pair.b}` : "none"} pair={pair} onClose={() => setPair(null)} />
    </div>
  );
}
