"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { m } from "@/lib/i18n";

type Org = Schemas["Organization"];
type OrgBody = Schemas["OrganizationRequest"];

const EMPTY: OrgBody = {
  name: "", name_en: "", kind: "clinic", governorate: "raqqa", city: "", address: "", phone: "",
  email: "", license_number: "", print_footer: "",
};

/** Create (no `organization`) or edit an organization as platform admin. */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization?: Org;
  onSaved?: (org: Org) => void;
}

export function OrganizationFormDialog(props: Props) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <OrganizationForm {...props} />}
    </Dialog>
  );
}

function OrganizationForm({ onOpenChange, organization, onSaved }: Props) {
  const [form, setForm] = React.useState<OrgBody>(() => organization ? {
    name: organization.name, name_en: organization.name_en ?? "", kind: organization.kind,
    governorate: organization.governorate ?? "raqqa", city: organization.city ?? "",
    address: organization.address ?? "", phone: organization.phone ?? "",
    email: organization.email ?? "", license_number: organization.license_number ?? "",
    print_footer: organization.print_footer ?? "",
  } : EMPTY);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = (key: keyof OrgBody) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError("أدخل اسم المنشأة.");
    setSaving(true);
    setError(null);
    try {
      const saved = organization
        ? await unwrap(api.PATCH("/api/v1/admin/organizations/{id}", {
            params: { path: { id: organization.id } }, body: form,
          }))
        : await unwrap(api.POST("/api/v1/admin/organizations", { body: form }));
      toast.success(organization ? "حُفظت بيانات المنشأة" : "أُضيفت المنشأة وهي فعالة الآن");
      onOpenChange(false);
      onSaved?.(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
      <DialogContent
        size="lg"
        title={organization ? "تعديل بيانات المنشأة" : "إضافة منشأة"}
        description={organization ? undefined : "تُنشأ المنشأة بحالة فعالة. بعدها أضف مديرها وفريقها من صفحة المنشأة."}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" form="org-form" loading={saving}>{organization ? "حفظ" : "إضافة"}</Button>
          </>
        }
      >
        <form id="org-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم المنشأة" htmlFor="o-name" className="sm:col-span-2">
            <Input id="o-name" value={form.name} onChange={set("name")} />
          </Field>
          <Field label="الاسم بالإنجليزية" optional htmlFor="o-name-en">
            <Input id="o-name-en" dir="ltr" value={form.name_en} onChange={set("name_en")} />
          </Field>
          <Field label="النوع" htmlFor="o-kind">
            <Select id="o-kind" value={form.kind} onChange={set("kind")}>
              {Object.entries(m.orgKinds).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </Select>
          </Field>
          <Field label="المحافظة" htmlFor="o-gov">
            <Select id="o-gov" value={form.governorate} onChange={set("governorate")}>
              {Object.entries(m.governorates).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </Select>
          </Field>
          <Field label="المدينة" optional htmlFor="o-city">
            <Input id="o-city" value={form.city} onChange={set("city")} />
          </Field>
          <Field label="العنوان" optional htmlFor="o-addr" className="sm:col-span-2">
            <Input id="o-addr" value={form.address} onChange={set("address")} />
          </Field>
          <Field label="الهاتف" optional htmlFor="o-phone">
            <Input id="o-phone" dir="ltr" type="tel" value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label="البريد الإلكتروني" optional htmlFor="o-email">
            <Input id="o-email" dir="ltr" type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="رقم الترخيص" optional htmlFor="o-lic">
            <Input id="o-lic" dir="ltr" value={form.license_number} onChange={set("license_number")} />
          </Field>
          <Field label="تذييل الطباعة" optional htmlFor="o-footer" hint="يظهر أسفل الوصفات المطبوعة.">
            <Input id="o-footer" value={form.print_footer} onChange={set("print_footer")} />
          </Field>
          {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">{error}</p>}
        </form>
      </DialogContent>
  );
}
