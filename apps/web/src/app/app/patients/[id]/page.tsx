"use client";

import { useMutation } from "@tanstack/react-query";
import {
  CheckCircle2, ClipboardList, FileUp, FlaskConical, IdCard, Image as ImageIcon, MoreHorizontal,
  Phone, Plus, Printer, Send, ShieldCheck, Smartphone, Stethoscope, Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import * as React from "react";
import { toast } from "sonner";

import { AccessRequestCard } from "@/components/clinical/access-panel";
import { ActivateAccountDialog, LinkGuardianDialog } from "@/components/clinical/account-dialogs";
import { usePatient, useSummary } from "@/components/clinical/queries";
import { OrderDialog, ReferralDialog, UploadDialog } from "@/components/clinical/quick-dialogs";
import { SummaryPanel } from "@/components/clinical/summary-panel";
import { Timeline } from "@/components/clinical/timeline";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, Card, ErrorState, Skeleton } from "@/components/ui/surface";
import { api, errorMessage, unwrap } from "@/lib/api";
import { ageLabel, formatDate, formatPhone, sexLabel } from "@/lib/format";
import { label } from "@/lib/i18n";
import { useSession } from "@/lib/session";

type DialogKind = "lab" | "imaging" | "upload" | "referral" | "account" | "guardian" | null;

