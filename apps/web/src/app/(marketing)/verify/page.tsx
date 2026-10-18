"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

export default function VerifyEntryPage() {
  const router = useRouter();
  const [code, setCode] = React.useState("");
  return (
    <main className="mx-auto max-w-lg px-4 py-20 text-center sm:px-6">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
        <ShieldCheck className="size-7" />
      </div>
      <h1 className="mt-5 text-3xl font-bold">التحقق من وصفة</h1>
      <p className="mt-3 leading-7 text-muted">
        أدخل رمز التحقق المطبوع أسفل الوصفة، أو امسح رمز QR الموجود عليها. لن تظهر الأدوية أو بيانات المريض.
      </p>
      <form
        className="mt-8 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) router.push(`/verify/${encodeURIComponent(code.trim().toUpperCase())}`);
        }}
      >
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="مثال: 7KQ3PX9MAB"
          dir="ltr" className="num text-center tracking-widest" />
        <Button type="submit" size="lg">تحقق</Button>
      </form>
    </main>
  );
}
