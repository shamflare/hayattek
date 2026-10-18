"use client";

import { Building2, IdCard, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ActivePatientProvider, useActivePatient } from "@/components/patient/active-patient";
import { Card, CardBody } from "@/components/ui/surface";

function PortalGate({ children }: { children: React.ReactNode }) {
  const { patients, active } = useActivePatient();

  if (patients.length === 0 || !active) return <NoPatientFile />;

  return (
    <>
      {!active.isOwn && (
        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-fg">
          <Users className="size-4 shrink-0 text-accent" />
          <span>
            تتصفح ملف <strong>{active.full_name}</strong> بصفتك وصياً عليه.
          </span>
          <Link href="/app/me/family" className="ms-auto font-semibold text-accent underline underline-offset-4">
            تغيير
          </Link>
        </div>
      )}
      {/* key: remount on switch so no state of one file leaks into another. */}
      <React.Fragment key={active.id}>{children}</React.Fragment>
    </>
  );
}

function NoPatientFile() {
  return (
    <div className="mx-auto max-w-xl py-6">
      <Card>
        <CardBody className="flex flex-col items-center px-6 py-10 text-center">
          <div className="mb-5 grid size-16 place-items-center rounded-3xl bg-brand-50 text-brand-600">
            <IdCard className="size-8" />
          </div>
          <h1 className="text-xl font-bold">لا يوجد ملف صحي مرتبط بحسابك بعد</h1>
          <p className="mt-3 leading-8 text-muted">
            يُنشأ الملف الصحي في منصة حياة عند أول زيارة لك إلى عيادة أو مركز طبي مشترك في المنصة.
            اطلب من موظف الاستقبال تسجيلك وربط الملف برقم هاتفك أو بريدك الإلكتروني، وستظهر بطاقتك
            وسجلاتك هنا تلقائياً.
          </p>
          <div className="mt-6 flex w-full flex-col gap-2 rounded-2xl bg-sunken p-4 text-start text-sm leading-7 text-muted">
            <div className="flex items-start gap-2">
              <Building2 className="mt-1 size-4 shrink-0 text-brand-600" />
              أحضر معك هويتك الشخصية عند التسجيل.
            </div>
            <div className="flex items-start gap-2">
              <Users className="mt-1 size-4 shrink-0 text-brand-600" />
              لأطفالك أو لمن تعتني به: يمكن للمنشأة ربط ملفاتهم بحسابك كوصي.
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default function PatientPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <ActivePatientProvider>
      <PortalGate>{children}</PortalGate>
    </ActivePatientProvider>
  );
}