function ChartInner() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { isClinician, has } = useSession();
  const patientQuery = usePatient(id);
  const access = patientQuery.data?.access;
  const canSeeClinical = Boolean(access?.can_view_clinical) || has("lab_staff", "imaging_staff");
  const summary = useSummary(id, Boolean(access?.can_view_clinical));
  const [dialog, setDialog] = React.useState<DialogKind>(null);

  const newVisit = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/clinical/encounters", { body: { patient: id } as never })),
    onSuccess: (e) => router.push(`/app/encounters/${e.id}`),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (patientQuery.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-36 rounded-card" /><div className="grid gap-4 lg:grid-cols-[1fr_340px]"><Skeleton className="h-96 rounded-card" /><Skeleton className="h-96 rounded-card" /></div></div>;
  }
  if (patientQuery.isError || !patientQuery.data) {
    return <ErrorState message={errorMessage(patientQuery.error)} onRetry={() => patientQuery.refetch()} />;
  }
  const { patient } = patientQuery.data;
  const canAuthor = Boolean(access?.can_author);

  return (
    <div className="animate-fade-up space-y-5">
      {params.get("created") && (
        <div className="flex flex-col gap-3 rounded-card border border-success/30 bg-success-soft p-4 sm:flex-row sm:items-center">
          <CheckCircle2 className="size-6 shrink-0 text-success" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-fg">تم إنشاء الملف. الرقم الصحي: <span className="num">{patient.health_number}</span></div>
            <div className="text-muted">اطبع البطاقة الصحية وسلّمها للمريض — يستخدمها في أي منشأة مشاركة.</div>
          </div>
          <Button asChild variant="outline"><Link href={`/print/card/${patient.id}`} target="_blank"><Printer className="size-4" /> طباعة البطاقة</Link></Button>
        </div>
      )}

      {/* ------------------------------------------------ identity header */}
      <Card className="p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <Avatar name={patient.full_name} className="size-16 text-lg" />
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold">{patient.full_name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                <span>{sexLabel(patient.sex)}</span>
                <span>{ageLabel(patient.age_years, patient.birth_date_precision)}</span>
                <span className="flex items-center gap-1"><IdCard className="size-4" /><span className="num font-medium text-fg">{patient.health_number}</span></span>
                {patient.phone && <span className="flex items-center gap-1"><Phone className="size-4" /><span className="num">{formatPhone(patient.phone)}</span></span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {access?.registered && <Badge tone="brand">مسجل في منشأتك</Badge>}
                {!!access?.network_scopes.length && (
                  <Badge tone="success"><ShieldCheck className="size-3.5" /> وصول بموافقة: {access.network_scopes.map((s) => label("scopes", s)).join("، ")}</Badge>
                )}
                {patient.has_account && <Badge>لديه حساب في التطبيق</Badge>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {isClinician && canAuthor && (
              <>
                <Button size="lg" loading={newVisit.isPending} onClick={() => newVisit.mutate()}><Stethoscope className="size-5" /> زيارة جديدة</Button>
                <Button size="lg" variant="secondary" asChild><Link href={`/app/prescriptions/new?patient=${patient.id}`}><ClipboardList className="size-5" /> وصفة</Link></Button>
              </>
            )}
            <DropdownMenu.Root dir="rtl">
              <DropdownMenu.Trigger asChild>
                <Button size="lg" variant="outline" aria-label="المزيد"><MoreHorizontal className="size-5" /></Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-56 rounded-2xl border border-line bg-elevated p-1.5 shadow-float">
                  {isClinician && canAuthor && (
                    <>
                      <MenuItem icon={FlaskConical} onSelect={() => setDialog("lab")}>طلب تحليل</MenuItem>
                      <MenuItem icon={ImageIcon} onSelect={() => setDialog("imaging")}>طلب تصوير</MenuItem>
                      <MenuItem icon={FileUp} onSelect={() => setDialog("upload")}>رفع مستند</MenuItem>
                      <MenuItem icon={Send} onSelect={() => setDialog("referral")}>إحالة إلى طبيب</MenuItem>
                      <DropdownMenu.Separator className="my-1 h-px bg-line" />
                    </>
                  )}
                  {access?.registered && (
                    <MenuItem icon={Printer} onSelect={() => window.open(`/print/card/${patient.id}`, "_blank")}>طباعة البطاقة الصحية</MenuItem>
                  )}
                  {access?.registered && has("receptionist", "physician", "nurse") && (
                    <>
                      {!patient.has_account && <MenuItem icon={Smartphone} onSelect={() => setDialog("account")}>تفعيل حساب في التطبيق</MenuItem>}
                      <MenuItem icon={Users} onSelect={() => setDialog("guardian")}>ربط وصي</MenuItem>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </Card>

      {isClinician && access && (!access.can_view_clinical || (access.registered && !access.network_scopes.length)) && (
        <AccessRequestCard patientId={patient.id} hasPhone={Boolean(patient.phone)} hasAccount={patient.has_account} registered={access.registered} />
      )}

      {canSeeClinical && access?.can_view_clinical ? (
        <div className="grid items-start gap-5 lg:grid-cols-[1fr_340px]">
          <div className="order-2 min-w-0 lg:order-1">
            <Timeline patientId={patient.id} />
          </div>
          <aside className="order-1 min-w-0 lg:sticky lg:top-20 lg:order-2">
            <SummaryPanel patientId={patient.id} summary={summary.data} loading={summary.isLoading} canAuthor={isClinician && canAuthor} />
          </aside>
        </div>
      ) : !isClinician ? (
        <Card className="p-6">
          <h2 className="mb-4 font-semibold">البيانات الإدارية</h2>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Info label="اسم الأم" value={patient.mother_name} />
            <Info label="تاريخ الميلاد" value={patient.birth_date ? formatDate(patient.birth_date) : null} />
            <Info label="المحافظة" value={label("governorates", patient.governorate)} />
            <Info label="المدينة" value={patient.city} />
            <Info label="العنوان" value={patient.address} />
            <Info label="جهة الطوارئ" value={[patient.emergency_contact_name, patient.emergency_contact_relation].filter(Boolean).join(" — ")} />
          </dl>
          <p className="mt-6 rounded-xl bg-sunken p-3 text-xs text-muted">لا تظهر المعلومات الطبية لدورك في المنشأة. هذا مقصود لحماية خصوصية المريض.</p>
        </Card>
      ) : null}

      <OrderDialog kind="lab" open={dialog === "lab"} onOpenChange={(o) => setDialog(o ? "lab" : null)} patientId={patient.id} />
      <OrderDialog kind="imaging" open={dialog === "imaging"} onOpenChange={(o) => setDialog(o ? "imaging" : null)} patientId={patient.id} />
      <UploadDialog open={dialog === "upload"} onOpenChange={(o) => setDialog(o ? "upload" : null)} patientId={patient.id} />
      <ActivateAccountDialog open={dialog === "account"} onOpenChange={(o) => setDialog(o ? "account" : null)} patientId={patient.id} phone={patient.phone} />
      <LinkGuardianDialog open={dialog === "guardian"} onOpenChange={(o) => setDialog(o ? "guardian" : null)} patientId={patient.id} />
      <ReferralDialog open={dialog === "referral"} onOpenChange={(o) => setDialog(o ? "referral" : null)} patientId={patient.id} />
      {isClinician && canAuthor && (
        <Button size="lg" className="fixed bottom-20 end-4 z-20 size-14 rounded-full p-0 shadow-float lg:hidden" aria-label="زيارة جديدة"
          onClick={() => newVisit.mutate()}><Plus className="size-6" /></Button>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, children, onSelect }: { icon: React.ElementType; children: React.ReactNode; onSelect: () => void }) {
  return (
    <DropdownMenu.Item onSelect={onSelect} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-sunken">
      <Icon className="size-4 text-muted" /> {children}
    </DropdownMenu.Item>
  );
}

function Info({ label: l, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{l}</dt>
      <dd className="mt-0.5 font-medium">{value || "—"}</dd>
    </div>
  );
}

export default function PatientChartPage() {
  return <React.Suspense><ChartInner /></React.Suspense>;
}
