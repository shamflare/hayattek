"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, EyeOff, Layers, Lock, Plus, Printer, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { OrgStatusBadge } from "@/components/admin/common";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { LogoMark } from "@/components/ui/logo";
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton, SkeletonList } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { formatDate, formatPhone } from "@/lib/format";
import { label, m } from "@/lib/i18n";
import { useSession } from "@/lib/session";

type Profile = Schemas["OrgSelf"];
type Form = {
  name: string; name_en: string; governorate: Schemas["GovernorateEnum"]; city: string;
  address: string; phone: string; email: string; print_footer: string;
};

function toForm(p: Profile): Form {
  return {
    name: p.name, name_en: p.name_en ?? "", governorate: p.governorate ?? "raqqa", city: p.city ?? "",
    address: p.address ?? "", phone: p.phone ?? "", email: p.email ?? "", print_footer: p.print_footer ?? "",
  };
}

export default function OrgProfilePage() {
  const { has, membership } = useSession();
  const queryClient = useQueryClient();
  const isAdmin = has("org_admin");

  const profile = useQuery({
    queryKey: ["org", "profile", membership?.id],
    queryFn: () => unwrap(api.GET("/api/v1/org/profile")),
    enabled: isAdmin,
  });
  const save = useMutation({
    mutationFn: (body: Form) => unwrap(api.PATCH("/api/v1/org/profile", { body })),
    onSuccess: (data) => {
      toast.success("حُفظت بيانات المنشأة");
      queryClient.setQueryData(["org", "profile", membership?.id], data);
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="بيانات المنشأة" />
        <Card><EmptyState icon={<Lock className="size-6" />} title="هذه الصفحة لمدير المنشأة" /></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="مدير المنشأة"
        title="بيانات المنشأة"
        description="الهوية التي تظهر على الوصفات والتقارير المطبوعة، وأقسام المنشأة."
      />

      <div className="mb-6 flex items-start gap-3 rounded-card border border-line bg-sunken/60 p-4 text-sm text-muted">
        <EyeOff className="mt-0.5 size-4 shrink-0 text-brand-600" />
        <p>
          صلاحية مدير المنشأة إدارية فقط: <b className="text-fg">لا تتيح الاطلاع على سجلات المرضى</b> ولا على محتوى الوصفات أو التحاليل.
          كل تعديل هنا يُسجل في السجل الأمني.
        </p>
      </div>

      {profile.error ? (
        <ErrorState message={errorMessage(profile.error)} onRetry={() => profile.refetch()} />
      ) : !profile.data ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <Card className="p-5"><SkeletonList rows={5} /></Card>
          <Skeleton className="h-96 rounded-card" />
        </div>
      ) : (
        <ProfileEditor key={profile.data.id} profile={profile.data} saving={save.isPending} onSave={(f) => save.mutate(f)} />
      )}
    </>
  );
}

function ProfileEditor({ profile: p, saving, onSave }: { profile: Profile; saving: boolean; onSave: (f: Form) => void }) {
  const [form, setForm] = React.useState<Form>(() => toForm(p));
  const dirty = JSON.stringify(toForm(p)) !== JSON.stringify(form);
  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <Card>
              <CardHeader title="الهوية والتواصل" icon={<Building2 className="size-[18px]" />}
                action={p && <OrgStatusBadge status={p.status} />} />
              <CardBody>
                {(
                  <form id="profile-form" className="grid gap-4 sm:grid-cols-2"
                    onSubmit={(e) => { e.preventDefault(); if (!form.name.trim()) return toast.error("أدخل اسم المنشأة."); onSave(form); }}>
                    <Field label="اسم المنشأة" htmlFor="pf-name" className="sm:col-span-2">
                      <Input id="pf-name" value={form.name} onChange={set("name")} />
                    </Field>
                    <Field label="الاسم بالإنجليزية" optional htmlFor="pf-en">
                      <Input id="pf-en" dir="ltr" value={form.name_en} onChange={set("name_en")} />
                    </Field>
                    <Field label="النوع">
                      <Input value={label("orgKinds", p.kind)} disabled />
                    </Field>
                    <Field label="المحافظة" htmlFor="pf-gov">
                      <Select id="pf-gov" value={form.governorate} onChange={set("governorate")}>
                        {Object.entries(m.governorates).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                      </Select>
                    </Field>
                    <Field label="المدينة" optional htmlFor="pf-city">
                      <Input id="pf-city" value={form.city} onChange={set("city")} />
                    </Field>
                    <Field label="العنوان" optional htmlFor="pf-addr" className="sm:col-span-2">
                      <Input id="pf-addr" value={form.address} onChange={set("address")} />
                    </Field>
                    <Field label="الهاتف" optional htmlFor="pf-phone">
                      <Input id="pf-phone" dir="ltr" type="tel" value={form.phone} onChange={set("phone")} />
                    </Field>
                    <Field label="البريد الإلكتروني" optional htmlFor="pf-email">
                      <Input id="pf-email" dir="ltr" type="email" value={form.email} onChange={set("email")} />
                    </Field>
                    <Field label="تذييل الطباعة" optional htmlFor="pf-footer" className="sm:col-span-2"
                      hint={<>يظهر أسفل كل وصفة مطبوعة. <span className="num">{form.print_footer.length}</span>/300</>}>
                      <Input id="pf-footer" maxLength={300} value={form.print_footer} onChange={set("print_footer")}
                        placeholder="مثال: أوقات الدوام من 9 صباحاً حتى 5 مساءً" />
                    </Field>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 sm:col-span-2">
                      <span className="text-xs text-subtle">
                        رقم الترخيص: <span className="num">{p.license_number || "—"}</span> · يعدّله مدير المنصة فقط
                      </span>
                      <div className="flex gap-2">
                        {dirty && <Button type="button" variant="ghost" onClick={() => setForm(toForm(p))}>تراجع</Button>}
                        <Button type="submit" loading={saving} disabled={!dirty}>حفظ التغييرات</Button>
                      </div>
                    </div>
                  </form>
                )}
              </CardBody>
            </Card>

            <Departments />
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Printer className="size-4 text-brand-600" /> معاينة ترويسة الوصفة
            </div>
            <PrescriptionPreview form={form} />
            <p className="mt-2 text-xs text-subtle">معاينة تقريبية تتحدث أثناء الكتابة. بيانات الطبيب والمريض أمثلة.</p>
          </div>
        </div>
  );
}

function PrescriptionPreview({ form }: { form: Form }) {
  const place = [form.address, form.city, label("governorates", form.governorate)].filter((x) => x && x !== "—").join("، ");
  return (
    <div className="overflow-hidden rounded-card border border-line-strong bg-elevated shadow-card" aria-label="معاينة">
      <div className="border-b-2 border-brand-600 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-bold leading-tight text-fg">{form.name || "اسم المنشأة"}</div>
            {form.name_en && <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-muted" dir="ltr">{form.name_en}</div>}
            <div className="mt-2 space-y-0.5 text-xs text-muted">
              {place && <div>{place}</div>}
              {(form.phone || form.email) && (
                <div className="flex flex-wrap gap-x-3">
                  {form.phone && <span className="num">{formatPhone(form.phone)}</span>}
                  {form.email && <span dir="ltr">{form.email}</span>}
                </div>
              )}
            </div>
          </div>
          <LogoMark className="size-10 shrink-0" />
        </div>
        <div className="mt-4 flex items-end justify-between gap-2 text-xs">
          <div>
            <div className="font-semibold text-fg">د. اسم الطبيب</div>
            <div className="text-muted">الاختصاص</div>
          </div>
          <div className="text-muted">{formatDate(new Date())}</div>
        </div>
      </div>
      <div className="space-y-2.5 p-5">
        <div className="flex justify-between text-xs text-muted"><span>المريض: ـــــــــــ</span><span>العمر: ـــ</span></div>
        <div className="pt-1 text-2xl font-semibold text-brand-600" dir="ltr">℞</div>
        {[80, 65, 72].map((w) => <div key={w} className="h-2 rounded bg-sunken" style={{ width: `${w}%` }} />)}
      </div>
      <div className="border-t border-dashed border-line px-5 py-3 text-center text-[11px] text-muted">
        {form.print_footer || <span className="text-subtle">تذييل الطباعة يظهر هنا</span>}
      </div>
    </div>
  );
}

function Departments() {
  const queryClient = useQueryClient();
  const { membership } = useSession();
  const [name, setName] = React.useState("");
  const [removing, setRemoving] = React.useState<Schemas["Department"] | null>(null);
  const key = ["org", "departments", membership?.id];

  const list = useQuery({
    queryKey: key,
    queryFn: () => unwrap(api.GET("/api/v1/org/departments", { params: { query: { page_size: 100 } } })),
  });
  const add = useMutation({
    mutationFn: (n: string) => unwrap(api.POST("/api/v1/org/departments", { body: { name: n } })),
    onSuccess: () => {
      setName("");
      toast.success("أُضيف القسم");
      queryClient.invalidateQueries({ queryKey: ["org", "departments"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE("/api/v1/org/departments/{id}", { params: { path: { id } } })),
    onSuccess: () => {
      setRemoving(null);
      toast.success("حُذف القسم");
      queryClient.invalidateQueries({ queryKey: ["org"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const items = list.data?.results ?? [];

  return (
    <Card>
      <CardHeader title="الأقسام" description="لتنظيم الفريق، مثل: العيادة الداخلية، المخبر، الأشعة." icon={<Layers className="size-[18px]" />} />
      <CardBody className="space-y-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(name.trim()); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم القسم الجديد" maxLength={150} aria-label="اسم القسم" />
          <Button type="submit" variant="secondary" loading={add.isPending} disabled={!name.trim()}><Plus className="size-4" /> إضافة</Button>
        </form>
        {list.error ? <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
          : list.isLoading ? <SkeletonList rows={2} />
          : items.length === 0 ? <p className="py-4 text-center text-sm text-muted">لا توجد أقسام بعد.</p>
          : (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {items.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <span>{d.name}</span>
                  <Button variant="danger-ghost" size="icon" aria-label={`حذف ${d.name}`} onClick={() => setRemoving(d)}>
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
      </CardBody>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="حذف القسم؟"
        description={<>سيُحذف قسم <b className="text-fg">{removing?.name}</b> ويصبح أعضاؤه بدون قسم. لا يؤثر ذلك على صلاحياتهم.</>}
        confirmLabel="حذف"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Card>
  );
}
