"use client";

import { useMutation } from "@tanstack/react-query";
import { Camera, CameraOff, CheckCircle2, FolderOpen, Keyboard, Lock, ScanLine, UserPlus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { AccessDialog } from "@/components/clinical/access-panel";
import { rememberPresented } from "@/components/clinical/queries";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Avatar, Badge, Card } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { ageLabel, sexLabel } from "@/lib/format";
import { label } from "@/lib/i18n";
import { useSession } from "@/lib/session";

type Identified = Schemas["IdentifiedPatient"];

/** Accepts a full card URL (https://hayattek.com/c/<token>) or a bare token. */
function tokenFromScan(text: string): string | null {
  const match = text.match(/\/c\/([A-Za-z0-9_-]{10,60})/);
  if (match) return match[1];
  return /^[A-Za-z0-9_-]{16,60}$/.test(text.trim()) ? text.trim() : null;
}

function ScanInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { isClinician, has } = useSession();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [cameraOn, setCameraOn] = React.useState(false);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const [number, setNumber] = React.useState("");
  const [result, setResult] = React.useState<{ data: Identified; presented: { card_token?: string; health_number?: string } } | null>(null);
  const [accessOpen, setAccessOpen] = React.useState(false);

  const identify = useMutation({
    mutationFn: (presented: { card_token?: string; health_number?: string }) =>
      unwrap(api.POST("/api/v1/patients/identify", { body: presented })).then((data) => ({ data, presented })),
    onSuccess: (r) => {
      rememberPresented(r.data.patient.id, r.presented);
      setResult(r);
      setCameraOn(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const register = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/patients/register", { body: result!.presented })),
    onSuccess: (d) => { toast.success("تم تسجيل المريض في منشأتك"); router.push(`/app/patients/${d.patient.id}`); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Token arriving from the public /c/<token> page.
  React.useEffect(() => {
    const token = params.get("token");
    if (token) identify.mutate({ card_token: token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!cameraOn || !videoRef.current) return;
    let scanner: { start: () => Promise<void>; stop: () => void; destroy: () => void } | null = null;
    let handled = false;
    (async () => {
      try {
        const QrScanner = (await import("qr-scanner")).default;
        scanner = new QrScanner(videoRef.current!, (res: { data: string }) => {
          const token = tokenFromScan(res.data);
          if (token && !handled) {
            handled = true;
            identify.mutate({ card_token: token });
          }
        }, { highlightScanRegion: true, highlightCodeOutline: true, preferredCamera: "environment", returnDetailedScanResult: true });
        await scanner.start();
      } catch {
        setCameraError("تعذر تشغيل الكاميرا. اسمح للمتصفح باستخدامها أو أدخل الرقم الصحي يدوياً.");
        setCameraOn(false);
      }
    })();
    return () => { scanner?.stop(); scanner?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn]);

  const access = result?.data.access;
  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <PageHeader title="مسح البطاقة الصحية" description="مسح البطاقة أو إدخال الرقم يحدد هوية المريض فقط ويُسجّل في سجل التدقيق." />

      {!result && (
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <div className="relative aspect-[4/3] bg-fg/90">
              <video ref={videoRef} className={cameraOn ? "h-full w-full object-cover" : "hidden"} muted playsInline />
              {!cameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white">
                  <div className="grid size-20 place-items-center rounded-3xl border-2 border-dashed border-white/40"><ScanLine className="size-10" /></div>
                  <p className="max-w-xs text-sm text-white/75">وجّه كاميرا الجهاز نحو رمز QR على بطاقة المريض.</p>
                  <Button size="lg" onClick={() => { setCameraError(null); setCameraOn(true); }} className="bg-white text-brand-800 hover:bg-brand-50">
                    <Camera className="size-5" /> تشغيل الكاميرا
                  </Button>
                </div>
              )}
            </div>
            {cameraOn && (
              <div className="flex justify-center p-3"><Button variant="ghost" onClick={() => setCameraOn(false)}><CameraOff className="size-4" /> إيقاف الكاميرا</Button></div>
            )}
          </Card>
          {cameraError && <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">{cameraError}</p>}

          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2 font-semibold"><Keyboard className="size-5 text-brand-600" /> أو أدخل الرقم الصحي</div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (number.trim()) identify.mutate({ health_number: number }); }}>
              <Input value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" dir="ltr"
                className="num h-12 text-center text-lg tracking-widest" placeholder="0000 0000 00" />
              <Button type="submit" size="lg" loading={identify.isPending}>بحث</Button>
            </form>
            <p className="mt-2 text-xs text-subtle">الرقم المكون من 10 أرقام المطبوع على البطاقة. يحتوي رقم تحقق يكشف أخطاء الإدخال.</p>
          </Card>
        </div>
      )}

      {result && access && (
        <Card className="animate-fade-up p-6">
          <div className="flex items-center gap-4">
            <Avatar name={result.data.patient.full_name} className="size-16 text-lg" />
            <div>
              <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" /> تم التعرف على المريض</div>
              <div className="text-xl font-bold">{result.data.patient.full_name}</div>
              <div className="text-sm text-muted">
                {sexLabel(result.data.patient.sex)} · {ageLabel(result.data.patient.age_years, result.data.patient.birth_date_precision)} · <span className="num">{result.data.patient.health_number}</span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {access.registered ? <Badge tone="brand">مسجل في منشأتك</Badge> : <Badge>غير مسجل في منشأتك</Badge>}
            {access.network_scopes.length > 0 && <Badge tone="success">وصول بموافقة: {access.network_scopes.map((s) => label("scopes", s)).join("، ")}</Badge>}
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            {(access.registered || access.can_view_clinical) && (
              <Button size="lg" onClick={() => router.push(`/app/patients/${result.data.patient.id}`)}><FolderOpen className="size-5" /> فتح الملف</Button>
            )}
            {!access.registered && has("receptionist", "physician", "nurse", "lab_staff", "imaging_staff") && (
              <Button size="lg" variant={access.can_view_clinical ? "outline" : "primary"} loading={register.isPending} onClick={() => register.mutate()}>
                <UserPlus className="size-5" /> تسجيله في منشأتي
              </Button>
            )}
            {isClinician && (
              <Button size="lg" variant="secondary" onClick={() => setAccessOpen(true)}><Lock className="size-5" /> طلب موافقته على الاطلاع</Button>
            )}
          </div>
          <Button variant="ghost" className="mt-3 w-full" onClick={() => { setResult(null); setNumber(""); }}>مسح بطاقة أخرى</Button>
          <AccessDialog open={accessOpen} onOpenChange={(o) => { setAccessOpen(o); if (!o) identify.mutate(result.presented); }}
            patientId={result.data.patient.id} hasPhone={Boolean(result.data.patient.phone)} hasAccount />
        </Card>
      )}
    </div>
  );
}

export default function ScanPage() {
  return <React.Suspense><ScanInner /></React.Suspense>;
}
