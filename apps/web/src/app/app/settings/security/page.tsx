"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { useSession } from "@/lib/session";

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="الأمان وكلمة المرور" description="احمِ حسابك: كلمة مرور قوية، ومصادقة ثنائية برمز من هاتفك." />
      <PasswordCard />
      <MfaCard />
    </div>
  );
}

function PasswordCard() {
  const { me } = useSession();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/auth/password/change", { body: { current_password: current, new_password: next } })),
    onSuccess: () => {
      setCurrent(""); setNext(""); setConfirm(""); setError(null);
      toast.success("تم تغيير كلمة المرور. سُجّل خروج أجهزتك الأخرى.");
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.length < 10;

  return (
    <Card>
      <CardHeader icon={<Lock className="size-5" />} title="تغيير كلمة المرور"
        description={me?.must_change_password ? "يجب تغيير كلمة المرور المؤقتة قبل المتابعة." : undefined} />
      <CardBody>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(null); change.mutate(); }}>
          <Field label="كلمة المرور الحالية" htmlFor="current">
            <Input id="current" type="password" autoComplete="current-password" dir="ltr" className="text-start" required
              value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="كلمة المرور الجديدة" htmlFor="new" error={tooShort ? "10 أحرف على الأقل." : undefined}
            hint="10 أحرف على الأقل. استخدم جملة يسهل تذكرها ويصعب تخمينها.">
            <Input id="new" type="password" autoComplete="new-password" dir="ltr" className="text-start" required minLength={10}
              value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={tooShort} />
          </Field>
          <Field label="تأكيد كلمة المرور الجديدة" htmlFor="confirm" error={mismatch ? "كلمتا المرور غير متطابقتين." : undefined}>
            <Input id="confirm" type="password" autoComplete="new-password" dir="ltr" className="text-start" required
              value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
          </Field>
          {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" size="lg" loading={change.isPending}
              disabled={!current || next.length < 10 || next !== confirm}>
              <KeyRound className="size-4" /> تغيير كلمة المرور
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function MfaCard() {
  const { me } = useSession();
  const queryClient = useQueryClient();
  const [setup, setSetup] = React.useState<Schemas["MfaSetup"] | null>(null);
  const [otp, setOtp] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const begin = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/auth/mfa/setup")),
    onSuccess: (data) => { setSetup(data); setError(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const enable = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/auth/mfa/enable", { body: { otp } })),
    onSuccess: (meData) => {
      queryClient.setQueryData(["me"], meData);
      setSetup(null); setOtp("");
      toast.success("فُعّلت المصادقة الثنائية.");
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const enabled = !!me?.mfa_enabled;

  return (
    <Card>
      <CardHeader icon={<ShieldCheck className="size-5" />} title="المصادقة الثنائية"
        description="عند الدخول ستُطلب منك كلمة المرور ورمز من تطبيق على هاتفك."
        action={enabled ? <Badge tone="success" dot>مفعّلة</Badge> : me?.mfa_setup_required ? <Badge tone="warning">مطلوبة</Badge> : <Badge>غير مفعّلة</Badge>} />
      <CardBody>
        {enabled ? (
          <p className="text-sm leading-7 text-muted">حسابك محمي برمز تحقق إضافي. إن فقدت هاتفك تواصل مع مدير منشأتك أو دعم حياة.</p>
        ) : !setup ? (
          <div className="space-y-4">
            <p className="text-sm leading-7 text-muted">
              ستحتاج تطبيق مصادقة مثل Google Authenticator أو Microsoft Authenticator على هاتفك.
            </p>
            <Button size="lg" loading={begin.isPending} onClick={() => begin.mutate()}>
              <Smartphone className="size-4" /> بدء التفعيل
            </Button>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); setError(null); enable.mutate(); }}>
            <ol className="space-y-5 text-sm leading-7">
              <li>
                <p className="font-medium">أولاً: امسح هذا الرمز بتطبيق المصادقة:</p>
                <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                  <div className="rounded-2xl border border-line bg-white p-3">
                    <QRCodeSVG value={setup.otpauth_uri} size={176} level="M" marginSize={0} aria-label="رمز إعداد المصادقة" />
                  </div>
                  <div className="w-full min-w-0 text-muted">
                    <p>أو أدخل هذا المفتاح يدوياً:</p>
                    <div className="mt-2 flex items-center gap-2 rounded-xl bg-sunken px-3 py-2">
                      <code className="num min-w-0 flex-1 break-all text-sm text-fg">{setup.secret}</code>
                      <Button type="button" variant="ghost" size="icon" aria-label="نسخ المفتاح"
                        onClick={() => navigator.clipboard?.writeText(setup.secret).then(() => toast.success("نُسخ المفتاح."))}>
                        <Copy className="size-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
              <li>
                <p className="font-medium">ثانياً: أدخل الرمز المكون من 6 أرقام الظاهر في التطبيق:</p>
                <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} aria-label="رمز التحقق"
                  className="num mt-2 max-w-56 text-center text-2xl tracking-[0.5em]" />
              </li>
            </ol>
            {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => { setSetup(null); setOtp(""); }}>إلغاء</Button>
              <Button type="submit" size="lg" disabled={otp.length !== 6} loading={enable.isPending}>
                <ShieldCheck className="size-4" /> تفعيل
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
