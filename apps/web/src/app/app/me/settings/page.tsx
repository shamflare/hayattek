"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Phone, Plus, Save, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { useActivePatient } from "@/components/patient/active-patient";
import { asList, portalKeys } from "@/components/patient/portal";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ChoiceChips, Field, Input, Textarea } from "@/components/ui/field";
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton, SkeletonList } from "@/components/ui/surface";
import { errorMessage, patientApi, type Schemas, unwrap } from "@/lib/api";
import { formatDate, formatPhone, sexLabel } from "@/lib/format";
import { label, m } from "@/lib/i18n";

type Contact = Schemas["PatchedPatientSelfUpdateRequest"];
type ReportedKind = Schemas["PatientReportedInfoKindEnum"];

export default function PatientSettingsPage() {
  const { active } = useActivePatient();
  const patientId = active!.id;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="معلوماتي" description="بيانات التواصل، والمعلومات الصحية التي تريد أن يعرفها أطباؤك."
        actions={<Button variant="outline" asChild><Link href="/app/settings/security"><Lock className="size-4" /> كلمة المرور والأمان</Link></Button>} />
      <ContactSection patientId={patientId} />
      <ReportedSection patientId={patientId} />
    </div>
  );
}

// ------------------------------------------------------------------ contact

const contactFields: (keyof Contact)[] = [
  "phone", "city", "address", "full_name_en", "emergency_contact_name", "emergency_contact_phone",
  "emergency_contact_relation",
];

function pickContact(profile: Schemas["PatientDetail"]): Contact {
  const out: Contact = {};
  for (const f of contactFields) out[f] = (profile[f] as string | undefined) ?? "";
  return out;
}

function ContactSection({ patientId }: { patientId: string }) {
  const profile = useQuery({
    queryKey: portalKeys.profile(patientId),
    queryFn: () => unwrap(patientApi.GET("/api/v1/me/patients/{id}", { params: { path: { id: patientId } } })),
  });

  return (
    <Card>
      <CardHeader icon={<UserRound className="size-5" />} title="بيانات التواصل"
        description="الاسم وتاريخ الميلاد تعدّلهما المنشأة الطبية فقط بعد التحقق من الهوية." />
      <CardBody>
        {profile.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-2/3" /></div>
        ) : profile.isError ? (
          <ErrorState message={errorMessage(profile.error)} onRetry={() => profile.refetch()} />
        ) : (
          // Re-mount (fresh form state) whenever the server copy changes.
          <ContactForm key={profile.dataUpdatedAt} patientId={patientId} profile={profile.data!} />
        )}
      </CardBody>
    </Card>
  );
}

