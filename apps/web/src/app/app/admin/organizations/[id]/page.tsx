"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2, CheckCircle2, Mail, MapPin, Pencil, Phone, PauseCircle, Printer, ScrollText,
  UserPlus, Users, Wallet,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  MembershipStatusBadge, OrgStatusBadge, ResponsiveList, RoleBadges, VerificationBadge,
} from "@/components/admin/common";
import { AddMemberDialog } from "@/components/admin/member-dialog";
import { OrganizationFormDialog } from "@/components/admin/organization-form";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import {
  Avatar, Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton, SkeletonList,
} from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { formatDate, formatPhone } from "@/lib/format";
import { label } from "@/lib/i18n";

type Member = Schemas["Membership"];

const subscriptionStatus: Record<string, string> = {
  trial: "تجريبي", active: "فعال", suspended: "معلق", cancelled: "ملغى",
};

export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [statusTarget, setStatusTarget] = React.useState<"active" | "suspended" | null>(null);

  const org = useQuery({
    queryKey: ["admin", "organization", id],
    queryFn: () => unwrap(api.GET("/api/v1/admin/organizations/{id}", { params: { path: { id } } })),
  });
  const members = useQuery({
    queryKey: ["admin", "organization", id, "members"],
    queryFn: () => unwrap(api.GET("/api/v1/admin/organizations/{id}/members", {
      params: { path: { id }, query: { page_size: 100 } },
    })),
  });
  const subscriptions = useQuery({
    queryKey: ["admin", "subscriptions", id],
    queryFn: () => unwrap(api.GET("/api/v1/admin/subscriptions", { params: { query: { organization: id } } })),
  });

  const setStatus = useMutation({
    mutationFn: (status: string) => unwrap(api.POST("/api/v1/admin/organizations/{id}/set-status", {
      params: { path: { id } }, body: { status },
    })),
    onSuccess: (data) => {
      toast.success(data.status === "active" ? "المنشأة فعالة الآن" : "عُلّقت المنشأة");
      setStatusTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (org.error) {
    return (
      <>
        <PageHeader title="المنشأة" back="/app/admin/organizations" />
        <ErrorState message={errorMessage(org.error)} onRetry={() => org.refetch()} />
      </>
    );
  }
  const o = org.data;
  const memberList = members.data?.results ?? [];
  const currentSub = subscriptions.data?.results?.[0];

  return (
    <>
      <PageHeader
        back="/app/admin/organizations"
        eyebrow={o ? label("orgKinds", o.kind) : "المنشأة"}
        title={o ? (
          <span className="flex flex-wrap items-center gap-3">{o.name} <OrgStatusBadge status={o.status} /></span>
        ) : <Skeleton className="h-8 w-64" />}
        description={o?.name_en ? <span dir="ltr">{o.name_en}</span> : undefined}
        actions={o && (
          <>
            <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" /> تعديل</Button>
            {o.status === "active" ? (
              <Button variant="danger-ghost" onClick={() => setStatusTarget("suspended")}>
                <PauseCircle className="size-4" /> تعليق
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setStatusTarget("active")}>
                <CheckCircle2 className="size-4" /> تفعيل
              </Button>
            )}
          </>
        )}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="order-2 lg:order-1">
          <CardHeader
            title="فريق المنشأة"
            description={members.data ? <><span className="num">{members.data.count}</span> عضو</> : undefined}
            icon={<Users className="size-[18px]" />}
            action={<Button size="sm" onClick={() => setAdding(true)} disabled={!o}><UserPlus className="size-4" /> إضافة عضو</Button>}
          />
          <div className="mt-4 border-t border-line">
            {members.error ? (
              <div className="p-4"><ErrorState message={errorMessage(members.error)} onRetry={() => members.refetch()} /></div>
            ) : members.isLoading ? (
              <div className="p-5"><SkeletonList rows={4} /></div>
            ) : memberList.length === 0 ? (
              <EmptyState icon={<Users className="size-6" />} title="لا يوجد أعضاء بعد"
                description="ابدأ بإضافة مدير المنشأة، ثم يضيف هو بقية الفريق."
                action={<Button onClick={() => setAdding(true)}><UserPlus className="size-4" /> إضافة عضو</Button>} />
            ) : (
              <ResponsiveList<Member>
                items={memberList}
                rowKey={(mb) => mb.id}
                head={["العضو", "الأدوار", "التحقق", "الحالة"]}
                row={(mb) => [
                  <MemberCell key="u" member={mb} />,
                  <RoleBadges key="r" roles={mb.roles} />,
                  mb.practitioner ? <VerificationBadge key="v" status={mb.practitioner.verification_status} /> : <span key="v" className="text-subtle">—</span>,
                  <MembershipStatusBadge key="s" status={mb.status} />,
                ]}
                card={(mb) => (
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <MemberCell member={mb} />
                      <MembershipStatusBadge status={mb.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1 ps-[52px]">
                      <RoleBadges roles={mb.roles} />
                      {mb.practitioner && <VerificationBadge status={mb.practitioner.verification_status} />}
                    </div>
                  </div>
                )}
              />
            )}
          </div>
        </Card>

        <div className="order-1 space-y-6 lg:order-2">
          <Card>
            <CardHeader title="بيانات المنشأة" icon={<Building2 className="size-[18px]" />} />
            <CardBody className="space-y-3 text-sm">
              {!o ? <SkeletonList rows={3} /> : (
                <>
                  <InfoRow icon={MapPin} label="العنوان"
                    value={[o.address, o.city, label("governorates", o.governorate)].filter((x) => x && x !== "—").join("، ") || "—"} />
                  <InfoRow icon={Phone} label="الهاتف" value={<span className="num">{formatPhone(o.phone)}</span>} />
                  <InfoRow icon={Mail} label="البريد" value={o.email ? <span dir="ltr">{o.email}</span> : "—"} />
                  <InfoRow icon={ScrollText} label="رقم الترخيص" value={<span className="num">{o.license_number || "—"}</span>} />
                  <InfoRow icon={Printer} label="تذييل الطباعة" value={o.print_footer || "—"} />
                  <div className="pt-1 text-xs text-subtle">أُضيفت في {formatDate(o.created_at)}</div>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="الاشتراك" icon={<Wallet className="size-[18px]" />}
              action={<Button size="sm" variant="ghost" asChild><Link href={`/app/admin/plans?organization=${id}`}>إدارة</Link></Button>} />
            <CardBody className="text-sm">
              {subscriptions.isLoading ? <Skeleton className="h-12" /> : currentSub ? (
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{currentSub.plan_name}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      منذ {formatDate(currentSub.starts_on)}
                      {currentSub.ends_on && <> حتى {formatDate(currentSub.ends_on)}</>}
                    </div>
                  </div>
                  <Badge tone={currentSub.status === "active" ? "success" : currentSub.status === "trial" ? "info" : "warning"}>
                    {subscriptionStatus[currentSub.status ?? "trial"]}
                  </Badge>
                </div>
              ) : <p className="text-muted">لا يوجد اشتراك مسجل.</p>}
            </CardBody>
          </Card>
        </div>
      </div>

      {o && (
        <>
          <OrganizationFormDialog open={editing} onOpenChange={setEditing} organization={o}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin"] })} />
          <AddMemberDialog
            open={adding}
            onOpenChange={setAdding}
            facilityName={o.name}
            submit={(body) => unwrap(api.POST("/api/v1/admin/organizations/{id}/members", {
              params: { path: { id } }, body,
            }))}
            onAdded={() => queryClient.invalidateQueries({ queryKey: ["admin"] })}
          />
          <ConfirmDialog
            open={statusTarget !== null}
            onOpenChange={(open) => !open && setStatusTarget(null)}
            title={statusTarget === "suspended" ? "تعليق المنشأة؟" : "تفعيل المنشأة؟"}
            description={statusTarget === "suspended"
              ? "سيتوقف جميع أعضاء المنشأة عن الوصول إلى السجلات الطبية فوراً، ولن تُستقبل طلبات جديدة. يمكن إعادة التفعيل لاحقاً."
              : "سيتمكن أعضاء المنشأة من العمل على المنصة مجدداً وفق صلاحياتهم."}
            confirmLabel={statusTarget === "suspended" ? "تعليق" : "تفعيل"}
            tone={statusTarget === "suspended" ? "danger" : "primary"}
            loading={setStatus.isPending}
            onConfirm={() => statusTarget && setStatus.mutate(statusTarget)}
          />
        </>
      )}
    </>
  );
}

function MemberCell({ member }: { member: Member }) {
  const name = member.practitioner?.display_name ?? member.user.full_name;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={name} />
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        <div className="truncate text-xs text-muted">
          {member.title ? `${member.title} · ` : ""}
          <span dir="ltr">{member.user.email ?? member.user.phone ?? ""}</span>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label: title, value }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-subtle" />
      <div className="min-w-0">
        <div className="text-xs text-subtle">{title}</div>
        <div className="break-words">{value}</div>
      </div>
    </div>
  );
}
