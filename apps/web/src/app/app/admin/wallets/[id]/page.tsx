"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, CircleDollarSign, Power, Scale, Sparkles, Tag, Wallet } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { balanceLabel, Money, PAYMENT_METHOD, TX_KIND } from "@/components/billing/money";
import { Statement } from "@/components/billing/statement";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceChips, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Card, CardHeader, ErrorState, Skeleton } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { label } from "@/lib/i18n";

type DialogKind = "payment" | "adjust" | "price" | "ai" | null;

export default function DoctorWalletPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const [reversing, setReversing] = React.useState<Schemas["Transaction"] | null>(null);
  const summary = useQuery({
    queryKey: ["billing", "wallet", id],
    queryFn: () => unwrap(api.GET("/api/v1/billing/admin/practitioners/{id}", { params: { path: { id } } })),
  });
  const txs = useQuery({
    queryKey: ["billing", "wallet", id, "tx", page],
    queryFn: () => unwrap(api.GET("/api/v1/billing/admin/practitioners/{id}/transactions", {
      params: { path: { id }, query: { page } as never } })),
    placeholderData: keepPreviousData,
  });
  const events = useQuery({
    queryKey: ["billing", "wallet", id, "events"],
    queryFn: () => unwrap(api.GET("/api/v1/billing/admin/practitioners/{id}/ai-access-events", { params: { path: { id } } })),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["billing"] });

  if (summary.isLoading) return <div className="space-y-4"><Skeleton className="h-40 rounded-card" /><Skeleton className="h-80 rounded-card" /></div>;
  if (summary.isError || !summary.data) return <ErrorState message={errorMessage(summary.error)} />;
  const s = summary.data;
  const negative = Number(s.balance) < 0;
  const pages = txs.data ? Math.max(1, Math.ceil(txs.data.count / 20)) : 1;

  return (
    <div className="animate-fade-up">
      <PageHeader back="/app/admin/wallets" eyebrow="محفظة طبيب" title={s.name}
        description={label("specialties", s.specialty)}
        actions={<>
          <Button onClick={() => setDialog("payment")}><BadgeDollarSign className="size-4" /> تسجيل دفعة</Button>
          <Button variant="outline" onClick={() => setDialog("adjust")}><Scale className="size-4" /> تسوية</Button>
          <Button variant="outline" onClick={() => setDialog("price")}><Tag className="size-4" /> تعديل السعر</Button>
        </>} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className={cn("p-4", negative ? "border-danger/30" : "border-success/30")}>
          <div className="flex items-center gap-2 text-xs text-muted"><Wallet className="size-4" /> الرصيد</div>
          <div className="mt-1 text-2xl font-bold"><Money value={s.balance} colored /></div>
          <div className="text-xs text-subtle">{balanceLabel(s.balance).replace("لصالحك", "لصالح الطبيب")}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">الدين الحالي</div>
          <div className={cn("mt-1 text-2xl font-bold", negative && "text-danger")}><Money value={s.amount_due} /></div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">إجمالي المدفوعات</div>
          <div className="mt-1 text-2xl font-bold"><Money value={s.total_payments} /></div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">إجمالي الاستهلاك</div>
          <div className="mt-1 text-2xl font-bold"><Money value={s.total_charges} /></div>
          <div className="text-xs text-subtle"><span className="num">{s.billable_minutes}</span> دقيقة · {s.sessions} جلسة</div>
        </Card>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="flex flex-wrap items-center gap-4 p-5">
          <div className={cn("grid size-12 place-items-center rounded-2xl", s.ai_enabled ? "bg-success-soft text-success" : "bg-sunken text-subtle")}>
            <Sparkles className="size-6" />
          </div>
          <div className="flex-1">
            <div className="font-semibold">HayatTek AI {s.ai_enabled ? "مفعل" : "موقوف"}</div>
            <div className="text-xs text-muted">يُستخدم بغض النظر عن الدين. الإيقاف يدوي فقط ويمنع بدء جلسات جديدة.</div>
          </div>
          <Button variant={s.ai_enabled ? "danger" : "primary"} onClick={() => setDialog("ai")}>
            <Power className="size-4" /> {s.ai_enabled ? "إيقاف الخدمة" : "تفعيل الخدمة"}
          </Button>
        </Card>
        <Card className="flex flex-wrap items-center gap-4 p-5">
          <CircleDollarSign className="size-8 text-brand-600" />
          <div className="flex-1">
            <div className="text-xs text-muted">سعر الاستخدام — {s.plan_name}</div>
            <div className="text-xl font-bold"><Money value={s.price_per_minute} /> <span className="text-xs font-normal text-muted">/دقيقة</span></div>
          </div>
          <div className="text-end text-xs text-muted">
            <div>تكلفة المزود: <Money value={s.provider_cost} /></div>
            <div>الهامش: <Money value={s.margin} colored /></div>
          </div>
        </Card>
      </div>

      <Card className="mb-5">
        <CardHeader title="كشف الحساب" description="كل عملية تبقى محفوظة؛ التصحيح بعملية عكسية موثقة." />
        <div className="p-2 pt-4">
          {txs.isLoading ? <Skeleton className="h-40" /> : <Statement rows={txs.data?.results ?? []} receiptScope="admin" onReverse={setReversing} />}
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 border-t border-line p-3 text-sm">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>الأحدث</Button>
            <span className="num text-muted">{page} / {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>الأقدم</Button>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="سجل تفعيل الخدمة" />
        <ul className="divide-y divide-line p-4 pt-2 text-sm">
          {(events.data ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <Badge tone={e.enabled ? "success" : "neutral"}>{e.enabled ? "تفعيل" : "إيقاف"}</Badge>
              <span>{e.changed_by_name ?? "النظام"}</span>
              {e.reason && <span className="text-muted">— {e.reason}</span>}
              <span className="ms-auto text-xs text-subtle">{formatDateTime(e.created_at)}</span>
            </li>
          ))}
          {!events.data?.length && <li className="py-3 text-subtle">لم تُفعّل الخدمة لهذا الطبيب بعد.</li>}
        </ul>
      </Card>

      <PaymentDialog open={dialog === "payment"} onClose={() => setDialog(null)} id={id} due={s.amount_due} onDone={refresh} />
      <AdjustDialog open={dialog === "adjust"} onClose={() => setDialog(null)} id={id} onDone={refresh} />
      <PriceDialog open={dialog === "price"} onClose={() => setDialog(null)} id={id} current={s.price_per_minute} onDone={refresh} />
      <AiDialog open={dialog === "ai"} onClose={() => setDialog(null)} id={id} enabled={s.ai_enabled} onDone={refresh} />
      <ReverseDialog tx={reversing} onClose={() => setReversing(null)} onDone={refresh} />
    </div>
  );
}

