"use client";

import { CheckCircle2, FlaskConical, IdCard, Info, RotateCcw, ScanLine, UserCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { ResultWorkspace } from "@/components/lab/result-workspace";
import { type PatientIdentity, PatientBriefCard } from "@/components/lab/shared";
import { Button } from "@/components/ui/button";
import { ChoiceChips, Field, Input } from "@/components/ui/field";
import { Card, CardBody, CardHeader, EmptyState, SkeletonList } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { useSession } from "@/lib/session";

type Identified = Schemas["IdentifiedPatient"];

export default function WalkInResultPage() {
  const { has, membership } = useSession();
  const canLab = has("lab_staff");
  const canImaging = has("imaging_staff");
  const [healthNumber, setHealthNumber] = React.useState("");
  const [identified, setIdentified] = React.useState<Identified | null>(null);
  const [busy, setBusy] = React.useState<"identify" | "register" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [chosenKind, setKind] = React.useState<"lab" | "imaging">("lab");
  // Roles arrive after the session loads, so derive instead of fixing the initial value.
  const kind: "lab" | "imaging" = canLab && canImaging ? chosenKind : canLab ? "lab" : "imaging";
  const [done, setDone] = React.useState(false);
  const [round, setRound] = React.useState(0);

  if (!membership) return <SkeletonList rows={5} />;
  if (!canLab && !canImaging) {
    return (
      <>
        <PageHeader title="نتيجة دون طلب إلكتروني" back="/app/lab" />
        <Card><EmptyState icon={<FlaskConical className="size-6" />} title="هذه الصفحة لطاقم المختبر أو التصوير" /></Card>
      </>
    );
  }

  const identify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!healthNumber.trim()) return setError("أدخل الرقم الصحي الموجود على بطاقة المريض.");
    setBusy("identify");
    setError(null);
    try {
      setIdentified(await unwrap(api.POST("/api/v1/patients/identify", { body: { health_number: healthNumber.trim() } })));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const register = async () => {
    setBusy("register");
    try {
      setIdentified(await unwrap(api.POST("/api/v1/patients/register", { body: { health_number: healthNumber.trim() } })));
      toast.success("سُجّل المريض لدى منشأتك");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setIdentified(null);
    setHealthNumber("");
    setDone(false);
    setRound((n) => n + 1);
  };

  const patient: PatientIdentity | null = identified ? {
    id: identified.patient.id, full_name: identified.patient.full_name,
    health_number: identified.patient.health_number, age_years: identified.patient.age_years,
    sex: identified.patient.sex,
  } : null;
  const registered = identified?.access.registered;

  return (
    <>
      <PageHeader
        back="/app/lab"
        eyebrow={membership?.organization.name}
        title="نتيجة دون طلب إلكتروني"
        description="لمريض حضر بطلب ورقي أو دون طلب. تُضاف النتيجة إلى ملفه الصحي بعد الاعتماد."
      />

      {!identified ? (
        <Card className="mx-auto max-w-xl">
          <CardHeader title="تحديد المريض" description="اطلب من المريض بطاقته الصحية وأدخل الرقم المطبوع عليها."
            icon={<IdCard className="size-[18px]" />} />
          <CardBody>
            <form onSubmit={identify} className="space-y-4">
              <Field label="الرقم الصحي" htmlFor="hn" error={error}>
                <Input id="hn" dir="ltr" inputMode="numeric" autoFocus className="num text-center text-lg tracking-widest"
                  placeholder="0000 0000 00" value={healthNumber} onChange={(e) => setHealthNumber(e.target.value)} />
              </Field>
              <Button type="submit" className="w-full" size="lg" loading={busy === "identify"}>
                <UserCheck className="size-5" /> تحقق من المريض
              </Button>
            </form>
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-sunken/70 p-3 text-xs leading-5 text-muted">
              <Info className="mt-0.5 size-4 shrink-0" />
              <span>التعرف على المريض لا يكشف أي سجل طبي، ويُسجل في سجل الوصول الذي يراه المريض. لا تستخدمه لمريض غير حاضر.
                للبحث بمسح البطاقة استخدم <Link href="/app/scan" className="inline-flex items-center gap-0.5 font-medium text-brand-600"><ScanLine className="size-3" /> مسح البطاقة</Link>.</span>
            </div>
          </CardBody>
        </Card>
      ) : !registered ? (
        <Card className="mx-auto max-w-xl">
          <CardHeader title="المريض غير مسجل لدى منشأتك" icon={<IdCard className="size-[18px]" />} />
          <CardBody className="space-y-4">
            {patient && <PatientBriefCard patient={patient} />}
            <p className="text-sm text-muted">
              لإصدار نتيجة لهذا المريض سجّله أولاً لدى منشأتك. التسجيل يثبت حضوره لديكم فقط، ولا يكشف سجلاته في المنشآت الأخرى.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={reset}>مريض آخر</Button>
              <Button loading={busy === "register"} onClick={register}>تسجيل المريض والمتابعة</Button>
            </div>
          </CardBody>
        </Card>
      ) : done ? (
        <Card className="mx-auto max-w-xl">
          <EmptyState icon={<CheckCircle2 className="size-6" />} title="اعتُمدت النتيجة"
            description="أُضيفت إلى الملف الصحي للمريض ووصله إشعار بها."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => { setDone(false); setRound((n) => n + 1); }}>نتيجة أخرى للمريض نفسه</Button>
                <Button onClick={reset}><RotateCcw className="size-4" /> مريض جديد</Button>
              </div>
            } />
        </Card>
      ) : (
        <div className="space-y-5">
          {patient && (
            <PatientBriefCard patient={patient} className="bg-elevated"
              action={<Button variant="ghost" size="sm" onClick={reset}>تغيير</Button>} />
          )}
          {canLab && canImaging && (
            <ChoiceChips options={[{ value: "lab", label: "تحليل مخبري" }, { value: "imaging", label: "تقرير تصوير" }]}
              value={kind} onChange={(v) => { setKind(v as "lab" | "imaging"); setRound((n) => n + 1); }} />
          )}
          {patient && (
            <ResultWorkspace key={`${kind}-${round}`} kind={kind} patientId={patient.id}
              onFinalized={() => setDone(true)} />
          )}
        </div>
      )}
    </>
  );
}