function ContactForm({ patientId, profile }: { patientId: string; profile: Schemas["PatientDetail"] }) {
  const queryClient = useQueryClient();
  const initial = React.useMemo(() => pickContact(profile), [profile]);
  const [form, setForm] = React.useState<Contact>(initial);

  const save = useMutation({
    mutationFn: () => {
      const changed: Contact = {};
      for (const f of contactFields) {
        if ((form[f] ?? "") !== (initial[f] ?? "")) changed[f] = (form[f] ?? "").trim();
      }
      return unwrap(patientApi.PATCH("/api/v1/me/patients/{id}", { params: { path: { id: patientId } }, body: changed }));
    },
    onSuccess: (data) => {
      queryClient.setQueryData(portalKeys.profile(patientId), data);
      toast.success("حُفظت بياناتك.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const set = (f: keyof Contact) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((cur) => ({ ...cur, [f]: e.target.value }));
  const dirty = contactFields.some((f) => (form[f] ?? "") !== (initial[f] ?? ""));

  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <dl className="grid gap-3 rounded-2xl bg-sunken p-4 text-sm sm:grid-cols-3">
        <div><dt className="text-muted">الاسم</dt><dd className="font-medium">{profile.full_name}</dd></div>
        <div><dt className="text-muted">الجنس</dt><dd className="font-medium">{sexLabel(profile.sex)}</dd></div>
        <div><dt className="text-muted">تاريخ الميلاد</dt><dd className="font-medium">{profile.birth_date ? formatDate(profile.birth_date) : "—"}</dd></div>
      </dl>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="رقم الهاتف" htmlFor="phone" hint={profile.phone ? <>الحالي: <span className="num">{formatPhone(profile.phone)}</span></> : undefined}>
          <Input id="phone" type="tel" inputMode="tel" dir="ltr" className="num text-start" value={form.phone ?? ""} onChange={set("phone")} placeholder="09xxxxxxxx" />
        </Field>
        <Field label="المدينة" htmlFor="city"><Input id="city" value={form.city ?? ""} onChange={set("city")} /></Field>
        <Field label="العنوان" htmlFor="address" className="sm:col-span-2"><Textarea id="address" rows={2} value={form.address ?? ""} onChange={set("address")} /></Field>
        <Field label="الاسم بالإنكليزية" optional htmlFor="name-en" hint="يفيد في التقارير الطبية الأجنبية.">
          <Input id="name-en" dir="ltr" className="text-start" value={form.full_name_en ?? ""} onChange={set("full_name_en")} />
        </Field>
      </div>
      <fieldset className="space-y-4 rounded-2xl border border-line p-4">
        <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold"><Phone className="size-4 text-accent" /> شخص نتصل به في الطوارئ</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="الاسم" htmlFor="ec-name"><Input id="ec-name" value={form.emergency_contact_name ?? ""} onChange={set("emergency_contact_name")} /></Field>
          <Field label="الهاتف" htmlFor="ec-phone">
            <Input id="ec-phone" type="tel" dir="ltr" className="num text-start" value={form.emergency_contact_phone ?? ""} onChange={set("emergency_contact_phone")} />
          </Field>
          <Field label="صلة القرابة" htmlFor="ec-rel"><Input id="ec-rel" value={form.emergency_contact_relation ?? ""} onChange={set("emergency_contact_relation")} placeholder="ابن، زوجة…" /></Field>
        </div>
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={!dirty} loading={save.isPending}><Save className="size-4" /> حفظ التغييرات</Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ self-reported

const kindHints: Record<ReportedKind, string> = {
  allergy: "مثال: حساسية من البنسلين — طفح جلدي",
  condition: "مثال: سكري منذ 2015",
  medication: "مثال: ميتفورمين 500 ملغ مرتين يومياً",
  surgery: "مثال: استئصال الزائدة 2018",
  other: "أي معلومة صحية تريد أن يعرفها طبيبك",
};

function ReportedSection({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = React.useState<ReportedKind>("allergy");
  const [text, setText] = React.useState("");
  const [removing, setRemoving] = React.useState<Schemas["PatientReportedInfo"] | null>(null);

  const list = useQuery({
    queryKey: portalKeys.reported(patientId),
    queryFn: () => unwrap(patientApi.GET("/api/v1/me/patients/{id}/reported", { params: { path: { id: patientId } } })),
  });
  const items = asList(list.data);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: portalKeys.reported(patientId) });
  };
  const add = useMutation({
    mutationFn: () => unwrap(patientApi.POST("/api/v1/me/patients/{id}/reported", {
      params: { path: { id: patientId } }, body: { kind, text: text.trim() },
    })),
    onSuccess: () => { setText(""); refresh(); toast.success("أُضيفت المعلومة."); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (item: string) => unwrap(patientApi.POST("/api/v1/me/patients/{id}/reported/remove", {
      params: { path: { id: patientId }, query: { item } },
    })),
    onSuccess: () => { setRemoving(null); refresh(); toast.success("حُذفت المعلومة."); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const kinds = Object.keys(m.reportedKinds) as ReportedKind[];

  return (
    <Card className="border-dashed border-accent/50">
      <CardHeader icon={<UserRound className="size-5" />} title="معلومات صرّحت بها بنفسك"
        description="لا تحل محل التشخيص الطبي. تظهر لأطبائك موسومة بأنها من المريض، لتساعدهم على السؤال والتحقق." />
      <CardBody className="space-y-5">
        <form className="space-y-3 rounded-2xl bg-sunken/60 p-4" onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); }}>
          <ChoiceChips options={kinds.map((k) => ({ value: k, label: label("reportedKinds", k) }))}
            value={kind} onChange={(v) => setKind(v as ReportedKind)} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={300}
              placeholder={kindHints[kind]} aria-label="نص المعلومة" className="flex-1" />
            <Button type="submit" size="lg" disabled={!text.trim()} loading={add.isPending}><Plus className="size-4" /> إضافة</Button>
          </div>
        </form>

        {list.isLoading ? (
          <SkeletonList rows={2} />
        ) : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState className="py-6" title="لم تضف أي معلومة بعد"
            description="أضف حساسياتك وأمراضك المزمنة والأدوية التي تتناولها، فهي مهمة جداً في الحالات الإسعافية." />
        ) : (
          kinds.filter((k) => items.some((i) => i.kind === k)).map((k) => (
            <div key={k}>
              <h3 className="mb-2 text-sm font-semibold text-muted">{label("reportedKinds", k)}</h3>
              <ul className="space-y-2">
                {items.filter((i) => i.kind === k).map((i) => (
                  <li key={i.id} className="flex items-center gap-3 rounded-xl border border-line bg-elevated px-3 py-2.5">
                    <span className="min-w-0 flex-1 text-[15px] leading-7"><bdi>{i.text}</bdi></span>
                    <span className="hidden text-xs text-subtle sm:inline">{formatDate(i.created_at)}</span>
                    <Button variant="danger-ghost" size="icon" aria-label="حذف" onClick={() => setRemoving(i)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </CardBody>
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} tone="danger"
        title="حذف هذه المعلومة؟" confirmLabel="حذف" loading={remove.isPending}
        description={removing ? <bdi>{removing.text}</bdi> : undefined}
        onConfirm={() => removing && remove.mutate(removing.id)} />
    </Card>
  );
}