function PaymentDialog({ open, onClose, id, due, onDone }: { open: boolean; onClose: () => void; id: string; due: string; onDone: () => void }) {
  const [form, setForm] = React.useState({ amount: "", paid_at: "", method: "cash", reference: "", notes: "" });
  const key = React.useMemo(() => (open ? `${Date.now()}-${Math.random().toString(36).slice(2)}` : ""), [open]);
  const [result, setResult] = React.useState<Schemas["PaymentResult"] | null>(null);
  const pay = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/billing/admin/practitioners/{id}/payments", {
      params: { path: { id } },
      body: { amount: form.amount, currency: "USD", method: form.method, reference: form.reference, notes: form.notes,
              paid_at: form.paid_at ? new Date(form.paid_at).toISOString() : null, idempotency_key: key } as never,
    })),
    onSuccess: (r) => { setResult(r); onDone(); toast.success("سُجّلت الدفعة"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const close = () => { onClose(); setResult(null); setForm({ amount: "", paid_at: "", method: "cash", reference: "", notes: "" }); };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title="تسجيل دفعة مستلمة" description={<>استلمت نقداً أو بتحويل خارج المنصة. الدين الحالي: <Money value={due} /></>}
        footer={result ? <>
          <Button asChild variant="outline"><Link href={`/print/receipt/${result.transaction.id}?scope=admin`} target="_blank">طباعة الإيصال</Link></Button>
          <Button onClick={close}>تم</Button></> : <>
          <Button variant="ghost" onClick={close}>إلغاء</Button>
          <Button loading={pay.isPending} disabled={!(Number(form.amount) > 0)} onClick={() => pay.mutate()}>تأكيد</Button></>}>
        {result ? (
          <div className="space-y-2 text-center">
            <div className="text-sm text-muted">إيصال رقم <span className="num font-semibold text-fg">{result.transaction.receipt_number}</span></div>
            <div className="text-sm">الرصيد بعد الدفعة: <Money value={result.balance} colored className="font-bold" /></div>
            <div className="text-sm">المتبقي على الطبيب: <Money value={result.amount_due} className="font-bold" /></div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="المبلغ المستلم (USD)"><Input autoFocus dir="ltr" inputMode="decimal" className="num text-lg" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, "") })} /></Field>
            <Field label="تاريخ الدفع" optional><Input type="datetime-local" value={form.paid_at} onChange={(e) => setForm({ ...form, paid_at: e.target.value })} /></Field>
            <Field label="طريقة الدفع" className="sm:col-span-2">
              <ChoiceChips value={form.method} onChange={(v) => setForm({ ...form, method: v as string })}
                options={Object.entries(PAYMENT_METHOD).map(([value, l]) => ({ value, label: l }))} />
            </Field>
            <Field label="رقم مرجع" optional><Input dir="ltr" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
            <Field label="ملاحظات" optional><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ open, onClose, id, onDone }: { open: boolean; onClose: () => void; id: string; onDone: () => void }) {
  const [kind, setKind] = React.useState("credit_grant");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const run = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/billing/admin/practitioners/{id}/adjustments", {
      params: { path: { id } }, body: { kind, amount, reason } as never })),
    onSuccess: () => { onDone(); onClose(); setAmount(""); setReason(""); toast.success("سُجّلت التسوية"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const hints: Record<string, string> = {
    credit_grant: "يضيف رصيداً لصالح الطبيب (يقلل دينه).", manual_debit: "يزيد دين الطبيب.",
    charge_correction: "يلغي جزءاً من رسوم خاطئة (يقلل الدين).", refund: "أعدنا مالاً للطبيب (يقلل رصيده الدائن).",
    settlement: "مبلغ بإشارة: موجب لصالح الطبيب، سالب عليه.",
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="تسوية مالية موثقة" description="لا تُحذف أي عملية ولا تُعدّل قيمتها؛ كل تسوية قيد جديد بسبب مكتوب."
        footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button loading={run.isPending} disabled={!amount || reason.trim().length < 3} onClick={() => run.mutate()}>تسجيل</Button></>}>
        <div className="space-y-4">
          <Field label="النوع" hint={hints[kind]}>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {["credit_grant", "manual_debit", "charge_correction", "refund", "settlement"].map((k) => <option key={k} value={k}>{TX_KIND[k]}</option>)}
            </Select>
          </Field>
          <Field label="المبلغ (USD)"><Input dir="ltr" className="num" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={kind === "settlement" ? "-25.00 أو 25.00" : "25.00"} /></Field>
          <Field label="السبب"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PriceDialog({ open, onClose, id, current, onDone }: { open: boolean; onClose: () => void; id: string; current: string; onDone: () => void }) {
  const [mode, setMode] = React.useState<"custom" | "plan">("custom");
  const [price, setPrice] = React.useState(current);
  const [rounding, setRounding] = React.useState("ceil_minute");
  const [planId, setPlanId] = React.useState("");
  const plans = useQuery({ queryKey: ["billing", "plans"], queryFn: () => unwrap(api.GET("/api/v1/billing/admin/plans")), enabled: open });
  const run = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/billing/admin/practitioners/{id}/price", {
      params: { path: { id } },
      body: (mode === "plan" ? { plan_id: planId } : { price_per_minute: price, rounding_mode: rounding }) as never })),
    onSuccess: () => { onDone(); onClose(); toast.success("حُدّث السعر للجلسات القادمة"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="سعر الاستخدام لهذا الطبيب" description="يسري من الآن على الجلسات الجديدة فقط؛ الرسوم السابقة لا تتغير."
        footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button loading={run.isPending} onClick={() => run.mutate()}>حفظ</Button></>}>
        <div className="space-y-4">
          <ChoiceChips value={mode} onChange={(v) => setMode(v as typeof mode)} options={[{ value: "custom", label: "سعر خاص" }, { value: "plan", label: "خطة موجودة" }]} />
          {mode === "custom" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="سعر الدقيقة (USD)"><Input dir="ltr" className="num" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
              <Field label="التقريب">
                <Select value={rounding} onChange={(e) => setRounding(e.target.value)}>
                  <option value="ceil_minute">لأعلى دقيقة</option><option value="ceil_half_minute">لأعلى نصف دقيقة</option><option value="per_second">بالثانية</option>
                </Select>
              </Field>
            </div>
          ) : (
            <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">اختر خطة</option>
              {(plans.data ?? []).filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name} — {p.price_per_minute} $/د</option>)}
            </Select>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AiDialog({ open, onClose, id, enabled, onDone }: { open: boolean; onClose: () => void; id: string; enabled: boolean; onDone: () => void }) {
  const [reason, setReason] = React.useState("");
  const run = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/billing/admin/practitioners/{id}/ai-access", {
      params: { path: { id } }, body: { enabled: !enabled, reason } })),
    onSuccess: () => { onDone(); onClose(); setReason(""); toast.success(enabled ? "أُوقفت الخدمة" : "فُعّلت الخدمة"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={enabled ? "إيقاف HayatTek AI لهذا الطبيب؟" : "تفعيل HayatTek AI لهذا الطبيب؟"}
        description={enabled ? "يُمنع بدء جلسات جديدة. الجلسات قيد المعالجة تكتمل وتُحتسب مرة واحدة." : "يستطيع الطبيب استخدام الخدمة فوراً، بغض النظر عن رصيده."}
        footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant={enabled ? "danger" : "primary"} loading={run.isPending} onClick={() => run.mutate()}>{enabled ? "إيقاف" : "تفعيل"}</Button></>}>
        <Field label="السبب" optional><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </DialogContent>
    </Dialog>
  );
}

function ReverseDialog({ tx, onClose, onDone }: { tx: Schemas["Transaction"] | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = React.useState("");
  const run = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/billing/admin/transactions/{id}/reverse", {
      params: { path: { id: tx!.id } }, body: { reason } })),
    onSuccess: () => { onDone(); onClose(); setReason(""); toast.success("سُجّلت عملية عكسية"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={!!tx} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="عكس العملية" description={tx ? <>{TX_KIND[tx.kind]} بقيمة <Money value={tx.amount} signed /> — تبقى العملية الأصلية محفوظة وتُضاف عملية معاكسة.</> : ""}
        footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="danger" loading={run.isPending} disabled={reason.trim().length < 3} onClick={() => run.mutate()}>عكس</Button></>}>
        <Field label="سبب العكس"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </DialogContent>
    </Dialog>
  );
}
