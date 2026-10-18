"use client";

import { CheckCircle2, Eye, EyeOff, KeyRound, LinkIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, ensureCsrf, errorMessage, unwrap } from "@/lib/api";

function ResetForm() {
  const params = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  if (!uid || !token) {
    return (
      <div>
        <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-danger-soft text-danger"><LinkIcon className="size-7" /></div>
        <h1 className="text-2xl font-bold">الرابط غير مكتمل</h1>
        <p className="mt-3 leading-8 text-muted">افتح الرابط كما وصلك في الرسالة تماماً، أو اطلب رابطاً جديداً.</p>
        <Button size="lg" className="mt-8 w-full" asChild><Link href="/forgot-password">طلب رابط جديد</Link></Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="animate-fade-up">
        <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-success-soft text-success"><CheckCircle2 className="size-7" /></div>
        <h1 className="text-2xl font-bold">تم حفظ كلمة المرور</h1>
        <p className="mt-3 leading-8 text-muted">يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.</p>
        <Button size="lg" className="mt-8 w-full" asChild><Link href="/login">تسجيل الدخول</Link></Button>
      </div>
    );
  }

  const mismatch = confirm.length > 0 && confirm !== password;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await ensureCsrf();
      await unwrap(api.POST("/api/v1/auth/password/reset/confirm", { body: { uid, token, new_password: password } }));
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Also the landing page of staff invitations: there it sets the first password. */}
      <h1 className="text-2xl font-bold">تعيين كلمة المرور</h1>
      <p className="mt-1.5 leading-7 text-muted">
        اختر كلمة مرور جديدة لحسابك. إن وصلتك دعوة للانضمام إلى منشأة، فهذه كلمة مرورك الأولى.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-5">
        <Field label="كلمة المرور الجديدة" htmlFor="password" hint="10 أحرف على الأقل. جملة سهلة التذكر صعبة التخمين خيار جيد.">
          <div className="relative">
            <Input id="password" type={show ? "text" : "password"} autoComplete="new-password" required minLength={10}
              value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" className="pe-11 text-start" autoFocus />
            <button type="button" onClick={() => setShow((s) => !s)}
              className="absolute inset-y-0 end-0 grid w-11 place-items-center text-subtle hover:text-fg"
              aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        <Field label="تأكيد كلمة المرور" htmlFor="confirm" error={mismatch ? "كلمتا المرور غير متطابقتين." : undefined}>
          <Input id="confirm" type={show ? "text" : "password"} autoComplete="new-password" required
            value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" className="text-start" aria-invalid={mismatch} />
        </Field>
        {error && (
          <div className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
            {error}{" "}
            <Link href="/forgot-password" className="font-semibold underline">طلب رابط جديد</Link>
          </div>
        )}
        <Button type="submit" size="lg" className="w-full" loading={loading}
          disabled={password.length < 10 || password !== confirm}>
          <KeyRound className="size-4" /> حفظ كلمة المرور
        </Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense>
      <ResetForm />
    </React.Suspense>
  );
}
