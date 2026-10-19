"use client";

import { Check, Copy, KeyRound, ShieldAlert, Stethoscope, UserPlus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceChips, Field, Input, Select } from "@/components/ui/field";
import { errorMessage, type Schemas } from "@/lib/api";
import { m } from "@/lib/i18n";

import { useCopy } from "./common";

type Role = Schemas["RolesEnum"];
type Specialty = Schemas["SpecialtyEnum"];
type CreateBody = Schemas["MemberCreateRequest"];
type CreateResult = Schemas["MemberCreateResponse"];

const ROLE_OPTIONS = (Object.keys(m.roles) as Role[]).map((value) => ({ value, label: m.roles[value] }));

const EMPTY = {
  full_name: "", email: "", phone: "", title: "",
  specialty: "" as Specialty | "", display_name: "", license_number: "", license_authority: "",
};

/**
 * Add a staff member to a facility (platform admin and facility admin share this).
 * The caller supplies `submit` so each area posts to its own endpoint.
 */
interface AddMemberProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submit: (body: CreateBody) => Promise<CreateResult>;
  onAdded?: (result: CreateResult) => void;
  facilityName?: string;
  defaultRoles?: Role[];
}

export function AddMemberDialog(props: AddMemberProps) {
  const [result, setResult] = React.useState<CreateResult | null>(null);
  return (
    <>
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        {/* Mounted only while open, so every opening starts from an empty form. */}
        {props.open && <AddMemberForm {...props} onSetupLink={setResult} />}
      </Dialog>
      <SetupLinkDialog result={result} onClose={() => setResult(null)} />
    </>
  );
}

