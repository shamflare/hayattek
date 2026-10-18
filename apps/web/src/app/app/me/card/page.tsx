"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Info, Printer, RefreshCw, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { useActivePatient } from "@/components/patient/active-patient";
import { portalKeys } from "@/components/patient/portal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceChips, Field, Textarea } from "@/components/ui/field";
import { LogoMark } from "@/components/ui/logo";
import { Card, CardBody, ErrorState, Skeleton } from "@/components/ui/surface";
import { errorMessage, patientApi, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";

const reasons = [
  { value: "lost", label: "فقدتها" },
  { value: "stolen", label: "سُرقت" },
  { value: "damaged", label: "تلفت" },
  { value: "exposed", label: "صوّرها شخص غريب" },
  { value: "other", label: "سبب آخر" },
] as const;
type Reason = (typeof reasons)[number]["value"];

// Card-sized print (ID-1: 85.6 × 54 mm). Only the printable card is visible on paper.
const printCss = `
@media print {
  @page { size: A4; margin: 12mm; }
  body * { visibility: hidden !important; }
  .hayat-print-card, .hayat-print-card * { visibility: visible !important; }
  .hayat-print-card { display: flex !important; position: fixed; top: 0; right: 0;
    print-color-adjust: exact; -webkit-print-color-adjust: exact; }
}`;

export default function HealthCardPage() {
  const { active } = useActivePatient();
  const patient = active!;
  const queryClient = useQueryClient();
  const [lostOpen, setLostOpen] = React.useState(false);
  const [reason, setReason] = React.useState<Reason>("lost");
  const [details, setDetails] = React.useState("");

  const card = useQuery({
    queryKey: portalKeys.card(patient.id),
    queryFn: () => unwrap(patientApi.GET("/api/v1/me/patients/{id}/card", { params: { path: { id: patient.id } } })),
  });

  const replace = useMutation({
    mutationFn: () => {
      const base = reasons.find((r) => r.value === reason)!.label;
      const text = details.trim() ? `${base}: ${details.trim()}` : base;
      return unwrap(patientApi.POST("/api/v1/me/patients/{id}/card/replace", {
        params: { path: { id: patient.id } },
        body: { reason: text.slice(0, 200) },
      }));
    },
    onSuccess: (newCard) => {
      queryClient.setQueryData(portalKeys.card(patient.id), newCard);
      setLostOpen(false);
      setDetails("");
      toast.success("أُبطلت البطاقة القديمة وصدر رمز جديد. اطبع بطاقتك الجديدة.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <style>{printCss}</style>
      <PageHeader title="بطاقتي الصحية"
        description="أظهر هذا الرمز للطبيب أو المختبر ليفتح ملفك بسرعة. لا يحتوي الرمز على أي معلومات طبية." />

      {card.isLoading ? (
        <Skeleton className="mx-auto aspect-[1.586] w-full max-w-md rounded-3xl" />
      ) : card.isError ? (
        <ErrorState message={errorMessage(card.error)} onRetry={() => card.refetch()} />
      ) : (
        <>
          {/* On-screen card */}
          <div className="mx-auto w-full max-w-md overflow-hidden rounded-3xl border border-line bg-elevated shadow-card">
            <div className="flex items-center justify-between gap-3 bg-gradient-to-br from-brand-600 to-brand-800 px-5 py-4 text-white">
              <div className="flex items-center gap-2.5">
                <LogoMark className="size-9" />
                <div className="leading-tight">
                  <div className="font-bold">حياة</div>
                  <div className="text-[11px] tracking-[0.2em] text-white/70">HAYAT HEALTH CARD</div>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs">
                <ShieldCheck className="size-3.5" /> بطاقة فعالة
              </span>
            </div>
            <div className="flex flex-col items-center px-6 pb-6 pt-6">
              <div className="rounded-3xl border border-line bg-white p-4 shadow-soft">
                <QRCodeSVG value={card.data!.qr_url} size={232} level="M" marginSize={0}
                  className="h-auto w-[min(232px,60vw)]" aria-label="رمز QR للبطاقة الصحية" />
              </div>
              <div className="mt-5 text-center">
                <div className="text-xl font-bold">{patient.full_name}</div>
                <div className="mt-1 text-sm text-muted">الرقم الصحي</div>
                <div className="num mt-0.5 text-3xl font-semibold tracking-[0.12em] text-brand-700 dark:text-brand-300">
                  {patient.health_number}
                </div>
                <div className="mt-2 text-xs text-subtle">صدرت في {formatDate(card.data!.created_at)}</div>
              </div>
            </div>
          </div>

          <div className="mx-auto mt-5 flex w-full max-w-md flex-col gap-2 sm:flex-row">
            <Button size="lg" className="w-full sm:w-auto sm:flex-1" onClick={() => window.print()}>
              <Printer className="size-5" /> طباعة البطاقة
            </Button>
            <Button size="lg" variant="outline" className="w-full sm:w-auto sm:flex-1" onClick={() => setLostOpen(true)}>
              <AlertTriangle className="size-5" /> الإبلاغ عن فقدان
            </Button>
          </div>

          <Card className="mx-auto mt-6 max-w-md">
            <CardBody className="space-y-3 text-sm leading-7 text-muted">
              <p className="flex items-start gap-2">
                <Info className="mt-1 size-4 shrink-0 text-brand-600" />
                من يمسح الرمز دون حساب طبي في حياة لن يرى شيئاً من ملفك.
              </p>
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-1 size-4 shrink-0 text-brand-600" />
                الطبيب يحتاج موافقتك لرؤية سجلاتك من المنشآت الأخرى، وكل اطلاع يُسجَّل وتراه في «المشاركة».
              </p>
            </CardBody>
          </Card>

          {/* Printable card (ID-1 size). Hidden on screen. */}
          <div className="hayat-print-card hidden"
            style={{ width: "85.6mm", height: "54mm", border: "0.3mm solid #c6d2cf", borderRadius: "3mm", padding: "4mm",
              boxSizing: "border-box", background: "#fff", color: "#0f1f1d", gap: "4mm", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "2mm" }}>
                <LogoMark className="size-6" />
                <div style={{ fontSize: "9pt", fontWeight: 700 }}>حياة · HAYAT</div>
              </div>
              <div style={{ marginTop: "auto", fontSize: "7pt", color: "#51625f" }}>الاسم</div>
              <div style={{ fontSize: "10pt", fontWeight: 700, lineHeight: 1.3 }}>{patient.full_name}</div>
              <div style={{ marginTop: "2mm", fontSize: "7pt", color: "#51625f" }}>الرقم الصحي</div>
              <div className="num" style={{ fontSize: "12pt", fontWeight: 700, letterSpacing: "0.08em" }}>{patient.health_number}</div>
              <div style={{ marginTop: "auto", fontSize: "6pt", color: "#7c8b88" }}>امسح الرمز داخل تطبيق حياة لفتح الملف</div>
            </div>
            <QRCodeSVG value={card.data!.qr_url} size={150} level="M" marginSize={0}
              style={{ width: "32mm", height: "32mm", flexShrink: 0 }} />
          </div>
        </>
      )}

      <Dialog open={lostOpen} onOpenChange={setLostOpen}>
        <DialogContent size="sm" title="الإبلاغ عن فقدان البطاقة"
          footer={
            <>
              <Button variant="ghost" onClick={() => setLostOpen(false)}>إلغاء</Button>
              <Button variant="danger" loading={replace.isPending} onClick={() => replace.mutate()}>
                <RefreshCw className="size-4" /> إبطال وإصدار رمز جديد
              </Button>
            </>
          }>
          <div className="space-y-4">
            <div className="rounded-2xl bg-warning-soft p-4 text-sm leading-7 text-fg">
              <p>سيتوقف رمز البطاقة الحالية عن العمل <strong>فوراً</strong>، ويصدر رمز جديد تطبعه أو تعرضه من هاتفك.</p>
              <p className="mt-2">
                <strong>رقمك الصحي لا يتغير</strong>: <span className="num font-semibold">{patient.health_number}</span>. ويبقى ملفك وسجلاتك كما هي.
              </p>
            </div>
            <Field label="ماذا حدث للبطاقة؟">
              <ChoiceChips options={reasons.map((r) => ({ value: r.value, label: r.label }))}
                value={reason} onChange={(v) => setReason(v as Reason)} />
            </Field>
            <Field label="تفاصيل" optional htmlFor="lost-details">
              <Textarea id="lost-details" rows={2} maxLength={150} value={details}
                onChange={(e) => setDetails(e.target.value)} />
            </Field>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
