"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, ensureCsrf, errorMessage, getActiveMembership, isApiError, unwrap } from "@/lib/api";
import { homeForUser } from "@/lib/session";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [otp, setOtp] = React.useState("");
  const [needsOtp, setNeedsOtp] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await ensureCsrf();
      const me = await unwrap(
        api.POST("/api/v1/auth/login", { body: { identifier, password, otp: otp || undefined } }),
      );
      queryClient.setQueryData(["me"], me);
      const next = params.get("next");
      router.replace(next && next.startsWith("/app") ? next : homeForUser(me, getActiveMembership()));
    } catch (err) {
      if (isApiError(err) && err.code === "mfa_required") {
        setNeedsOtp(true);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {!needsOtp ? (
        <>
          <Field label="البريد الإلكتروني أو رقم الهاتف" htmlFor="identifier">
            <Input id="identifier" autoComplete="username" required value={identifier}
              onChange={(e) => setIdentifier(e.target.value)} placeholder="name@clinic.com · 09xxxxxxxx"
              dir="ltr" className="text-start" autoFocus />
          </Field>
          <Field label={
            <span className="flex w-full items-center justify-between">
              كلمة المرور
              <Link href="/forgot-password" className="text-xs font-normal text-brand-600 hover:underline">نسيت كلمة المرور؟</Link>
            </span>
          } htmlFor="password">
            <div className="relative">
              <Input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password"
                required value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" className="pe-11 text-start" />
              <button type="button" onClick={() => setShowPassword((s) => !s)}
                className="absolute inset-y-0 end-0 grid w-11 place-items-center text-subtle hover:text-fg"
                aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}>
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
        </>
      ) : (
        <div className="animate-fade-up space-y-4">
          <div className="flex items-start gap-3 rounded-2xl bg-brand-50 p-4 text-sm text-brand-800 dark:text-brand-200">
            <ShieldCheck className="mt-0.5 size-5 shrink-0" />
            أدخل الرمز المكون من 6 أرقام من تطبيق المصادقة على هاتفك.
          </div>
          <Field label="رمز التحقق" htmlFor="otp">
            <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="num text-center text-2xl tracking-[0.5em]" />
          </Field>
        </div>
      )}
      {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" size="lg" className="w-full" loading={loading}>
        {needsOtp ? <><KeyRound className="size-4" /> تحقق ودخول</> : <><Lock className="size-4" /> تسجيل الدخول</>}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">أهلاً بعودتك</h1>
      <p className="mt-1.5 text-muted">سجّل الدخول إلى حسابك في منصة حياة.</p>
      <div className="mt-8">
        <React.Suspense>
          <LoginForm />
        </React.Suspense>
      </div>
      <p className="mt-8 text-center text-sm text-muted">
        منشأة طبية وتريد الانضمام؟{" "}
        <Link href="/providers" className="font-semibold text-brand-600 hover:underline">تعرّف على حياة للأطباء</Link>
      </p>
    </>
  );
}