function AddMemberForm({
  onOpenChange, submit, onAdded, facilityName, defaultRoles = [], onSetupLink,
}: AddMemberProps & { onSetupLink: (r: CreateResult) => void }) {
  const [form, setForm] = React.useState(EMPTY);
  const [roles, setRoles] = React.useState<Role[]>(defaultRoles);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const isPhysician = roles.includes("physician");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.full_name.trim()) return setError("أدخل الاسم الكامل.");
    if (!form.email.trim() && !form.phone.trim()) return setError("أدخل البريد الإلكتروني أو رقم الهاتف.");
    if (!roles.length) return setError("اختر دوراً واحداً على الأقل.");
    if (isPhysician && !form.specialty) return setError("حدد اختصاص الطبيب.");
    const body: CreateBody = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      roles,
      title: form.title.trim(),
    };
    if (isPhysician && form.specialty) {
      body.practitioner = {
        specialty: form.specialty,
        display_name: form.display_name.trim(),
        license_number: form.license_number.trim(),
        license_authority: form.license_authority.trim(),
      };
    }
    setSaving(true);
    try {
      const res = await submit(body);
      onOpenChange(false);
      onAdded?.(res);
      if (res.setup_link) onSetupLink(res);
      else toast.success(res.user_created ? "تمت إضافة العضو" : "أُضيف حساب موجود إلى المنشأة");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
        <DialogContent
          size="lg"
          title="إضافة عضو إلى الفريق"
          description={facilityName ? <>سيُضاف العضو إلى <b className="text-fg">{facilityName}</b>.</> : undefined}
          footer={
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
              <Button type="submit" form="add-member-form" loading={saving}>
                <UserPlus className="size-4" /> إضافة
              </Button>
            </>
          }
        >
          <form id="add-member-form" onSubmit={onSubmit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="الاسم الكامل" className="sm:col-span-2" htmlFor="m-name">
                <Input id="m-name" value={form.full_name} onChange={set("full_name")} autoComplete="off" />
              </Field>
              <Field label="البريد الإلكتروني" htmlFor="m-email" hint="يُرسل إليه رابط تعيين كلمة المرور.">
                <Input id="m-email" type="email" dir="ltr" value={form.email} onChange={set("email")} autoComplete="off" />
              </Field>
              <Field label="رقم الهاتف" htmlFor="m-phone" hint="البريد أو الهاتف، أحدهما على الأقل.">
                <Input id="m-phone" type="tel" dir="ltr" value={form.phone} onChange={set("phone")} placeholder="09xx xxx xxx" />
              </Field>
            </div>

            <Field label="الأدوار" hint="يمكن الجمع بين أكثر من دور، مثل طبيب ومدير منشأة.">
              <ChoiceChips multiple options={ROLE_OPTIONS} value={roles} onChange={(v) => setRoles(v as Role[])} />
            </Field>

            <Field label="المسمى الوظيفي" optional htmlFor="m-title">
              <Input id="m-title" value={form.title} onChange={set("title")} placeholder="مثال: فني مخبر أول" />
            </Field>

            {isPhysician && (
              <div className="space-y-4 rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
                <div className="flex items-start gap-2 text-sm">
                  <Stethoscope className="mt-0.5 size-4 shrink-0 text-brand-600" />
                  <div>
                    <div className="font-semibold">بيانات الطبيب</div>
                    <p className="text-muted">
                      يبقى الطبيب <b>بانتظار التحقق</b> ولا يستطيع فتح السجلات الطبية حتى تتحقق إدارة المنصة من ترخيصه.
                      إن كان للطبيب هوية مسجلة مسبقاً في المنصة تُستخدم كما هي.
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="الاختصاص" htmlFor="m-spec">
                    <Select id="m-spec" value={form.specialty} onChange={set("specialty")}>
                      <option value="">اختر الاختصاص…</option>
                      {Object.entries(m.specialties).map(([value, text]) => (
                        <option key={value} value={value}>{text}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="الاسم الظاهر" optional htmlFor="m-display" hint="افتراضياً: د. + الاسم الكامل">
                    <Input id="m-display" value={form.display_name} onChange={set("display_name")} />
                  </Field>
                  <Field label="رقم الترخيص" optional htmlFor="m-lic">
                    <Input id="m-lic" dir="ltr" value={form.license_number} onChange={set("license_number")} />
                  </Field>
                  <Field label="جهة الترخيص" optional htmlFor="m-auth">
                    <Input id="m-auth" value={form.license_authority} onChange={set("license_authority")} placeholder="مثال: نقابة الأطباء" />
                  </Field>
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
            )}
          </form>
        </DialogContent>
  );
}

/** Shows the one-time password-setup link of a newly created account exactly once. */
export function SetupLinkDialog({ result, onClose }: { result: CreateResult | null; onClose: () => void }) {
  const { copied, copy } = useCopy();
  const link = result?.setup_link ?? "";
  const physicianPending =
    result?.membership.practitioner && result.membership.practitioner.verification_status !== "verified";
  return (
    <Dialog open={!!result} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        size="md"
        title="تم إنشاء الحساب"
        description={<>أُضيف <b className="text-fg">{result?.membership.user.full_name}</b> إلى الفريق.</>}
        footer={<Button onClick={onClose}>تم</Button>}
      >
        <div className="space-y-4 text-sm">
          <div className="flex items-start gap-3 rounded-2xl border border-line bg-sunken/60 p-4">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-brand-600" />
            <p className="leading-7 text-muted">
              هذا <b className="text-fg">رابط لمرة واحدة</b> لتعيين كلمة المرور. سلّمه للعضو بطريقة آمنة.
              يُرسل أيضاً إلى بريده الإلكتروني متى كان إرسال البريد مفعّلاً في المنصة.
              <b className="text-fg"> لن يُعرض الرابط مرة أخرى.</b>
            </p>
          </div>
          <div className="flex items-stretch gap-2">
            <code dir="ltr" className="num min-w-0 flex-1 select-all break-all rounded-xl border border-line bg-elevated px-3 py-2.5 text-xs">
              {link}
            </code>
            <Button variant="outline" className="h-auto" onClick={() => copy(link)} aria-label="نسخ الرابط">
              {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
              {copied ? "نُسخ" : "نسخ"}
            </Button>
          </div>
          {physicianPending && (
            <div className="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2.5 text-warning">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>حساب الطبيب بانتظار تحقق إدارة المنصة من الترخيص قبل أن يتمكن من العمل على السجلات الطبية.</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
