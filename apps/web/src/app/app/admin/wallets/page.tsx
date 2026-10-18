"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Info, Printer, Search, Settings2, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { Money } from "@/components/billing/money";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge, Card, EmptyState, ErrorState, Skeleton, SkeletonList } from "@/components/ui/surface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { label } from "@/lib/i18n";

export default function WalletsPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader title="المحافظ والمديونيات" description="محاسبة HayatTek AI بنظام آجل. الدين لا يوقف الخدمة أبداً؛ التفعيل والإيقاف يدوي من هنا فقط."
        actions={<>
          <Button asChild variant="outline"><a href="/api/v1/billing/admin/export.csv"><Download className="size-4" /> CSV</a></Button>
          <Button asChild variant="outline"><Link href="/print/billing/debts" target="_blank"><Printer className="size-4" /> PDF</Link></Button>
        </>} />
      <Overview />
      <Tabs defaultValue="doctors" dir="rtl">
        <TabsList className="mb-4 w-fit">
          <TabsTrigger value="doctors"><Wallet className="size-4" /> الأطباء</TabsTrigger>
          <TabsTrigger value="plans"><Sparkles className="size-4" /> خطط التسعير</TabsTrigger>
          <TabsTrigger value="settings"><Settings2 className="size-4" /> التنبيهات</TabsTrigger>
        </TabsList>
        <TabsContent value="doctors"><Doctors /></TabsContent>
        <TabsContent value="plans"><Plans /></TabsContent>
        <TabsContent value="settings"><AlertSettings /></TabsContent>
      </Tabs>
    </div>
  );
}

