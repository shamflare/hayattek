"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Building2, CalendarClock, ClipboardList, Loader, PackageCheck, Stethoscope } from "lucide-react";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { ResultWorkspace } from "@/components/lab/result-workspace";
import { PatientBriefCard, PriorityBadge, requestItemLabel } from "@/components/lab/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { FulfillmentBadge } from "@/components/ui/status";
import { Card, CardBody, CardHeader, ErrorState, Skeleton } from "@/components/ui/surface";
import { api, errorMessage, unwrap } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { label } from "@/lib/i18n";

export default function LabRequestPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const { data: r, error, refetch } = useQuery({
    queryKey: ["diagnostics", "request", id],
    queryFn: () => unwrap(api.GET("/api/v1/diagnostics/requests/{id}", { params: { path: { id } } })),
  });

  const fulfil = useMutation({
    mutationFn: (status: "received" | "in_progress" | "cancelled") =>
      unwrap(api.POST("/api/v1/diagnostics/requests/{id}/fulfillment", {
        params: { path: { id } }, body: { fulfillment_status: status },
      })),
    onSuccess: (res) => {
      toast.success(`حالة الطلب: ${label("fulfillment", res.fulfillment_status)}`);
      setCancelOpen(false);
      queryClient.invalidateQueries({ queryKey: ["diagnostics"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (error) {
    return (
      <>
        <PageHeader title="الطلب" back="/app/lab" />
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      </>
    );
  }

  const open = r && !["completed", "cancelled"].includes(r.fulfillment_status);

  return (
    <>
      <PageHeader
        back="/app/lab"
        eyebrow={r ? (r.kind === "lab" ? "طلب تحليل مخبري" : "طلب تصوير طبي") : undefined}
        title={r ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="num">{r.number}</span>
            <PriorityBadge priority={r.priority} />
            <FulfillmentBadge status={r.fulfillment_status} />
          </span>
        ) : <Skeleton className="h-8 w-56" />}
        actions={r && open && (
          <>
            {r.fulfillment_status === "requested" && (
              <Button variant="outline" loading={fulfil.isPending && fulfil.variables === "received"} onClick={() => fulfil.mutate("received")}>
                <PackageCheck className="size-4" /> تم الاستلام
              </Button>
            )}
            {r.fulfillment_status === "received" && (
              <Button variant="outline" loading={fulfil.isPending && fulfil.variables === "in_progress"} onClick={() => fulfil.mutate("in_progress")}>
                <Loader className="size-4" /> بدء التنفيذ
              </Button>
            )}
            <Button variant="danger-ghost" onClick={() => setCancelOpen(true)}><Ban className="size-4" /> اعتذار عن التنفيذ</Button>
          </>
        )}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="order-2 min-w-0 lg:order-1">
          {!r ? <Skeleton className="h-96 rounded-card" /> : r.fulfillment_status === "cancelled" ? (
            <Card className="p-6 text-center text-sm text-muted">هذا الطلب ملغى ولا يمكن إدخال نتيجة له.</Card>
          ) : (
            <ResultWorkspace kind={r.kind} patientId={r.patient} request={r} />
          )}
        </div>

        <aside className="order-1 space-y-4 lg:order-2 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader title="تفاصيل الطلب" icon={<ClipboardList className="size-[18px]" />} />
            <CardBody className="space-y-4 text-sm">
              {!r ? <Skeleton className="h-40" /> : (
                <>
                  <PatientBriefCard patient={{ id: r.patient, ...r.patient_brief }} />
                  <div>
                    <div className="mb-1.5 text-xs text-subtle">{r.kind === "lab" ? "التحاليل المطلوبة" : "التصوير المطلوب"}</div>
                    <ul className="space-y-1.5">
                      {r.items.map((it) => (
                        <li key={it.id} className="flex items-start gap-2">
                          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-500" />
                          <span>
                            <bdi className="font-medium">{requestItemLabel(it)}</bdi>
                            {it.lab_test_name && it.lab_test_name !== requestItemLabel(it) && <span className="block text-xs text-subtle" dir="ltr">{it.lab_test_name}</span>}
                            {it.lab_test_name_ar && <span className="block text-xs text-subtle">{it.lab_test_name_ar}</span>}
                            {it.description && (it.lab_test || it.modality) && <span className="block text-xs text-muted">{it.description}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {r.clinical_notes && (
                    <div className="rounded-xl bg-sunken/70 p-3">
                      <div className="mb-1 text-xs text-subtle">ملاحظات سريرية</div>
                      <p className="leading-6">{r.clinical_notes}</p>
                    </div>
                  )}
                  <div className="space-y-2 border-t border-line pt-3 text-muted">
                    <div className="flex items-center gap-2"><Building2 className="size-4 text-subtle" /> {r.organization_name}</div>
                    <div className="flex items-center gap-2"><Stethoscope className="size-4 text-subtle" /> {r.author_name}</div>
                    <div className="flex items-center gap-2"><CalendarClock className="size-4 text-subtle" /> <span>{formatDateTime(r.occurred_at)}</span></div>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
          <p className="px-1 text-xs leading-5 text-subtle">
            ترى هنا ما يلزم لتنفيذ الطلب فقط. لا يتيح الطلب الاطلاع على بقية الملف الطبي للمريض.
          </p>
        </aside>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="الاعتذار عن تنفيذ الطلب؟"
        description="سيُعلَّم الطلب ملغى لدى منشأتك ويراه الطبيب الطالب كذلك. لا يمكن إدخال نتيجة له بعد ذلك."
        confirmLabel="اعتذار عن التنفيذ"
        tone="danger"
        loading={fulfil.isPending && fulfil.variables === "cancelled"}
        onConfirm={() => fulfil.mutate("cancelled")}
      />
    </>
  );
}
