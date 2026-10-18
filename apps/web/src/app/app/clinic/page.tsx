"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, ClipboardPlus, FlaskConical, Inbox, ScanLine, Search, Send, UserPlus, Users,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/app/page-header";
import { PatientRow } from "@/components/clinical/patient-row";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, EmptyState, ErrorState, SkeletonList } from "@/components/ui/surface";
import { api, errorMessage, unwrap } from "@/lib/api";
import { useSession } from "@/lib/session";

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Damascus" }).format(new Date()));
  if (h < 12) return "صباح الخير";
  if (h < 18) return "نهارك سعيد";
  return "مساء الخير";
}

export default function ClinicHome() {
  const { me, membership, isClinician, has } = useSession();
  const recent = useQuery({
    queryKey: ["patients", "recent"],
    queryFn: () => unwrap(api.GET("/api/v1/patients", { params: { query: { page_size: 8 } as never } })),
  });
  const inbox = useQuery({
    queryKey: ["referrals", "inbox"],
    queryFn: () => unwrap(api.GET("/api/v1/referrals/inbox")),
    enabled: isClinician,
  });
  const pendingReferrals = (inbox.data?.results ?? []).filter((r) => r.state === "sent");
  const name = me?.practitioner?.display_name ?? me?.full_name;

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow={membership?.organization.name}
        title={`${greeting()}، ${name ?? ""}`}
        description={isClinician ? "ابدأ بمسح بطاقة المريض أو ابحث عنه." : "سجّل المرضى الجدد أو ابحث عن ملف موجود."}
      />

      {me?.practitioner && me.practitioner.verification_status !== "verified" && (
        <div className="mb-6 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
          هويتك المهنية بانتظار التحقق من إدارة المنصة. يمكنك تصفح النظام، لكن كتابة السجلات الطبية تُفعّل بعد الاعتماد.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <QuickAction href="/app/scan" icon={ScanLine} title="مسح بطاقة" text="افتح الملف بكاميرا الجهاز" primary />
        <QuickAction href="/app/patients" icon={Search} title="بحث عن مريض" text="بالاسم أو الرقم أو الهاتف" />
        {has("receptionist", "physician", "nurse") && (
          <QuickAction href="/app/patients/new" icon={UserPlus} title="مريض جديد" text="ملف + رقم صحي + بطاقة" />
        )}
        {isClinician ? (
          <QuickAction href="/app/medications" icon={ClipboardPlus} title="أدويتي وقوالبي" text="جهّز وصفاتك المتكررة" />
        ) : (
          <QuickAction href="/app/patients" icon={Users} title="مرضى المنشأة" text="قائمة الملفات المسجلة" />
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader icon={<Users className="size-5" />} title="آخر المرضى" description="المرضى المسجلون في منشأتك مرتبين بآخر زيارة"
            action={<Button asChild variant="ghost" size="sm"><Link href="/app/patients">الكل <ArrowLeft className="size-4" /></Link></Button>} />
          <CardBody className="pt-3">
            {recent.isLoading ? <SkeletonList rows={5} /> : recent.isError ? (
              <ErrorState message={errorMessage(recent.error)} onRetry={() => recent.refetch()} />
            ) : recent.data?.results.length ? (
              <div className="-mx-2 divide-y divide-line">
                {recent.data.results.map((p) => <PatientRow key={p.id} patient={p} />)}
              </div>
            ) : (
              <EmptyState icon={<Users className="size-6" />} title="لا يوجد مرضى بعد"
                description="عند تسجيل أول مريض سيظهر هنا."
                action={<Button asChild><Link href="/app/patients/new"><UserPlus className="size-4" /> تسجيل مريض</Link></Button>} />
            )}
          </CardBody>
        </Card>

        <div className="space-y-6">
          {isClinician && (
            <Card>
              <CardHeader icon={<Send className="size-5" />} title="إحالات واردة" description="بانتظار ردك" />
              <CardBody className="pt-3">
                {inbox.isLoading ? <SkeletonList rows={2} /> : pendingReferrals.length ? (
                  <ul className="space-y-2">
                    {pendingReferrals.slice(0, 4).map((r) => (
                      <li key={r.id}>
                        <Link href={`/app/referrals/${r.id}`} className="block rounded-xl border border-line p-3 hover:border-brand-300">
                          <div className="font-medium">{r.patient_brief.full_name}</div>
                          <div className="text-xs text-muted">من {r.author_name} · {r.organization_name}</div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="py-4 text-center text-sm text-muted"><Inbox className="mx-auto mb-2 size-6 text-subtle" />لا توجد إحالات جديدة</p>
                )}
              </CardBody>
            </Card>
          )}
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white">
              <FlaskConical className="size-6 text-brand-200" />
              <div className="mt-3 font-semibold">نصيحة سريعة</div>
              <p className="mt-1.5 text-sm leading-7 text-white/80">
                اضغط <span className="num rounded bg-white/15 px-1.5">Ctrl K</span> في أي مكان للبحث عن مريض فوراً.
                مسح البطاقة يحدد المريض فقط — الاطلاع على سجلات المنشآت الأخرى يحتاج موافقته.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ href, icon: Icon, title, text, primary }: {
  href: string; icon: React.ElementType; title: string; text: string; primary?: boolean;
}) {
  return (
    <Link href={href}
      className={primary
        ? "group flex items-center gap-4 rounded-card bg-brand-600 p-5 text-white shadow-card transition hover:bg-brand-700"
        : "group flex items-center gap-4 rounded-card border border-line bg-elevated p-5 shadow-soft transition hover:border-brand-300 hover:shadow-card"}>
      <div className={primary ? "grid size-12 place-items-center rounded-2xl bg-white/15" : "grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600"}>
        <Icon className="size-6" />
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className={primary ? "text-sm text-white/75" : "text-sm text-muted"}>{text}</div>
      </div>
    </Link>
  );
}
