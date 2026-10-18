"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, IdCard, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { PatientRow } from "@/components/clinical/patient-row";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceChips, Field, Input, Select } from "@/components/ui/field";
import { Card, CardBody } from "@/components/ui/surface";
import { api, errorMessage, isApiError, type Schemas, unwrap } from "@/lib/api";
import { m } from "@/lib/i18n";

type Form = {
  first_name: string; father_name: string; grandfather_name: string; family_name: string;
  mother_name: string; full_name_en: string; sex: "male" | "female" | "unknown";
  birth_mode: "exact" | "year" | "estimated"; birth_date: string; birth_year: string; age: string;
  phone: string; governorate: string; city: string; address: string;
  emergency_contact_name: string; emergency_contact_phone: string; emergency_contact_relation: string;
};

const empty: Form = {
  first_name: "", father_name: "", grandfather_name: "", family_name: "", mother_name: "",
  full_name_en: "", sex: "unknown", birth_mode: "exact", birth_date: "", birth_year: "", age: "",
  phone: "", governorate: "raqqa", city: "", address: "", emergency_contact_name: "",
  emergency_contact_phone: "", emergency_contact_relation: "",
};

function toPayload(f: Form, acknowledge: boolean) {
  let birth_date: string | null = null;
  if (f.birth_mode === "exact" && f.birth_date) birth_date = f.birth_date;
  if (f.birth_mode === "year" && f.birth_year) birth_date = `${f.birth_year}-07-01`;
  if (f.birth_mode === "estimated" && f.age) birth_date = `${new Date().getFullYear() - Number(f.age)}-07-01`;
  return {
    first_name: f.first_name.trim(), father_name: f.father_name.trim(),
    grandfather_name: f.grandfather_name.trim(), family_name: f.family_name.trim(),
    mother_name: f.mother_name.trim(), full_name_en: f.full_name_en.trim(), sex: f.sex,
    birth_date, birth_date_precision: f.birth_mode, phone: f.phone, governorate: f.governorate,
    city: f.city, address: f.address, emergency_contact_name: f.emergency_contact_name,
    emergency_contact_phone: f.emergency_contact_phone,
    emergency_contact_relation: f.emergency_contact_relation,
    acknowledge_duplicates: acknowledge,
  };
}

