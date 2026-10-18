"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceChips, Field, Input } from "@/components/ui/field";
import { api, errorMessage, unwrap } from "@/lib/api";

export function ActivateAccountDialog({ open, onOpenChange, patientId, phone }: {
  open: boolean; onOpenChange: (o: boolean) => void; patientId: string; phone?: string | null;
}) {
  const qc = useQueryClient();
  const [email, setEmail] = React.useState("");
  const [tel, setTel] = React.useState(phone ?? "");
  const [link, setLink] = React.useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/patients/{id}/account", {
      params: { path: { id: patientId } }, body: { email, phone: tel },
    })),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["patient", patientId] });
      // Report what really happened to the message (never claim delivery that did not occur).
      if (r.delivery === "sent") toast.success("أُرسل رابط تفعيل الحساب للمريض");
      else if (r.delivery === "queued") toast.success("فُعّل الحساب، ورابط التفعيل في طابور الإرسال");
      else if (r.delivery === "not_configured") toast.warning("فُعّل الحساب، لكن لم يُرسل الرابط: خدمة الرسائل غير مفعلة");
      else toast.warning("فُعّل الحساب، لكن تعذّر إرسال رابط التفعيل. يستطيع المريض استخدام «نسيت كلمة المرور» لاحقاً");
      if (r.setup_link) setLink(r.setup_link);
      else onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setLink(null); }}>
      <DialogContent title="تفعيل حساب المريض في التطبيق"
        description="يصل المريض رابط لمرة واحدة يعيّن به كلمة المرور بنفسه. لا يرى الموظف كلمة المرور أبداً."
        footer={link ? <Button onClick={() => onOpenChange(false)}>تم</Button> : <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button loading={run.isPending} disabled={!email && !tel} onClick={() => run.mutate()}>إرسال رابط التفعيل</Button></>}>
        {link ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">بيئة التطوير: يظهر الرابط هنا للتجربة (في الإنتاج يُرسل برسالة أو بريد فقط).</p>
            <div className="flex gap-2">
              <Input readOnly value={link} dir="ltr" className="text-xs" />
              <Button variant="outline" size="icon" aria-label="نسخ" onClick={() => { navigator.clipboard.writeText(link); toast.success("نُسخ"); }}><Copy className="size-4" /></Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="رقم الهاتف" hint="يُرسل الرابط برسالة نصية."><Input dir="ltr" className="num text-start" value={tel} onChange={(e) => setTel(e.target.value)} /></Field>
            <Field label="أو البريد الإلكتروني" optional><Input type="email" dir="ltr" className="text-start" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function LinkGuardianDialog({ open, onOpenChange, patientId }: {
  open: boolean; onOpenChange: (o: boolean) => void; patientId: string;
}) {
  const [number, setNumber] = React.useState("");
  const [relationship, setRelationship] = React.useState<"parent" | "legal_guardian" | "caregiver">("parent");
  const [until, setUntil] = React.useState("");
  const run = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/patients/{id}/guardians", {
      params: { path: { id: patientId } },
      body: { guardian_health_number: number, relationship, valid_until: until || null },
    })),
    onSuccess: () => { toast.success("تم ربط الوصي"); onOpenChange(false); setNumber(""); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="ربط وصي بهذا الملف"
        description="تحقق حضورياً من صلة القرابة أو الوصاية. يستطيع الوصي بعدها متابعة الملف من حسابه حتى التاريخ المحدد (للقاصرين: بلوغ 18 تلقائياً)."
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button loading={run.isPending} disabled={!number.trim()} onClick={() => run.mutate()}>ربط</Button></>}>
        <div className="space-y-4">
          <Field label="الرقم الصحي للوصي" hint="يجب أن يكون للوصي ملف وحساب مفعّل.">
            <Input dir="ltr" inputMode="numeric" className="num text-start" value={number} onChange={(e) => setNumber(e.target.value)} />
          </Field>
          <Field label="الصلة">
            <ChoiceChips value={relationship} onChange={(v) => setRelationship(v as typeof relationship)}
              options={[{ value: "parent", label: "أب/أم" }, { value: "legal_guardian", label: "وصي قانوني" }, { value: "caregiver", label: "مقدم رعاية" }]} />
          </Field>
          <Field label="صالحة حتى" optional><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
