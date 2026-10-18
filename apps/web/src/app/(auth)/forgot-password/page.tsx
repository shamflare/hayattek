"use client";

import { ArrowRight, Building2, MailCheck, Send } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { api, ensureCsrf, errorMessage, isApiError, unwrap } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await ensureCsrf();
      await unwrap(api.POST("/api/v1/auth/password/reset", { body: { identifier: identifier.trim() } }));
      setSent(true);
    } catch (err) {
      // The answer is the same whether or not the account exists; only show transport/rate errors.
      setError(isApiError(err) && err.status === 429
        ? "محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة."
        : errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="animate-fade-up">
        <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600"><MailCheck className="size-7" /></div>
        <h1 className="text-2xl font-bold">تحقق من بريدك</h1>
        <p className="mt-3 leading-8 text-muted">
          إن كان هناك حساب مرتبط بهذه البيانات وله بريد إلكتروني، فسيصله رابط لتعيين كلمة مرور جديدة خلال دقائق.
          الرابط صالح لمدة 30 دقيقة ولمرة واحدة.
        </p>
        <p className="mt-3 text-sm leading-7 text-muted">لم يصلك شيء؟ تحقق من مجلد الرسائل غير المرغوب فيها.</p>
        <Button variant="outline" size="lg" className="mt-8 w-full" asChild>
          <Link href="/login"><ArrowRight className="size-4" /> العودة لتسجيل الدخول</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold">نسيت كلمة المرور؟</h1>
      <p className="mt-1.5 text-muted">أدخل بريدك الإلكتروني أو رقم هاتفك وسنرسل لك رابطاً لتعيين كلمة مرور جديدة.</p>
      <form onSubmit={submit} className="mt-8 space-y-5">
        <Field label="البريد الإلكتروني أو رقم الهاتف" htmlFor="identifier">
          <Input id="identifier" autoComplete="username" required value={identifier} autoFocus
            onChange={(e) => setIdentifier(e.target.value)} dir="ltr" className="text-start"
            placeholder="name@example.com · 09xxxxxxxx" />
        </Field>
        {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={loading} disabled={!identifier.trim()}>
          <Send className="size-4" /> إرسال الرابط
        </Button>
      </form>
      <div className="mt-6 flex items-start gap-3 rounded-2xl bg-sunken p-4 text-sm leading-7 text-muted">
        <Building2 className="mt-1 size-4 shrink-0 text-brand-600" />
        <p>
          ليس لديك بريد إلكتروني في حسابك؟ راجع استقبال العيادة أو المركز الطبي الذي سجّلك ومعك هويتك، وسيساعدونك
          في إعادة تعيين كلمة المرور.
        </p>
      </div>
      <p className="mt-8 text-center text-sm">
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">العودة لتسجيل الدخول</Link>
      </p>
    </>
  );
}