function Overview() {
  const ov = useQuery({ queryKey: ["billing", "overview"], queryFn: () => unwrap(api.GET("/api/v1/billing/admin/overview")) });
  const alerts = useQuery({ queryKey: ["billing", "alerts"], queryFn: () => unwrap(api.GET("/api/v1/billing/admin/alerts")) });
  if (ov.isLoading) return <Skeleton className="mb-6 h-36 rounded-card" />;
  if (ov.isError || !ov.data) return <ErrorState message={errorMessage(ov.error)} />;
  const o = ov.data;
  const tiles: [string, React.ReactNode, string?][] = [
    ["إجمالي الديون المستحقة", <Money key="d" value={o.total_debt} className={Number(o.total_debt) > 0 ? "text-danger" : undefined} />, `${o.debtor_count} طبيب مدين`],
    ["إجمالي المبالغ المحصلة", <Money key="c" value={o.total_collected} />],
    ["صافي أرصدة الأطباء", <Money key="b" value={o.total_balance} colored />, `${o.creditor_count} برصيد دائن`],
    ["إيرادات AI المفوترة", <Money key="r" value={o.ai_revenue} />, `${o.billed_sessions} جلسة`],
    ["تكلفة مزود الذكاء الاصطناعي", <Money key="p" value={o.provider_cost} />, `${o.failed_sessions} جلسة فاشلة غير مفوترة`],
    ["هامش الخدمة (قبل المصاريف)", <Money key="m" value={o.margin} colored />],
  ];
  return (
    <div className="mb-6 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(([title, value, hint]) => (
          <Card key={title} className="p-4">
            <div className="text-xs text-muted">{title}</div>
            <div className="mt-1.5 text-2xl font-bold">{value}</div>
            {hint && <div className="mt-0.5 text-xs text-subtle">{hint}</div>}
          </Card>
        ))}
      </div>
      {!!alerts.data?.length && (
        <Card className="border-warning/30 p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold text-warning"><AlertTriangle className="size-4" /> تنبيهات (للعلم فقط — لا توقف أي خدمة)</div>
          <ul className="space-y-1.5 text-sm">
            {alerts.data.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <Info className="mt-0.5 size-4 shrink-0 text-subtle" />
                {a.practitioner_id ? <Link href={`/app/admin/wallets/${a.practitioner_id}`} className="hover:text-brand-600">{a.message}</Link> : a.message}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Doctors() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [ai, setAi] = React.useState("");
  const [ordering, setOrdering] = React.useState("-debt");
  const query = useDebounced(q, 300);
  const rows = useQuery({
    queryKey: ["billing", "rows", query, status, ai, ordering],
    queryFn: () => unwrap(api.GET("/api/v1/billing/admin/practitioners", { params: { query: { q: query, status, ai, ordering } } })),
  });
  return (
    <Card>
      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="ps-9" placeholder="ابحث باسم الطبيب" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الأرصدة</option><option value="debtor">مدينون</option><option value="creditor">رصيد دائن</option><option value="zero">صفر</option>
        </Select>
        <Select value={ai} onChange={(e) => setAi(e.target.value)}>
          <option value="">كل الحالات</option><option value="on">AI مفعل</option><option value="off">AI موقوف</option>
        </Select>
        <Select value={ordering} onChange={(e) => setOrdering(e.target.value)}>
          <option value="-debt">الأعلى ديناً</option><option value="-total_charges">الأعلى استهلاكاً</option>
          <option value="-sessions">الأكثر جلسات</option><option value="name">الاسم</option>
        </Select>
      </div>
      {rows.isLoading ? <div className="p-4"><SkeletonList /></div> : rows.isError ? <ErrorState message={errorMessage(rows.error)} /> :
        !rows.data?.length ? <EmptyState icon={<Wallet className="size-6" />} title="لا يوجد أطباء مطابقون" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-sunken text-xs text-muted">
                <tr>{["الطبيب", "المنشأة", "سعر الدقيقة", "الجلسات", "إجمالي الرسوم", "المدفوعات", "الرصيد", "الدين الحالي", "آخر دفعة", "AI"].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-start font-medium">{h}</th>))}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.data.map((r) => (
                  <tr key={r.practitioner_id} className="hover:bg-sunken/50">
                    <td className="px-3 py-3">
                      <Link href={`/app/admin/wallets/${r.practitioner_id}`} className="font-medium hover:text-brand-600">{r.name}</Link>
                      <div className="text-xs text-muted">{label("specialties", r.specialty)}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted">{r.organizations.join("، ") || "—"}</td>
                    <td className="px-3 py-3"><Money value={r.price_per_minute} /></td>
                    <td className="num px-3 py-3">{r.sessions}</td>
                    <td className="px-3 py-3"><Money value={r.total_charges} /></td>
                    <td className="px-3 py-3"><Money value={r.total_payments} /></td>
                    <td className="px-3 py-3"><Money value={r.balance} colored /></td>
                    <td className="px-3 py-3 font-semibold"><Money value={r.debt} className={Number(r.debt) > 0 ? "text-danger" : "text-subtle"} /></td>
                    <td className="px-3 py-3 text-xs text-muted">{r.last_payment_at ? formatDate(r.last_payment_at) : "—"}</td>
                    <td className="px-3 py-3"><Badge tone={r.ai_enabled ? "success" : "neutral"} dot>{r.ai_enabled ? "مفعل" : "موقوف"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}

function Plans() {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["billing", "plans"], queryFn: () => unwrap(api.GET("/api/v1/billing/admin/plans")) });
  const [editing, setEditing] = React.useState<Partial<Schemas["PricingPlan"]> | null>(null);
  const save = useMutation({
    mutationFn: (p: Partial<Schemas["PricingPlan"]>) => p.id
      ? unwrap(api.PATCH("/api/v1/billing/admin/plans/{id}", { params: { path: { id: p.id } }, body: p as never }))
      : unwrap(api.POST("/api/v1/billing/admin/plans", { body: p as never })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["billing"] }); setEditing(null); toast.success("حُفظت الخطة — لا تتأثر الرسوم السابقة"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button onClick={() => setEditing({ rounding_mode: "ceil_minute", currency: "USD", is_active: true })}>خطة جديدة</Button></div>
      {(plans.data ?? []).map((p) => (
        <Card key={p.id} className="flex flex-wrap items-center gap-4 p-4">
          <div className="flex-1">
            <div className="font-semibold">{p.name} {p.is_default && <Badge tone="brand">الافتراضية</Badge>} {!p.is_active && <Badge>غير فعالة</Badge>}</div>
            <div className="text-xs text-muted"><span className="num">{p.code}</span> · {p.rounding_mode === "per_second" ? "بالثانية" : p.rounding_mode === "ceil_half_minute" ? "تقريب لنصف دقيقة" : "تقريب لدقيقة كاملة"}</div>
          </div>
          <div className="text-lg font-bold"><Money value={p.price_per_minute} /> <span className="text-xs font-normal text-muted">/دقيقة</span></div>
          <Button variant="outline" size="sm" onClick={() => setEditing(p)}>تعديل</Button>
        </Card>
      ))}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={editing?.id ? "تعديل خطة" : "خطة تسعير جديدة"} description="التعديل يسري على الجلسات الجديدة فقط؛ كل جلسة تحفظ السعر الذي طُبّق عليها."
          footer={<><Button variant="ghost" onClick={() => setEditing(null)}>إلغاء</Button><Button loading={save.isPending} onClick={() => editing && save.mutate(editing)}>حفظ</Button></>}>
          {editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="الاسم"><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="الرمز"><Input dir="ltr" value={editing.code ?? ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} /></Field>
              <Field label="سعر الدقيقة (USD)"><Input dir="ltr" inputMode="decimal" className="num" value={editing.price_per_minute ?? ""} onChange={(e) => setEditing({ ...editing, price_per_minute: e.target.value })} /></Field>
              <Field label="التقريب">
                <Select value={editing.rounding_mode} onChange={(e) => setEditing({ ...editing, rounding_mode: e.target.value as never })}>
                  <option value="ceil_minute">لأعلى دقيقة</option><option value="ceil_half_minute">لأعلى نصف دقيقة</option><option value="per_second">بالثانية</option>
                </Select>
              </Field>
              <Field label="الحد الأدنى للثواني المحاسبة" optional><Input inputMode="numeric" className="num" value={editing.minimum_billable_seconds ?? 0} onChange={(e) => setEditing({ ...editing, minimum_billable_seconds: Number(e.target.value) })} /></Field>
              <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" checked={!!editing.is_default} onChange={(e) => setEditing({ ...editing, is_default: e.target.checked })} /> الخطة الافتراضية</label>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AlertSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["billing", "settings"], queryFn: () => unwrap(api.GET("/api/v1/billing/admin/settings")) });
  const [form, setForm] = React.useState<Record<string, string | number> | null>(null);
  React.useEffect(() => { if (q.data && !form) setForm(q.data as never); }, [q.data, form]);
  const save = useMutation({
    mutationFn: () => unwrap(api.PATCH("/api/v1/billing/admin/settings", { body: form as never })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["billing"] }); toast.success("حُفظت إعدادات التنبيهات"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!form) return <Skeleton className="h-60 rounded-card" />;
  const field = (k: string, l: string) => (
    <Field label={l}><Input dir="ltr" className="num" value={String(form[k] ?? "")} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>
  );
  return (
    <Card className="space-y-4 p-5">
      <p className="rounded-xl bg-sunken p-3 text-sm text-muted">التنبيهات معلوماتية فقط. لا يوجد أي إيقاف تلقائي للخدمة بسبب الدين.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("doctor_debt_alert", "تنبيه عند تجاوز دين طبيب ($)")}
        {field("total_debt_alert", "تنبيه عند تجاوز إجمالي الديون ($)")}
        {field("monthly_provider_cost_alert", "تنبيه تكلفة المزود خلال 30 يوماً ($)")}
        {field("usage_spike_factor", "معامل الاستهلاك غير المعتاد (×المتوسط الأسبوعي)")}
        {field("overdue_days", "أيام التأخر عن السداد")}
      </div>
      <Button loading={save.isPending} onClick={() => save.mutate()}>حفظ</Button>
    </Card>
  );
}
