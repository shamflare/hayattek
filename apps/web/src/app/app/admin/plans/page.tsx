"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Package, Pencil, Plus, Users, Wallet } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { Pager, ResponsiveList } from "@/components/admin/common";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceChips, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton, SkeletonList, type Tone } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";

type Plan = Schemas["SubscriptionPlan"];
type Sub = Schemas["Subscription"];
type SubStatus = Schemas["SubscriptionStatusEnum"];

const SUB_STATUS: Record<SubStatus, { text: string; tone: Tone }> = {
  trial: { text: "تجريبي", tone: "info" },
  active: { text: "فعال", tone: "success" },
  suspended: { text: "معلق", tone: "warning" },
  cancelled: { text: "ملغى", tone: "neutral" },
};

export default function PlansPage() {
  return (
    <React.Suspense fallback={<SkeletonList rows={5} />}>
      <PlansInner />
    </React.Suspense>
  );
}

function PlansInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const organization = params.get("organization") ?? "";
  const [page, setPage] = React.useState(1);
  const [planDialog, setPlanDialog] = React.useState<{ plan?: Plan } | null>(null);
  const [subDialog, setSubDialog] = React.useState<{ sub?: Sub } | null>(null);

  const plans = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: () => unwrap(api.GET("/api/v1/admin/plans", { params: { query: { page_size: 100 } } })),
  });
  const orgs = useQuery({
    queryKey: ["admin", "organizations", "all"],
    queryFn: () => unwrap(api.GET("/api/v1/admin/organizations", { params: { query: { page_size: 100 } } })),
  });
  const subs = useQuery({
    queryKey: ["admin", "subscriptions", "list", { organization, page }],
    queryFn: () => unwrap(api.GET("/api/v1/admin/subscriptions", {
      params: { query: { organization: organization || undefined, page } },
    })),
  });

  const orgName = (id: string) => orgs.data?.results.find((o) => o.id === id)?.name ?? "منشأة";
  const setOrganization = (value: string) => {
    setPage(1);
    router.replace(value ? `${pathname}?organization=${value}` : pathname);
  };
  const planList = plans.data?.results ?? [];
  const subList = subs.data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow="إدارة المنصة"
        title="الباقات والاشتراكات"
        description="تنظيم اشتراكات المنشآت. الدفع يتم خارج المنصة حالياً ولا تُسجل هنا أي مبالغ."
      />

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">الباقات</h2>
          <Button size="sm" variant="outline" onClick={() => setPlanDialog({})}><Plus className="size-4" /> باقة جديدة</Button>
        </div>
        {plans.error ? (
          <ErrorState message={errorMessage(plans.error)} onRetry={() => plans.refetch()} />
        ) : plans.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-card" />)}</div>
        ) : planList.length === 0 ? (
          <Card><EmptyState icon={<Package className="size-6" />} title="لا توجد باقات" description="أنشئ باقة لتتمكن من ربط المنشآت بها." /></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {planList.map((p) => (
              <Card key={p.id} className={p.is_active ? "p-5" : "p-5 opacity-70"}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-subtle"><span className="num">{p.code}</span></div>
                  </div>
                  <div className="flex items-center gap-1">
                    {!p.is_active && <Badge>موقوفة</Badge>}
                    <Button variant="ghost" size="icon" aria-label="تعديل" onClick={() => setPlanDialog({ plan: p })}>
                      <Pencil className="size-4" />
                    </Button>
                  </div>
                </div>
                {p.description && <p className="mt-2 text-sm text-muted">{p.description}</p>}
                <div className="mt-4 flex flex-wrap gap-2 text-sm">
                  <Badge tone="brand"><Users className="size-3" /> {p.max_members ? <><span className="num">{p.max_members}</span> عضو كحد أقصى</> : "أعضاء غير محدودين"}</Badge>
                  {p.monthly_price_note && <Badge>{p.monthly_price_note}</Badge>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader
          title="الاشتراكات"
          icon={<Wallet className="size-[18px]" />}
          action={<Button size="sm" onClick={() => setSubDialog({})} disabled={!planList.length}><Plus className="size-4" /> اشتراك</Button>}
        />
        <CardBody className="pb-0">
          <Select value={organization} onChange={(e) => setOrganization(e.target.value)} aria-label="المنشأة" className="sm:max-w-sm">
            <option value="">كل المنشآت</option>
            {orgs.data?.results.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </CardBody>
        <div className="mt-4 border-t border-line">
          {subs.error ? (
            <div className="p-4"><ErrorState message={errorMessage(subs.error)} onRetry={() => subs.refetch()} /></div>
          ) : subs.isLoading ? (
            <div className="p-5"><SkeletonList rows={4} /></div>
          ) : subList.length === 0 ? (
            <EmptyState icon={<CalendarRange className="size-6" />} title="لا توجد اشتراكات" description={organization ? "لا يوجد اشتراك مسجل لهذه المنشأة." : undefined} />
          ) : (
            <ResponsiveList<Sub>
              items={subList}
              rowKey={(s) => s.id}
              head={["المنشأة", "الباقة", "الفترة", "الحالة", ""]}
              row={(s) => [
                <span key="o" className="font-medium">{orgName(s.organization)}</span>,
                s.plan_name,
                <Period key="p" sub={s} />,
                <SubBadge key="s" status={s.status} />,
                <Button key="e" size="sm" variant="ghost" onClick={() => setSubDialog({ sub: s })}><Pencil className="size-4" /> تعديل</Button>,
              ]}
              card={(s) => (
                <button className="w-full space-y-1 text-start" onClick={() => setSubDialog({ sub: s })}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{orgName(s.organization)}</span>
                    <SubBadge status={s.status} />
                  </div>
                  <div className="text-sm text-muted">{s.plan_name} · <Period sub={s} /></div>
                </button>
              )}
            />
          )}
          {subs.data && <div className="px-4 pb-4"><Pager page={page} count={subs.data.count} onPage={setPage} /></div>}
        </div>
      </Card>

      <PlanDialog state={planDialog} onClose={() => setPlanDialog(null)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin", "plans"] })} />
      <SubscriptionDialog state={subDialog} onClose={() => setSubDialog(null)} plans={planList}
        orgs={orgs.data?.results ?? []} defaultOrganization={organization}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin", "subscriptions"] })} />
    </>
  );
}

function SubBadge({ status }: { status?: SubStatus }) {
  const s = SUB_STATUS[status ?? "trial"];
  return <Badge tone={s.tone} dot>{s.text}</Badge>;
}

function Period({ sub }: { sub: Sub }) {
  return (
    <span className="text-muted">
      {formatDate(sub.starts_on)}
      {" ← "}
      {sub.ends_on ? formatDate(sub.ends_on) : "مفتوح"}
    </span>
  );
}

function PlanDialog({ state, onClose, onSaved }: { state: { plan?: Plan } | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      {state && <PlanForm plan={state.plan} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function PlanForm({ plan, onClose, onSaved }: { plan?: Plan; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = React.useState(() => ({
    code: plan?.code ?? "", name: plan?.name ?? "", description: plan?.description ?? "",
    max_members: plan?.max_members != null ? String(plan.max_members) : "",
    monthly_price_note: plan?.monthly_price_note ?? "", is_active: plan?.is_active ?? true,
  }));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) return setError("أدخل الرمز والاسم.");
    const body = {
      code: form.code.trim(), name: form.name.trim(), description: form.description.trim(),
      max_members: form.max_members ? Number(form.max_members) : null,
      monthly_price_note: form.monthly_price_note.trim(), is_active: form.is_active,
    };
    setSaving(true);
    setError(null);
    try {
      if (plan) await unwrap(api.PATCH("/api/v1/admin/plans/{id}", { params: { path: { id: plan.id } }, body }));
      else await unwrap(api.POST("/api/v1/admin/plans", { body }));
      toast.success(plan ? "حُفظت الباقة" : "أُنشئت الباقة");
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
      <DialogContent title={plan ? "تعديل الباقة" : "باقة جديدة"}
        footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button type="submit" form="plan-form" loading={saving}>حفظ</Button></>}>
        <form id="plan-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="الاسم" htmlFor="p-name"><Input id="p-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="الرمز" htmlFor="p-code" hint="أحرف لاتينية وشرطات، مثل starter">
            <Input id="p-code" dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="الوصف" optional htmlFor="p-desc" className="sm:col-span-2">
            <Textarea id="p-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="الحد الأقصى للأعضاء" optional htmlFor="p-max" hint="اتركه فارغاً لغير محدود.">
            <Input id="p-max" type="number" min={1} dir="ltr" value={form.max_members} onChange={(e) => setForm({ ...form, max_members: e.target.value })} />
          </Field>
          <Field label="ملاحظة السعر" optional htmlFor="p-price" hint="نص توضيحي فقط، لا تُحصّل مدفوعات.">
            <Input id="p-price" value={form.monthly_price_note} onChange={(e) => setForm({ ...form, monthly_price_note: e.target.value })} />
          </Field>
          <Field label="الحالة" className="sm:col-span-2">
            <ChoiceChips options={[{ value: "on", label: "متاحة" }, { value: "off", label: "موقوفة" }]}
              value={form.is_active ? "on" : "off"} onChange={(v) => setForm({ ...form, is_active: v === "on" })} />
          </Field>
          {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">{error}</p>}
        </form>
      </DialogContent>
  );
}

function SubscriptionDialog(props: SubDialogProps) {
  return (
    <Dialog open={!!props.state} onOpenChange={(o) => !o && props.onClose()}>
      {props.state && <SubscriptionForm {...props} sub={props.state.sub} />}
    </Dialog>
  );
}

interface SubDialogProps {
  state: { sub?: Sub } | null; onClose: () => void; onSaved: () => void;
  plans: Plan[]; orgs: Schemas["Organization"][]; defaultOrganization: string;
}

function SubscriptionForm({
  sub, onClose, onSaved, plans, orgs, defaultOrganization,
}: SubDialogProps & { sub?: Sub }) {
  const [form, setForm] = React.useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      organization: sub?.organization ?? defaultOrganization, plan: sub?.plan ?? plans.find((p) => p.is_active)?.id ?? "",
      status: (sub?.status ?? "trial") as SubStatus, starts_on: sub?.starts_on ?? today, ends_on: sub?.ends_on ?? "", notes: sub?.notes ?? "",
    };
  });
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.organization || !form.plan || !form.starts_on) return setError("اختر المنشأة والباقة وتاريخ البدء.");
    if (form.ends_on && form.ends_on < form.starts_on) return setError("تاريخ الانتهاء قبل تاريخ البدء.");
    const body = { ...form, ends_on: form.ends_on || null, notes: form.notes.trim() };
    setSaving(true);
    setError(null);
    try {
      if (sub) await unwrap(api.PATCH("/api/v1/admin/subscriptions/{id}", { params: { path: { id: sub.id } }, body }));
      else await unwrap(api.POST("/api/v1/admin/subscriptions", { body }));
      toast.success("حُفظ الاشتراك");
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
      <DialogContent title={sub ? "تعديل الاشتراك" : "اشتراك جديد"}
        description="تعليق الاشتراك هنا لا يعلّق المنشأة تلقائياً؛ استخدم صفحة المنشأة لذلك."
        footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button type="submit" form="sub-form" loading={saving}>حفظ</Button></>}>
        <form id="sub-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="المنشأة" htmlFor="s-org" className="sm:col-span-2">
            <Select id="s-org" value={form.organization} disabled={!!sub} onChange={(e) => setForm({ ...form, organization: e.target.value })}>
              <option value="">اختر المنشأة…</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
          <Field label="الباقة" htmlFor="s-plan">
            <Select id="s-plan" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
              <option value="">اختر…</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="الحالة" htmlFor="s-status">
            <Select id="s-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SubStatus })}>
              {(Object.keys(SUB_STATUS) as SubStatus[]).map((s) => <option key={s} value={s}>{SUB_STATUS[s].text}</option>)}
            </Select>
          </Field>
          <Field label="تاريخ البدء" htmlFor="s-start">
            <Input id="s-start" type="date" dir="ltr" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} />
          </Field>
          <Field label="تاريخ الانتهاء" optional htmlFor="s-end">
            <Input id="s-end" type="date" dir="ltr" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
          </Field>
          <Field label="ملاحظات" optional htmlFor="s-notes" className="sm:col-span-2">
            <Input id="s-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-2">{error}</p>}
        </form>
      </DialogContent>
  );
}
