"use client";

import { useQuery } from "@tanstack/react-query";
import { Lock, ScanLine, ShieldAlert, ShieldCheck, Stethoscope } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { PublicShell } from "@/components/public/public-shell";
import { Button } from "@/components/ui/button";
import { Card, CardBody, ErrorState, Skeleton } from "@/components/ui/surface";
import { errorMessage, isApiError, patientApi, unwrap } from "@/lib/api";

/**
 * What anyone sees after scanning a HAYAT card with a phone camera. Deliberately shows no
 * personal or medical data: staff open the file from inside the app (audited).
 */
export default function PublicCardPage() {
  const { token } = useParams<{ token: string }>();
  const query = useQuery({
    queryKey: ["public", "card", token],
    queryFn: () => unwrap(patientApi.GET("/api/v1/public/cards/{token}", { params: { path: { token } } })),
    retry: false,
  });

  return (
    <PublicShell>
      {query.isLoading ? (
        <Skeleton className="h-80 w-full rounded-3xl" />
      ) : query.isError ? (
        <ErrorState
          message={isApiError(query.error) && query.error.status === 429
            ? "محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة."
            : errorMessage(query.error)}
          onRetry={() => query.refetch()} />
      ) : query.data?.valid ? (
        <Card className="overflow-hidden">
          <div className="flex flex-col items-center bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-10 text-center text-white">
            <div className="grid size-16 place-items-center rounded-3xl bg-white/15"><ShieldCheck className="size-9" /></div>
            <h1 className="mt-4 text-2xl font-bold">بطاقة صحية صالحة</h1>
            <p className="mt-1 text-white/80">هذه بطاقة صادرة عن منصة حياة الصحية.</p>
          </div>
          <CardBody className="space-y-5 p-6">
            <div className="flex items-start gap-3 rounded-2xl bg-sunken p-4 text-[15px] leading-7">
              <Lock className="mt-1 size-5 shrink-0 text-brand-600" />
              <p>
                لحماية خصوصية صاحب البطاقة لا تُعرض هنا أي معلومات شخصية أو طبية. يستطيع الطاقم الطبي فقط فتح
                الملف بعد تسجيل الدخول إلى تطبيق حياة، وكل اطلاع يُسجَّل ويراه صاحب البطاقة.
              </p>
            </div>
            <div className="space-y-2">
              <Button size="lg" className="w-full" asChild>
                <Link href={`/app/scan?token=${encodeURIComponent(token)}`}>
                  <Stethoscope className="size-5" /> أنا من الطاقم الطبي — افتح في التطبيق
                </Link>
              </Button>
              <p className="text-center text-xs text-subtle">سيُطلب منك تسجيل الدخول بحسابك في المنشأة.</p>
            </div>
            <div className="border-t border-line pt-4 text-sm leading-7 text-muted">
              <p className="flex items-start gap-2">
                <ScanLine className="mt-1 size-4 shrink-0" />
                وجدت هذه البطاقة؟ يمكنك تسليمها لأقرب عيادة أو مركز طبي.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="flex flex-col items-center px-6 py-12 text-center">
            <div className="grid size-16 place-items-center rounded-3xl bg-danger-soft text-danger"><ShieldAlert className="size-9" /></div>
            <h1 className="mt-4 text-2xl font-bold">البطاقة غير صالحة</h1>
            <p className="mt-2 max-w-sm leading-8 text-muted">
              هذا الرمز غير معروف أو أُبطل (مثلاً بعد الإبلاغ عن فقدان البطاقة). إن كانت البطاقة لك، افتح تطبيق حياة
              لعرض بطاقتك الحالية أو اطلب بطاقة جديدة.
            </p>
            <Button variant="outline" className="mt-6" asChild><Link href="/login">تسجيل الدخول</Link></Button>
          </CardBody>
        </Card>
      )}
    </PublicShell>
  );
}
