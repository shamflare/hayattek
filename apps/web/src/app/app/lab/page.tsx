"use client";

import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2, ChevronLeft, ClipboardCheck, FlaskConical, Inbox, Loader, PackageCheck, Plus, ScanLine,
  Stethoscope,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { Pager, usePageFor } from "@/components/admin/common";
import { PageHeader } from "@/components/app/page-header";
import { PatientBriefCard, PriorityBadge, requestItemLabel, type ServiceRequest } from "@/components/lab/shared";
import { Button } from "@/components/ui/button";
import { FulfillmentBadge } from "@/components/ui/status";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/surface";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime, relativeTime } from "@/lib/format";
import { label } from "@/lib/i18n";
import { useSession } from "@/lib/session";

const TABS = [
  { value: "requested", label: "جديدة", icon: Inbox },
  { value: "received", label: "مستلمة", icon: PackageCheck },
  { value: "in_progress", label: "قيد التنفيذ", icon: Loader },
  { value: "completed", label: "مكتملة", icon: ClipboardCheck },
] as const;
type Tab = (typeof TABS)[number]["value"];

export default function LabInboxPage() {
  const { membership, has } = useSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<Tab>("requested");
  const allowed = has("lab_staff", "imaging_staff");
  const [page, setPage] = usePageFor(tab);

  const counts = useQueries({
    queries: TABS.map((t) => ({
      queryKey: ["diagnostics", "incoming", "count", membership?.id, t.value],
      queryFn: () => unwrap(api.GET("/api/v1/diagnostics/requests/incoming", {
        params: { query: { fulfillment_status: t.value, page_size: 1 } },
      })),
      enabled: allowed,
      refetchInterval: 60_000,
    })),
  });

  const { data, isLoading, error, refetch, isPlaceholderData } = useQuery({
    queryKey: ["diagnostics", "incoming", membership?.id, tab, page],
    queryFn: () => unwrap(api.GET("/api/v1/diagnostics/requests/incoming", {
      params: { query: { fulfillment_status: tab, page } },
    })),
    placeholderData: keepPreviousData,
    enabled: allowed,
    refetchInterval: 60_000,
  });

  const advance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "received" | "in_progress" }) =>
      unwrap(api.POST("/api/v1/diagnostics/requests/{id}/fulfillment", {
        params: { path: { id } }, body: { fulfillment_status: status },
      })),
    onSuccess: (r) => {
      toast.success(`الطلب ${r.number}: ${label("fulfillment", r.fulfillment_status)}`);
      queryClient.invalidateQueries({ queryKey: ["diagnostics"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!allowed) {
    return (
      <>
        <PageHeader title="الطلبات الواردة" />
        <Card><EmptyState icon={<FlaskConical className="size-6" />} title="هذه الصفحة لطاقم المختبر أو التصوير" /></Card>
      </>
    );
  }

  const list = data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow={membership?.organization.name}
        title="الطلبات الواردة"
        description="طلبات التحاليل والتصوير التي وجهها الأطباء إلى منشأتك. تُحدّث تلقائياً كل دقيقة."
        actions={<Button asChild><Link href="/app/lab/new"><Plus className="size-4" /> نتيجة دون طلب إلكتروني</Link></Button>}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} dir="rtl" className="mb-4">
        <TabsList>
          {TABS.map((t, i) => {
            const n = counts[i].data?.count;
            return (
              <TabsTrigger key={t.value} value={t.value}>
                <t.icon className="size-4" /> {t.label}
                {n !== undefined && t.value !== "completed" && (
                  <span className={cn("num rounded-full px-1.5 text-xs",
                    t.value === "requested" && n > 0 ? "bg-accent text-white" : "bg-sunken text-muted")}>{n}</span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-52 rounded-card" />)}</div>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<Inbox className="size-6" />}
            title={tab === "requested" ? "لا توجد طلبات جديدة" : tab === "completed" ? "لا توجد طلبات مكتملة بعد" : "لا توجد طلبات في هذه المرحلة"}
            description={tab === "requested" ? "عندما يرسل طبيب طلباً إلى منشأتك يظهر هنا وتصلك إشعارات به." : undefined} />
        </Card>
      ) : (
        <div className={cn("grid gap-3 lg:grid-cols-2", isPlaceholderData && "opacity-60")}>
          {list.map((r) => <RequestCard key={r.id} request={r} busy={advance.isPending && advance.variables?.id === r.id}
            onAdvance={(status) => advance.mutate({ id: r.id, status })} />)}
        </div>
      )}
      {data && <Pager page={page} count={data.count} onPage={setPage} />}
    </>
  );
}

function RequestCard({
  request: r, onAdvance, busy,
}: { request: ServiceRequest; onAdvance: (s: "received" | "in_progress") => void; busy: boolean }) {
  const urgent = r.priority !== "routine";
  const KindIcon = r.kind === "lab" ? FlaskConical : ScanLine;
  return (
    <Card className={cn("flex flex-col overflow-hidden", urgent && "border-danger/40 ring-1 ring-danger/20")}>
      {urgent && <div className="h-1 bg-danger" />}
      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={cn("grid size-9 place-items-center rounded-xl", r.kind === "lab" ? "bg-brand-50 text-brand-600" : "bg-info-soft text-info")}>
              <KindIcon className="size-[18px]" />
            </span>
            <div>
              <Link href={`/app/lab/requests/${r.id}`} className="num font-semibold hover:text-brand-600">{r.number}</Link>
              <div className="text-xs text-muted" title={formatDateTime(r.occurred_at)}>{relativeTime(r.occurred_at)}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1">
            <PriorityBadge priority={r.priority} />
            <FulfillmentBadge status={r.fulfillment_status} />
          </div>
        </div>

        <PatientBriefCard patient={{ id: r.patient, ...r.patient_brief }} />

        <div className="flex flex-wrap gap-1.5">
          {r.items.map((it) => <Badge key={it.id} tone={r.kind === "lab" ? "brand" : "info"}>{requestItemLabel(it)}</Badge>)}
        </div>

        {r.clinical_notes && <p className="line-clamp-2 text-sm text-muted">ملاحظة الطبيب: {r.clinical_notes}</p>}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="flex items-center gap-1"><Building2 className="size-3.5" /> {r.organization_name}</span>
          <span className="flex items-center gap-1"><Stethoscope className="size-3.5" /> {r.author_name}</span>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
          {r.fulfillment_status === "requested" && (
            <Button size="sm" variant="outline" loading={busy} onClick={() => onAdvance("received")}>
              <PackageCheck className="size-4" /> تم الاستلام
            </Button>
          )}
          {r.fulfillment_status === "received" && (
            <Button size="sm" variant="outline" loading={busy} onClick={() => onAdvance("in_progress")}>
              <Loader className="size-4" /> بدء التنفيذ
            </Button>
          )}
          <Button size="sm" variant={r.fulfillment_status === "completed" ? "ghost" : "primary"} asChild>
            <Link href={`/app/lab/requests/${r.id}`}>
              {r.fulfillment_status === "completed" ? "عرض النتيجة" : "فتح وإدخال النتيجة"} <ChevronLeft className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