export default function NewPatientPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = React.useState<Form>(empty);
  const [more, setMore] = React.useState(false);
  const [dupes, setDupes] = React.useState<{ candidates: Schemas["PatientList"][]; hint: boolean } | null>(null);
  const set = <K extends keyof Form>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: (acknowledge: boolean) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unwrap(api.POST("/api/v1/patients", { body: toPayload(form, acknowledge) as any })),
    onSuccess: (patient) => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      toast.success("تم إنشاء الملف وإصدار البطاقة الصحية");
      router.push(`/app/patients/${patient.id}?created=1`);
    },
    onError: (err) => {
      if (isApiError(err) && err.code === "possible_duplicate") {
        setDupes({
          candidates: (err.body.candidates as Schemas["PatientList"][]) ?? [],
          hint: Boolean(err.body.network_match_hint),
        });
      } else {
        toast.error(errorMessage(err));
      }
    },
  });

  return (
    <div className="mx-auto max-w-3xl animate-fade-up">
      <PageHeader back="/app/patients" title="تسجيل مريض جديد"
        description="المطلوب فقط الاسم الأول. أكمل ما يتوفر — يمكن التعديل لاحقاً." />
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(false); }}>
        <Card>
          <CardBody className="space-y-6">
            <div>
              <h2 className="mb-3 font-semibold">الاسم</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="الاسم الأول"><Input required autoFocus value={form.first_name} onChange={set("first_name")} /></Field>
                <Field label="اسم الأب" optional><Input value={form.father_name} onChange={set("father_name")} /></Field>
                <Field label="اسم الجد" optional><Input value={form.grandfather_name} onChange={set("grandfather_name")} /></Field>
                <Field label="الكنية / العائلة" optional><Input value={form.family_name} onChange={set("family_name")} /></Field>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="الجنس">
                <ChoiceChips value={form.sex} onChange={(v) => setForm((f) => ({ ...f, sex: v as Form["sex"] }))}
                  options={[{ value: "male", label: "ذكر" }, { value: "female", label: "أنثى" }, { value: "unknown", label: "غير محدد" }]} />
              </Field>
              <Field label="رقم الهاتف" optional hint="ليس إلزامياً. يُستخدم لرموز الموافقة.">
                <Input inputMode="tel" dir="ltr" className="num text-start" placeholder="09xx xxx xxx" value={form.phone} onChange={set("phone")} />
              </Field>
            </div>

            <div>
              <h2 className="mb-3 font-semibold">العمر</h2>
              <ChoiceChips value={form.birth_mode} onChange={(v) => setForm((f) => ({ ...f, birth_mode: v as Form["birth_mode"] }))}
                options={[{ value: "exact", label: "تاريخ الميلاد معروف" }, { value: "year", label: "السنة فقط" }, { value: "estimated", label: "عمر تقريبي" }]} />
              <div className="mt-3 max-w-xs">
                {form.birth_mode === "exact" && <Input type="date" value={form.birth_date} onChange={set("birth_date")} max={new Date().toISOString().slice(0, 10)} />}
                {form.birth_mode === "year" && <Input inputMode="numeric" placeholder="مثال: 1975" className="num" value={form.birth_year} onChange={set("birth_year")} />}
                {form.birth_mode === "estimated" && <Input inputMode="numeric" placeholder="العمر بالسنوات" className="num" value={form.age} onChange={set("age")} />}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="المحافظة">
                <Select value={form.governorate} onChange={set("governorate")}>
                  {Object.entries(m.governorates).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
              <Field label="المدينة / الحي" optional><Input value={form.city} onChange={set("city")} /></Field>
            </div>

            <button type="button" onClick={() => setMore((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-brand-600">
              <ChevronDown className={`size-4 transition-transform ${more ? "rotate-180" : ""}`} />
              {more ? "إخفاء المعلومات الإضافية" : "معلومات إضافية (اسم الأم، الاسم بالإنجليزية، العنوان، الطوارئ)"}
            </button>
            {more && (
              <div className="grid animate-fade-up gap-4 sm:grid-cols-2">
                <Field label="اسم الأم" optional><Input value={form.mother_name} onChange={set("mother_name")} /></Field>
                <Field label="الاسم بالإنجليزية" optional><Input dir="ltr" className="text-start" value={form.full_name_en} onChange={set("full_name_en")} /></Field>
                <Field label="العنوان" optional className="sm:col-span-2"><Input value={form.address} onChange={set("address")} /></Field>
                <Field label="جهة اتصال للطوارئ" optional><Input value={form.emergency_contact_name} onChange={set("emergency_contact_name")} /></Field>
                <Field label="صلة القرابة" optional><Input value={form.emergency_contact_relation} onChange={set("emergency_contact_relation")} /></Field>
                <Field label="هاتف الطوارئ" optional><Input dir="ltr" className="num text-start" value={form.emergency_contact_phone} onChange={set("emergency_contact_phone")} /></Field>
              </div>
            )}
          </CardBody>
          <div className="flex flex-col-reverse gap-3 border-t border-line bg-sunken/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-muted"><IdCard className="size-4 text-brand-600" /> سيُصدر رقم صحي وبطاقة QR تلقائياً.</p>
            <Button type="submit" size="lg" loading={create.isPending}><UserPlus className="size-4" /> إنشاء الملف</Button>
          </div>
        </Card>
      </form>

      <Dialog open={!!dupes} onOpenChange={(o) => !o && setDupes(null)}>
        <DialogContent title="هل المريض مسجل مسبقاً؟" description="وجدنا ملفات مشابهة. تكرار الملفات يشتت التاريخ الطبي للمريض."
          footer={<>
            <Button variant="ghost" onClick={() => setDupes(null)}>رجوع للتعديل</Button>
            <Button variant="outline" loading={create.isPending} onClick={() => { setDupes(null); create.mutate(true); }}>
              ليس أحدهم — أنشئ ملفاً جديداً
            </Button>
          </>}>
          {!!dupes?.candidates.length && (
            <div className="-mx-2 divide-y divide-line">
              {dupes.candidates.map((p) => <PatientRow key={p.id} patient={p} />)}
            </div>
          )}
          {dupes?.hint && (
            <div className="mt-3 flex gap-3 rounded-2xl bg-warning-soft p-4 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div>
                يوجد في الشبكة ملف بنفس رقم الهاتف وسنة الميلاد في منشأة أخرى. اطلب من المريض بطاقته أو رقمه الصحي وسجّله من{" "}
                <Link href="/app/scan" className="font-semibold underline">صفحة المسح</Link> بدلاً من إنشاء ملف جديد.
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
