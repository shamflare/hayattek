"use client";

import { CheckCircle2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { api, ensureCsrf, errorMessage, unwrap } from "@/lib/api";
import { m } from "@/lib/i18n";

type Kind = "clinic" | "medical_center" | "hospital" | "laboratory" | "imaging_center";

export function JoinForm() {
  const [form, setForm] = React.useState({
    facility_name: "", kind: "clinic" as Kind, governorate: "raqqa", contact_name: "", phone: "",
    email: "", message: "",
  });
  const [state, setState] = React.useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      await ensureCsrf();
      await unwrap(api.POST("/api/v1/public/join-requests", {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: form as any,
      }));
      setState("done");
    } catch (err) {
      setError(errorMessage(err));
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl bg-success-soft p-10 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <p className="mt-4 text-lg font-semibold">وصل طلبك، شكراً لك</p>
        <p className="mt-1 text-sm text-muted">سنتواصل معك على الرقم الذي أدخلته قريباً.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <Field label="اسم المنشأة" className="sm:col-span-2">
        <Input required value={form.facility_name} onChange={set("facility_name")} />
      </Field>
      <Field label="نوع المنشأة">
        <Select value={form.kind} onChange={set("kind")}>
          {Object.entries(m.orgKinds).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <Field label="المحافظة">
        <Select value={form.governorate} onChange={set("governorate")}>
          {Object.entries(m.governorates).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <Field label="اسم المسؤول">
        <Input required value={form.contact_name} onChange={set("contact_name")} />
      </Field>
      <Field label="رقم الهاتف">
        <Input required inputMode="tel" dir="ltr" className="text-start" value={form.phone} onChange={set("phone")} />
      </Field>
      <Field label="البريد الإلكتروني" optional className="sm:col-span-2">
        <Input type="email" dir="ltr" className="text-start" value={form.email} onChange={set("email")} />
      </Field>
      <Field label="ملاحظات" optional className="sm:col-span-2">
        <Textarea value={form.message} onChange={set("message")} placeholder="عدد الأطباء، الاختصاصات، أفضل وقت للتواصل…" />
      </Field>
      {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger sm:col-span-2">{error}</p>}
      <Button type="submit" size="lg" loading={state === "sending"} className="sm:col-span-2">إرسال الطلب</Button>
    </form>
  );
}
