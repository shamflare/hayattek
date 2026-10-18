"use client";

import { useMutation } from "@tanstack/react-query";
import { KeyRound, Lock, MessageSquareText, Smartphone, UserCheck } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceChips, Field, Input, Textarea } from "@/components/ui/field";
import { Card } from "@/components/ui/surface";
import { api, errorMessage, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { m } from "@/lib/i18n";

import { readPresented, useRefreshChart } from "./queries";

type Method = "in_person" | "otp" | "patient_app";

export function AccessRequestCard({ patientId, hasPhone, hasAccount, registered }: {
  patientId: string; hasPhone: boolean; hasAccount: boolean; registered: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Card className="flex flex-col items-start gap-4 border-brand-200 bg-brand-50/60 p-5 sm:flex-row sm:items-center">
      <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-elevated text-brand-600 shadow-soft"><Lock className="size-6" /></div>
      <div className="flex-1">
        <div className="font-semibold">{registered ? "سجلات المنشآت الأخرى مخفية" : "لا تملك وصولاً إلى السجل الطبي"}</div>
        <p className="mt-1 text-sm leading-6 text-muted">
          {registered
            ? "ترى سجلات منشأتك. لرؤية تاريخ المريض لدى أطباء آخرين اطلب موافقته."
            : "تعرّفت على هوية المريض فقط. اطلب موافقته للاطلاع على ملفه وإضافة سجلات."}
        </p>
      </div>
      <Button onClick={() => setOpen(true)}><UserCheck className="size-4" /> طلب موافقة المريض</Button>
      <AccessDialog open={open} onOpenChange={setOpen} patientId={patientId} hasPhone={hasPhone} hasAccount={hasAccount} />
    </Card>
  );
}

export function AccessDialog({ open, onOpenChange, patientId, hasPhone, hasAccount }: {
  open: boolean; onOpenChange: (o: boolean) => void; patientId: string; hasPhone: boolean; hasAccount: boolean;
}) {
  const refresh = useRefreshChart(patientId);
  const presented = typeof window !== "undefined" ? readPresented(patientId) : null;
  const [method, setMethod] = React.useState<Method>(hasAccount ? "patient_app" : hasPhone ? "otp" : "in_person");
  const [scopes, setScopes] = React.useState<string[]>(["summary", "encounters", "prescriptions", "labs", "imaging"]);
  const [hours, setHours] = React.useState("24");
  const [healthNumber, setHealthNumber] = React.useState(presented?.health_number ?? "");
  const [attestation, setAttestation] = React.useState("المريض حاضر وعرض بطاقته الصحية ووافق شفهياً");
  const [requestId, setRequestId] = React.useState<string | null>(null);
  const [otp, setOtp] = React.useState("");

  const done = (msg: string) => { toast.success(msg); refresh(); onOpenChange(false); setRequestId(null); setOtp(""); };

  const submit = useMutation({
    mutationFn: async () => {
      const identity = presented?.card_token && !healthNumber
        ? { card_token: presented.card_token }
        : healthNumber ? { health_number: healthNumber } : { patient_id: patientId };
      if (method === "in_person") {
        return unwrap(api.POST("/api/v1/access/in-person", {
          body: { ...identity, scopes, hours: Number(hours), attestation } as never,
        }));
      }
      return unwrap(api.POST("/api/v1/access/requests", {
        body: { ...identity, scopes, hours: Number(hours), channel: method } as never,
      }));
    },
    onSuccess: (res) => {
      if (method === "in_person") done("تم منح الوصول");
      else if (method === "otp") { setRequestId((res as { id: string }).id); toast.success("أُرسل الرمز إلى هاتف المريض"); }
      else done("أُرسل الطلب إلى حساب المريض. ستصلك موافقته كإشعار.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const verify = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/access/requests/{request_id}/verify-otp", {
      params: { path: { request_id: requestId as string } }, body: { otp },
    })),
    onSuccess: () => done("تم التحقق ومنح الوصول"),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const methods: { id: Method; icon: React.ElementType; title: string; text: string; disabled?: string }[] = [
    { id: "patient_app", icon: Smartphone, title: "من تطبيق المريض", text: "يصله إشعار فيوافق أو يرفض", disabled: hasAccount ? undefined : "لا يملك حساباً" },
    { id: "otp", icon: MessageSquareText, title: "رمز إلى هاتفه", text: "يقرأ عليك الرمز المرسل", disabled: hasPhone ? undefined : "لا يوجد هاتف مسجل" },
    { id: "in_person", icon: KeyRound, title: "تحقق حضوري", text: "المريض أمامك مع بطاقته" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="طلب موافقة المريض" description="حدد ما تحتاج الاطلاع عليه ولأي مدة. كل منح يُسجّل ويستطيع المريض إلغاءه."
        footer={requestId ? (
          <Button loading={verify.isPending} disabled={otp.length < 6} onClick={() => verify.mutate()}>تحقق</Button>
        ) : (
          <><Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button loading={submit.isPending} disabled={!scopes.length || (method === "in_person" && (!attestation.trim() || (!healthNumber && !presented?.card_token)))}
              onClick={() => submit.mutate()}>
              {method === "in_person" ? "منح الوصول" : method === "otp" ? "إرسال الرمز" : "إرسال الطلب"}
            </Button></>
        )}>
        {requestId ? (
          <div className="space-y-4 py-4 text-center">
            <p className="text-muted">اطلب من المريض قراءة الرمز المكون من 6 أرقام الذي وصله برسالة.</p>
            <Input autoFocus inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="num mx-auto h-14 max-w-56 text-center text-2xl tracking-[0.5em]" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {methods.map((x) => (
                <button key={x.id} type="button" disabled={Boolean(x.disabled)} onClick={() => setMethod(x.id)}
                  className={cn("rounded-2xl border p-4 text-start transition disabled:cursor-not-allowed disabled:opacity-50",
                    method === x.id ? "border-brand-500 bg-brand-50 ring-4 ring-brand-100" : "border-line hover:border-brand-300")}>
                  <x.icon className="size-5 text-brand-600" />
                  <div className="mt-2 font-semibold">{x.title}</div>
                  <div className="text-xs text-muted">{x.disabled ?? x.text}</div>
                </button>
              ))}
            </div>
            <Field label="المعلومات المطلوبة">
              <ChoiceChips multiple value={scopes} onChange={(v) => setScopes(v as string[])}
                options={Object.entries(m.scopes).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="المدة">
              <ChoiceChips value={hours} onChange={(v) => setHours(v as string)}
                options={method === "in_person"
                  ? [{ value: "2", label: "ساعتان" }, { value: "24", label: "يوم" }, { value: "72", label: "3 أيام" }]
                  : [{ value: "24", label: "يوم" }, { value: "168", label: "أسبوع" }, { value: "720", label: "شهر" }]} />
            </Field>
            {method === "in_person" && (
              <div className="grid gap-4 rounded-2xl bg-sunken p-4">
                {presented?.card_token ? (
                  <p className="text-sm text-success">✓ تم مسح بطاقة المريض في هذه الجلسة.</p>
                ) : (
                  <Field label="الرقم الصحي من بطاقة المريض" hint="إثبات حضور المريض: لا يكفي فتح الملف من القائمة.">
                    <Input dir="ltr" inputMode="numeric" className="num text-start" value={healthNumber} onChange={(e) => setHealthNumber(e.target.value)} placeholder="0000 0000 00" />
                  </Field>
                )}
                <Field label="كيف تحققت من هوية المريض؟">
                  <Textarea rows={2} value={attestation} onChange={(e) => setAttestation(e.target.value)} />
                </Field>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
