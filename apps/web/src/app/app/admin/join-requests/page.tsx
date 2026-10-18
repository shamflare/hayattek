"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Mail, Phone } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { Select } from "@/components/ui/field";
import { Badge, Card, EmptyState, ErrorState, SkeletonList } from "@/components/ui/surface";
import { api, errorMessage, unwrap } from "@/lib/api";
import { formatPhone, relativeTime } from "@/lib/format";
import { label } from "@/lib/i18n";

const STATUS = { new: "جديد", contacted: "تم التواصل", closed: "مغلق" } as const;

export default function JoinRequestsPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["admin", "join-requests"],
    queryFn: () => unwrap(api.GET("/api/v1/admin/join-requests")),
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: keyof typeof STATUS }) =>
      unwrap(api.PATCH("/api/v1/admin/join-requests/{id}", { params: { path: { id } }, body: { status } as never })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin", "join-requests"] }); toast.success("تم التحديث"); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="animate-fade-up">
      <PageHeader title="طلبات الانضمام" description="منشآت طلبت الانضمام من الموقع العام. بعد التواصل والتحقق أضفها من صفحة المنشآت." />
      {list.isLoading ? <SkeletonList /> : list.isError ? <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} /> :
        !list.data?.results.length ? <Card><EmptyState icon={<Building2 className="size-6" />} title="لا توجد طلبات بعد" /></Card> : (
          <div className="grid gap-4 md:grid-cols-2">
            {list.data.results.map((r) => (
              <Card key={r.id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{r.facility_name}</div>
                    <div className="mt-0.5 text-sm text-muted">{label("orgKinds", r.kind)} · {label("governorates", r.governorate)}</div>
                  </div>
                  <Badge tone={r.status === "new" ? "warning" : r.status === "contacted" ? "info" : "neutral"}>{STATUS[r.status as keyof typeof STATUS]}</Badge>
                </div>
                <div className="mt-4 space-y-1.5 text-sm">
                  <div>{r.contact_name}</div>
                  <div className="flex items-center gap-2 text-muted"><Phone className="size-4" /><a className="num hover:text-brand-600" href={`tel:${r.phone}`}>{formatPhone(r.phone)}</a></div>
                  {r.email && <div className="flex items-center gap-2 text-muted"><Mail className="size-4" /><a className="hover:text-brand-600" href={`mailto:${r.email}`} dir="ltr">{r.email}</a></div>}
                  {r.message && <p className="mt-2 rounded-xl bg-sunken p-3 leading-7">{r.message}</p>}
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-subtle">{relativeTime(r.created_at)}</span>
                  <Select value={r.status} className="h-9 w-40 text-sm"
                    onChange={(e) => update.mutate({ id: r.id, status: e.target.value as keyof typeof STATUS })}>
                    {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </div>
              </Card>
            ))}
          </div>
        )}
    </div>
  );
}
