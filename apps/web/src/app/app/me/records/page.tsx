"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { BadgeCheck, HeartPulse, UserRound } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/app/page-header";
import { useActivePatient } from "@/components/patient/active-patient";
import { portalKeys, type RecordType, recordTypes } from "@/components/patient/portal";
import { RecordDetailDialog, type RecordRef } from "@/components/patient/record-detail";
import { TimelineCard } from "@/components/patient/timeline-card";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/ui/field";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/surface";
import { errorMessage, patientApi, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";

const filters: { value: string; label: string }[] = [
  { value: "all", label: "الكل" },
  ...(["encounter", "prescription", "lab_report", "imaging_report", "document", "service_request",
    "referral", "condition", "allergy"] as RecordType[]).map((t) => ({ value: t, label: recordTypes[t].label })),
];

/** Group items under a month heading, a calmer read than one long list. */
function monthKey(iso: string) {
  return formatDate(iso).split(" ").slice(1).join(" ");
}

export default function RecordsPage() {
  const { active } = useActivePatient();
  const patientId = active!.id;
  const [filter, setFilter] = React.useState("all");
  const [open, setOpen] = React.useState<RecordRef | null>(null);
  const types = filter === "all" ? "" : filter;

  const query = useInfiniteQuery({
    queryKey: portalKeys.timeline(patientId, types),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(patientApi.GET("/api/v1/clinical/timeline", {
        params: { query: { patient: patientId, before: pageParam, types: types || undefined } },
      })),
    getNextPageParam: (last) => last.next_before ?? undefined,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="ملفي الطبي" description="كل ما سُجّل في ملفك من زيارات ووصفات وتحاليل، من الأحدث إلى الأقدم." />

      <div className="mb-5 grid gap-2 sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-2xl border border-line bg-elevated p-3 text-sm">
          <BadgeCheck className="mt-0.5 size-5 shrink-0 text-success" />
          <div><span className="font-semibold">موثّق من مختص</span><p className="text-muted">أضافه طبيب أو مختبر واعتمده.</p></div>
        </div>
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-accent/50 bg-elevated p-3 text-sm">
          <UserRound className="mt-0.5 size-5 shrink-0 text-accent" />
          <div><span className="font-semibold">أضفته بنفسك</span><p className="text-muted">تقارير رفعتها أو معلومات صرّحت بها.</p></div>
        </div>
      </div>

      <div className="-mx-4 mb-5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        <ChoiceChips options={filters} value={filter} onChange={(v) => setFilter(v as string)} className="flex-nowrap" />
      </div>

      {query.isLoading ? (
        <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full rounded-card" />)}</div>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={<HeartPulse className="size-7" />}
            title={filter === "all" ? "ملفك فارغ حالياً" : "لا توجد سجلات من هذا النوع"}
            description={filter === "all"
              ? "ستظهر هنا زياراتك ووصفاتك وتحاليلك عندما تضيفها منشأة طبية مشتركة في حياة."
              : "جرّب عرض الكل، أو اختر نوعاً آخر."}
            action={filter === "all"
              ? <Button variant="secondary" asChild><Link href="/app/me/documents">رفع تقرير قديم</Link></Button>
              : <Button variant="ghost" onClick={() => setFilter("all")}>عرض الكل</Button>} />
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => {
            const month = monthKey(item.occurred_at);
            const heading = index === 0 || monthKey(items[index - 1].occurred_at) !== month ? month : null;
            return (
              <React.Fragment key={`${item.type}-${item.id}`}>
                {heading && <h2 className="pt-3 text-sm font-semibold text-muted first:pt-0">{heading}</h2>}
                <TimelineCard item={item} onOpen={(i) => setOpen({ type: i.type, id: i.id, title: i.title })} />
              </React.Fragment>
            );
          })}
          {query.hasNextPage && (
            <div className="pt-3 text-center">
              <Button variant="outline" size="lg" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                عرض سجلات أقدم
              </Button>
            </div>
          )}
          {!query.hasNextPage && items.length > 5 && (
            <p className="pt-3 text-center text-sm text-subtle">وصلت إلى بداية ملفك.</p>
          )}
        </div>
      )}

      <RecordDetailDialog patientId={patientId} record={open} onClose={() => setOpen(null)} />
    </div>
  );
}
