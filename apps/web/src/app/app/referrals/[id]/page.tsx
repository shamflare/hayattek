"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FolderOpen, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { Badge, Card, CardBody, ErrorState, Skeleton } from "@/components/ui/surface";
import { api, errorMessage, unwrap } from "@/lib/api";
import { ageLabel, formatDateTime } from "@/lib/format";
import { label } from "@/lib/i18n";
import { useSession } from "@/lib/session";

export default function ReferralPage() {
  const { id } = useParams<{ id: string }>();
  const { me, membership } = useSession();
  const qc = useQueryClient();
  const [note, setNote] = React.useState("");
  const query = useQuery({
    queryKey: ["referral", id],
    queryFn: () => unwrap(api.GET("/api/v1/referrals/{id}", { params: { path: { id } } })),
  });
  const respond = useMutation({
    mutationFn: (accept: boolean) => unwrap(api.POST("/api/v1/referrals/{id}/respond", {
      params: { path: { id } }, body: { accept, note },
    })),
    onSuccess: (r) => {
      qc.setQueryData(["referral", id], r);
      qc.invalidateQueries({ queryKey: ["referrals"] });
      toast.success(r.state === "accepted" ? "قبلت الإحالة" : "تم الاعتذار عن الإحالة");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (query.isLoading) return <Skeleton className="h-96 rounded-card" />;
  if (query.isError || !query.data) return <ErrorState message={errorMessage(query.error)} />;
  const r = query.data;
  const isTarget = r.target_practitioner
    ? r.target_practitioner === me?.practitioner?.id
    : r.target_organization === membership?.organization.id;

  return (
    <div className="mx-auto max-w-3xl animate-fade-up">
      <PageHeader back="/app/referrals" eyebrow="إحالة" title={r.patient_brief.full_name}
        description={<>{ageLabel(r.patient_brief.age_years)} · <span className="num">{r.patient_brief.health_number}</span></>} />
      <Card>
        <CardBody className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone={r.state === "sent" ? "warning" : r.state === "accepted" ? "success" : "neutral"}>{label("referralState", r.state)}</Badge>
            <Badge tone={r.priority === "routine" ? "neutral" : "danger"}>{label("priority", r.priority)}</Badge>
          </div>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div><div className="text-xs text-subtle">من</div><div className="font-medium">{r.author_name}</div><div className="text-muted">{r.organization_name}</div></div>
            <div><div className="text-xs text-subtle">إلى</div><div className="font-medium">{r.target_practitioner_name ?? r.target_organization_name ?? "—"}</div>{r.target_specialty && <div className="text-muted">{label("specialties", r.target_specialty)}</div>}</div>
          </div>
          <div><div className="mb-1 text-sm font-semibold text-muted">سبب الإحالة</div><p className="whitespace-pre-wrap leading-8">{r.reason}</p></div>
          <div className="rounded-2xl bg-sunken p-4 text-sm">
            {r.patient_consented && r.shared_scopes.length
              ? <>وافق المريض على مشاركة: <span className="font-medium">{r.shared_scopes.map((s) => label("scopes", s)).join("، ")}</span> — يُفعّل الوصول عند قبول الإحالة لمدة 30 يوماً.</>
              : "لم تتضمن الإحالة مشاركة لملف المريض. ستحتاج موافقته عند حضوره."}
          </div>
          <div className="text-xs text-subtle">أُرسلت {formatDateTime(r.occurred_at)}</div>
          {r.response_note && <div><div className="mb-1 text-sm font-semibold text-muted">الرد</div><p className="leading-8">{r.response_note}</p></div>}
        </CardBody>
        {isTarget && r.state === "sent" && (
          <div className="space-y-3 border-t border-line p-5">
            <Field label="ملاحظة للطبيب المحيل" optional><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" loading={respond.isPending && respond.variables === false} onClick={() => respond.mutate(false)}><X className="size-4" /> اعتذار</Button>
              <Button loading={respond.isPending && respond.variables === true} onClick={() => respond.mutate(true)}><Check className="size-4" /> قبول الإحالة</Button>
            </div>
          </div>
        )}
        {r.state === "accepted" && isTarget && (
          <div className="border-t border-line p-5">
            <Button asChild><Link href={`/app/patients/${r.patient}`}><FolderOpen className="size-4" /> فتح ملف المريض</Link></Button>
          </div>
        )}
      </Card>
    </div>
  );
}
