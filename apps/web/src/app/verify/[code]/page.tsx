"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Ban, Info, SearchX } from "lucide-react";
import { useParams } from "next/navigation";
import type * as React from "react";

import { PublicShell } from "@/components/public/public-shell";
import { Card, CardBody, ErrorState, Skeleton } from "@/components/ui/surface";
import { errorMessage, isApiError, patientApi, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";

/**
 * Public authenticity check printed on prescriptions (QR / code). Shows only who issued
 * the prescription and when — never the medicines, diagnosis or patient.
 */
export default function VerifyPrescriptionPage() {
  const { code } = useParams<{ code: string }>();
  const query = useQuery({
    queryKey: ["public", "prescription", code],
    queryFn: async () => {
      try {
        return await unwrap(patientApi.GET("/api/v1/public/prescriptions/{code}", { params: { path: { code } } }));
      } catch (e) {
        if (isApiError(e) && e.status === 404) return null; // unknown code
        throw e;
      }
    },
    retry: false,
  });
  const rx = query.data;

  return (
    <PublicShell>
      <h1 className="mb-1 text-2xl font-bold">التحقق من وصفة طبية</h1>
      <p className="mb-6 text-muted">رمز التحقق: <span className="num font-semibold text-fg">{decodeURIComponent(code).toUpperCase()}</span></p>

      {query.isLoading ? (
        <Skeleton className="h-64 w-full rounded-3xl" />
      ) : query.isError ? (
        <ErrorState
          message={isApiError(query.error) && query.error.status === 429
            ? "محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة."
            : errorMessage(query.error)}
          onRetry={() => query.refetch()} />
      ) : !rx ? (
        <Card>
          <CardBody className="flex flex-col items-center px-6 py-12 text-center">
            <div className="grid size-16 place-items-center rounded-3xl bg-danger-soft text-danger"><SearchX className="size-9" /></div>
            <h2 className="mt-4 text-xl font-bold">لم نجد وصفة بهذا الرمز</h2>
            <p className="mt-2 max-w-sm leading-8 text-muted">
              تأكد من كتابة الرمز كما هو مطبوع على الوصفة. إن استمرت المشكلة فقد لا تكون الوصفة صادرة عبر منصة حياة.
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className={rx.valid
            ? "flex items-center gap-4 bg-success-soft px-6 py-5 text-success"
            : "flex items-center gap-4 bg-danger-soft px-6 py-5 text-danger"}>
            {rx.valid ? <BadgeCheck className="size-10 shrink-0" /> : <Ban className="size-10 shrink-0" />}
            <div>
              <h2 className="text-xl font-bold">{rx.valid ? "وصفة صحيحة" : "وصفة ملغاة"}</h2>
              <p className="text-sm opacity-90">
                {rx.valid
                  ? rx.status === "amended" ? "صادرة عبر منصة حياة، وعُدّلت من الطبيب بعد إصدارها." : "صادرة عبر منصة حياة ولم تُلغَ."
                  : "ألغى الطبيب هذه الوصفة. لا تُصرف."}
              </p>
            </div>
          </div>
          <CardBody>
            <dl className="divide-y divide-line">
              <Row label="رقم الوصفة"><span className="num">{rx.number ?? "—"}</span></Row>
              <Row label="تاريخ الإصدار">{formatDate(rx.issued_on)}</Row>
              <Row label="المنشأة">{rx.organization_name ?? "—"}</Row>
              <Row label="الطبيب">{rx.practitioner_name ?? "—"}</Row>
            </dl>
            <p className="mt-4 flex items-start gap-2 rounded-2xl bg-sunken p-3 text-xs leading-6 text-muted">
              <Info className="mt-0.5 size-4 shrink-0" />
              لحماية خصوصية المريض لا تُعرض هنا الأدوية أو التشخيص. قارن الرقم والتاريخ والطبيب بما هو مطبوع على الورقة.
            </p>
          </CardBody>
        </Card>
      )}
    </PublicShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-end font-medium">{children}</dd>
    </div>
  );
}
