"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bell, ChevronLeft, ClipboardList, FileText, FlaskConical, HeartPulse, IdCard, Settings, Share2, Users,
} from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import * as React from "react";

import { AccessRequestCard } from "@/components/patient/access-request-card";
import { useActivePatient } from "@/components/patient/active-patient";
import { asList, portalKeys } from "@/components/patient/portal";
import { RecordDetailDialog, type RecordRef } from "@/components/patient/record-detail";
import { TimelineCard } from "@/components/patient/timeline-card";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, ErrorState, Skeleton } from "@/components/ui/surface";
import { errorMessage, patientApi, unwrap } from "@/lib/api";
import { DISPLAY_TZ } from "@/lib/format";
import { useSession } from "@/lib/session";

function greeting(): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TZ, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  if (hour < 12) return "صباح الخير";
  if (hour < 18) return "نهارك سعيد";
  return "مساء الخير";
}

const tiles = [
  { href: "/app/me/records", label: "ملفي الطبي", hint: "الزيارات والتشخيصات", icon: HeartPulse },
  { href: "/app/me/prescriptions", label: "الوصفات", hint: "أدويتك وطريقة تناولها", icon: ClipboardList },
  { href: "/app/me/labs", label: "التحاليل", hint: "النتائج وتطورها", icon: FlaskConical },
  { href: "/app/me/documents", label: "الأشعة والمستندات", hint: "صور وتقارير", icon: FileText },
  { href: "/app/me/sharing", label: "المشاركة", hint: "من يرى ملفك", icon: Share2 },
  { href: "/app/me/family", label: "العائلة", hint: "ملفات من تعتني بهم", icon: Users },
  { href: "/app/me/settings", label: "معلوماتي", hint: "الهاتف والحساسية", icon: Settings },
  { href: "/app/notifications", label: "الإشعارات", hint: "ما يحدث في ملفك", icon: Bell },
];

export default function PatientHome() {
  const { me } = useSession();
  const { active, patients } = useActivePatient();
  const patientId = active!.id;
  const [open, setOpen] = React.useState<RecordRef | null>(null);
  // Rendered client-side only (behind the session gate), so no hydration mismatch.
  const hello = greeting();

  const card = useQuery({
    queryKey: portalKeys.card(patientId),
    queryFn: () => unwrap(patientApi.GET("/api/v1/me/patients/{id}/card", { params: { path: { id: patientId } } })),
  });
  const requests = useQuery({
    queryKey: portalKeys.requests,
    queryFn: () => unwrap(patientApi.GET("/api/v1/me/sharing/requests")),
  });
  const timeline = useQuery({
    queryKey: portalKeys.timeline(patientId, ""),
    queryFn: () => unwrap(patientApi.GET("/api/v1/clinical/timeline", { params: { query: { patient: patientId } } })),
  });

  const pending = asList(requests.data);
  const firstName = (active!.isOwn ? me?.full_name : active!.full_name)?.split(/\s+/)[0] ?? "";

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
        <div className="flex-1">
          <p className="text-sm font-medium text-brand-600">{hello}</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{firstName ? `أهلاً ${firstName}` : "أهلاً بك"}</h1>
          <p className="mt-2 max-w-lg leading-8 text-muted">
            {active!.isOwn
              ? "هنا ملفك الصحي كاملاً: زياراتك، وصفاتك، تحاليلك، ومن يستطيع رؤيتها."
              : `هنا ملف ${active!.full_name} الصحي الذي تعتني به.`}
          </p>
        </div>

        {/* Health-card preview */}
        <Link href="/app/me/card"
          className="group relative block overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white shadow-card transition-transform hover:-translate-y-0.5 lg:w-[380px]">
          <div className="absolute -end-10 -top-10 size-40 rounded-full bg-white/10" aria-hidden />
          <div className="relative flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-white/75"><IdCard className="size-4" /> البطاقة الصحية</div>
              <div className="mt-2 truncate text-lg font-semibold">{active!.full_name}</div>
              <div className="num mt-1 text-xl tracking-wider">{active!.health_number}</div>
              <div className="mt-3 inline-flex items-center gap-1 text-sm text-white/85 group-hover:text-white">
                عرض البطاقة <ChevronLeft className="size-4" />
              </div>
            </div>
            <div className="grid size-24 shrink-0 place-items-center rounded-2xl bg-white p-2">
              {card.data ? (
                <QRCodeSVG value={card.data.qr_url} size={80} level="M" aria-label="رمز البطاقة" />
              ) : (
                <Skeleton className="size-20 bg-white" />
              )}
            </div>
          </div>
        </Link>
      </section>

      {/* Pending access requests */}
      {pending.length > 0 && (
        <section aria-labelledby="pending-title" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="pending-title" className="text-lg font-semibold">
              بانتظار موافقتك <span className="num ms-1 rounded-full bg-warning-soft px-2 py-0.5 text-sm text-warning">{pending.length}</span>
            </h2>
            <Link href="/app/me/sharing" className="text-sm font-medium text-brand-600 hover:underline">مركز المشاركة</Link>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {pending.map((r) => <AccessRequestCard key={r.id} request={r} showPatient={patients.length > 1} />)}
          </div>
        </section>
      )}
      {requests.isError && <ErrorState message={errorMessage(requests.error)} onRetry={() => requests.refetch()} />}

      {/* Quick links */}
      <section aria-label="الأقسام" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map(({ href, label, hint, icon: Icon }) => (
          <Link key={href} href={href}
            className="flex flex-col gap-3 rounded-card border border-line bg-elevated p-4 shadow-soft transition-colors hover:border-brand-300">
            <div className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-600"><Icon className="size-5" /></div>
            <div>
              <div className="font-semibold">{label}</div>
              <div className="mt-0.5 text-xs text-muted">{hint}</div>
            </div>
          </Link>
        ))}
      </section>

      {/* Latest records */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">آخر ما أُضيف إلى ملفك</h2>
          <Link href="/app/me/records" className="text-sm font-medium text-brand-600 hover:underline">عرض الكل</Link>
        </div>
        {timeline.isLoading ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-card" />)}</div>
        ) : timeline.isError ? (
          <ErrorState message={errorMessage(timeline.error)} onRetry={() => timeline.refetch()} />
        ) : (timeline.data?.items.length ?? 0) === 0 ? (
          <Card>
            <EmptyState icon={<HeartPulse className="size-7" />} title="لا توجد سجلات بعد"
              description="عندما يضيف طبيبك أو المختبر شيئاً إلى ملفك سيظهر هنا. يمكنك أيضاً رفع تقاريرك القديمة."
              action={<Button variant="secondary" asChild><Link href="/app/me/documents">رفع تقرير قديم</Link></Button>} />
          </Card>
        ) : (
          <div className="space-y-3">
            {timeline.data!.items.slice(0, 5).map((item) => (
              <TimelineCard key={`${item.type}-${item.id}`} item={item}
                onOpen={(i) => setOpen({ type: i.type, id: i.id, title: i.title })} />
            ))}
          </div>
        )}
      </section>

      <RecordDetailDialog patientId={patientId} record={open} onClose={() => setOpen(null)} />
    </div>
  );
}
