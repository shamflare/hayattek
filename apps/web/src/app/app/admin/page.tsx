"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity, ArrowLeft, Building2, ClipboardList, FlaskConical, Hospital, ScanLine, ShieldAlert,
  ShieldCheck, Stethoscope, Users,
} from "lucide-react";
import Link from "next/link";

import { KpiTile } from "@/components/admin/common";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ErrorState, Skeleton } from "@/components/ui/surface";
import { api, errorMessage, unwrap } from "@/lib/api";
import { m } from "@/lib/i18n";

const KIND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  clinic: Stethoscope,
  medical_center: Building2,
  hospital: Hospital,
  laboratory: FlaskConical,
  imaging_center: ScanLine,
};

export default function AdminDashboard() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => unwrap(api.GET("/api/v1/admin/stats")),
  });

  const totalOrgs = data ? Object.values(data.organizations_by_kind).reduce((a, b) => a + b, 0) : 0;
  const maxKind = data ? Math.max(1, ...Object.values(data.organizations_by_kind)) : 1;
  const denied = data?.denied_access_last_7_days ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="إدارة المنصة"
        title="لوحة التشغيل"
        description="أرقام مجمعة عن الشبكة. هذه المنطقة لا تعرض أي سجل طبي أو بيانات مريض."
        actions={
          <Button variant="outline" asChild>
            <Link href="/app/admin/organizations"><Building2 className="size-4" /> المنشآت</Link>
          </Button>
        }
      />

      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-6">
          {denied > 0 && (
            <Link href="/app/admin/audit?outcome=denied"
              className="flex items-center gap-3 rounded-card border border-danger/30 bg-danger-soft p-4 text-danger transition-colors hover:border-danger/60">
              <ShieldAlert className="size-5 shrink-0" />
              <div className="flex-1 text-sm">
                <b><span className="num">{denied}</span> محاولة وصول مرفوضة</b> خلال آخر 7 أيام. راجع السجل الأمني.
              </div>
              <ArrowLeft className="size-4" />
            </Link>
          )}

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {isLoading || !data ? (
              Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-card" />)
            ) : (
              <>
                <KpiTile label="منشآت فعالة" value={data.organizations_active}
                  icon={<Building2 className="size-[18px]" />} hint={<>من أصل <span className="num">{totalOrgs}</span> منشأة</>}
                  href="/app/admin/organizations?status=active" />
                <KpiTile label="أطباء معتمدون" value={data.practitioners_verified}
                  icon={<ShieldCheck className="size-[18px]" />} hint="تم التحقق من تراخيصهم" />
                <KpiTile label="بانتظار التحقق" value={data.practitioners_pending}
                  tone={data.practitioners_pending > 0 ? "warning" : "neutral"}
                  icon={<Stethoscope className="size-[18px]" />}
                  hint={data.practitioners_pending > 0 ? "افتح قائمة الاعتماد ←" : "لا يوجد طلبات معلقة"}
                  href="/app/admin/practitioners" />
                <KpiTile label="مرضى في الشبكة" value={data.patients_total}
                  icon={<Users className="size-[18px]" />} hint="عدد الملفات الصحية فقط" />
                <KpiTile label="زيارات (30 يوماً)" value={data.encounters_last_30_days}
                  icon={<Activity className="size-[18px]" />} />
                <KpiTile label="وصفات (30 يوماً)" value={data.prescriptions_last_30_days}
                  icon={<ClipboardList className="size-[18px]" />} />
                <KpiTile label="وصول مرفوض (7 أيام)" value={denied}
                  tone={denied > 0 ? "danger" : "neutral"} icon={<ShieldAlert className="size-[18px]" />}
                  hint={denied > 0 ? "يحتاج مراجعة" : "لا توجد محاولات مرفوضة"}
                  href="/app/admin/audit?outcome=denied" />
                <KpiTile label="إجمالي المنشآت" value={totalOrgs}
                  icon={<Hospital className="size-[18px]" />} href="/app/admin/organizations" />
              </>
            )}
          </div>

          <Card>
            <CardHeader title="المنشآت حسب النوع" description="كل المنشآت المسجلة بغض النظر عن حالتها"
              icon={<Building2 className="size-[18px]" />} />
            <CardBody>
              {isLoading || !data ? (
                <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
              ) : (
                <ul className="space-y-3">
                  {Object.entries(m.orgKinds).map(([kind, text]) => {
                    const n = data.organizations_by_kind[kind] ?? 0;
                    const Icon = KIND_ICONS[kind] ?? Building2;
                    return (
                      <li key={kind}>
                        <Link href={`/app/admin/organizations?kind=${kind}`}
                          className="group flex items-center gap-3 rounded-xl p-1 hover:bg-sunken/60">
                          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sunken text-muted group-hover:text-brand-600">
                            <Icon className="size-4" />
                          </span>
                          <span className="w-28 shrink-0 text-sm sm:w-36">{text}</span>
                          <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-sunken">
                            <span className="block h-full rounded-full bg-brand-500 transition-all"
                              style={{ width: `${(n / maxKind) * 100}%` }} />
                          </span>
                          <span className="num w-8 text-end text-sm font-semibold">{n}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
