"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FilterX, ShieldAlert, ShieldCheck } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Pager, ResponsiveList, usePageFor } from "@/components/admin/common";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge, Card, EmptyState, ErrorState, SkeletonList, type Tone } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { m } from "@/lib/i18n";

type Event = Schemas["AuditEvent"];

/** Actions recorded by the backend (apps.audit.services.Action). Labels come from i18n, raw code as fallback. */
const ACTIONS = [
  "auth.login", "auth.login_failed", "auth.logout", "auth.password_changed", "auth.mfa_changed",
  "patient.create", "patient.view", "patient.update", "patient.search", "patient.register",
  "card.resolve", "card.issue", "card.revoke",
  "record.view", "record.create", "record.update_draft", "record.finalize", "record.amend",
  "record.entered_in_error", "record.print", "document.upload", "document.download",
  "grant.create", "grant.revoke", "access.request", "access.decision", "access.denied",
  "membership.change", "organization.change", "practitioner.verify", "export",
];
/**
 * Actions the shared dictionary (lib/i18n auditActions) does not label yet.
 * TODO: move these into ar.ts auditActions and drop this table.
 */
const PENDING_LABELS: Record<string, string> = {
  "auth.login": "تسجيل دخول",
  "auth.login_failed": "محاولة دخول فاشلة",
  "auth.logout": "تسجيل خروج",
  "auth.password_changed": "تغيير كلمة المرور",
  "auth.mfa_changed": "تغيير المصادقة الثنائية",
  "patient.search": "بحث عن مريض",
  "membership.change": "تعديل عضوية",
  "organization.change": "تعديل منشأة",
  "practitioner.verify": "قرار اعتماد طبيب",
  export: "تصدير",
};
const actionLabel = (a: string) => m.auditActions[a] ?? PENDING_LABELS[a] ?? a;

const FILTERS = ["action", "outcome", "organization_id", "actor_id", "patient_id"] as const;
type FilterKey = (typeof FILTERS)[number];

const OUTCOMES: Record<string, { text: string; tone: Tone }> = {
  success: { text: "نجاح", tone: "success" },
  denied: { text: "مرفوض", tone: "danger" },
  failure: { text: "فشل", tone: "warning" },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AuditPage() {
  return (
    <React.Suspense fallback={<SkeletonList rows={8} />}>
      <AuditInner />
    </React.Suspense>
  );
}

function AuditInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ""])) as Record<FilterKey, string>;
  const [page, setPage] = usePageFor(params.toString());
  const [moreFilters, setMoreFilters] = React.useState(false);

  const setFilters = (patch: Partial<Record<FilterKey, string>>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const orgs = useQuery({
    queryKey: ["admin", "organizations", "all"],
    queryFn: () => unwrap(api.GET("/api/v1/admin/organizations", { params: { query: { page_size: 100 } } })),
  });
  const orgName = (id?: string | null) => (id ? orgs.data?.results.find((o) => o.id === id)?.name : null);

  const { data, isLoading, error, refetch, isPlaceholderData } = useQuery({
    queryKey: ["admin", "audit", filters, page],
    queryFn: () => unwrap(api.GET("/api/v1/admin/audit", {
      params: {
        query: {
          page,
          ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
        },
      },
    })),
    placeholderData: keepPreviousData,
  });
  const events = data?.results ?? [];
  const active = FILTERS.some((k) => filters[k]);


  const idChip = (key: "actor_id" | "patient_id" | "organization_id", value?: string | null, text?: string | null) =>
    value ? (
      <button type="button" title={value} onClick={() => setFilters({ [key]: value })}
        className="num rounded-md bg-sunken px-1.5 py-0.5 text-xs text-muted hover:text-brand-600">
        {text ?? `…${value.slice(-8)}`}
      </button>
    ) : <span className="text-subtle">—</span>;

  return (
    <>
      <PageHeader
        eyebrow="إدارة المنصة"
        title="السجل الأمني"
        description="سجل غير قابل للتعديل لعمليات الدخول والوصول. يحتوي معرّفات فقط ولا يحتوي أي نص طبي."
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="العملية" htmlFor="f-action" className="col-span-2 sm:col-span-1">
            <Select id="f-action" value={filters.action} onChange={(e) => setFilters({ action: e.target.value })}>
              <option value="">كل العمليات</option>
              {ACTIONS.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}
            </Select>
          </Field>
          <Field label="النتيجة" htmlFor="f-outcome">
            <Select id="f-outcome" value={filters.outcome} onChange={(e) => setFilters({ outcome: e.target.value })}>
              <option value="">الكل</option>
              {Object.entries(OUTCOMES).map(([v, o]) => <option key={v} value={v}>{o.text}</option>)}
            </Select>
          </Field>
          <Field label="المنشأة" htmlFor="f-org">
            <Select id="f-org" value={filters.organization_id} onChange={(e) => setFilters({ organization_id: e.target.value })}>
              <option value="">كل المنشآت</option>
              {orgs.data?.results.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
        </div>
        <button type="button" onClick={() => setMoreFilters((v) => !v)}
          className="mt-3 text-sm font-medium text-brand-600 sm:hidden">
          {moreFilters ? "إخفاء البحث بالمعرّف" : "بحث بمعرّف المستخدم أو المريض"}
        </button>
        <div className={cn(!moreFilters && !filters.actor_id && !filters.patient_id && "hidden sm:block")}>
        <IdFilters key={`${filters.actor_id}|${filters.patient_id}`} actorId={filters.actor_id} patientId={filters.patient_id}
          active={active} onApply={(v) => setFilters(v)} onClear={() => router.replace(pathname)} />
        </div>
      </Card>

      <Card>
        {error ? (
          <div className="p-4"><ErrorState message={errorMessage(error)} onRetry={() => refetch()} /></div>
        ) : isLoading ? (
          <div className="p-5"><SkeletonList rows={8} /></div>
        ) : events.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="size-6" />} title="لا توجد أحداث مطابقة"
            description={active ? "غيّر المرشحات لرؤية أحداث أخرى." : "لم تُسجل أي عملية بعد."} />
        ) : (
          <div className={cn(isPlaceholderData && "opacity-60")}>
            <ResponsiveList<Event>
              items={events}
              rowKey={(e) => e.id}
              head={["الوقت", "العملية", "النتيجة", "المستخدم", "المنشأة", "الهدف", "المريض", "IP"]}
              rowClassName={(e) => (e.outcome === "denied" ? "bg-danger-soft/70 hover:bg-danger-soft" : undefined)}
              row={(e) => [
                <span key="t" className="whitespace-nowrap text-muted">{formatDateTime(e.occurred_at)}</span>,
                <span key="a" className="flex items-center gap-1.5 font-medium">
                  {e.outcome === "denied" && <ShieldAlert className="size-4 text-danger" />}
                  {actionLabel(e.action)}
                </span>,
                <OutcomeBadge key="o" outcome={e.outcome} />,
                idChip("actor_id", e.actor_id),
                idChip("organization_id", e.organization_id, orgName(e.organization_id)),
                e.target_type ? <span key="g" className="text-xs text-muted" title={e.target_id}>{e.target_type.split(".").pop()}</span> : <span key="g" className="text-subtle">—</span>,
                idChip("patient_id", e.patient_id),
                <span key="i" className="num text-xs text-muted">{e.ip_address ?? "—"}</span>,
              ]}
              card={(e) => (
                <div className="space-y-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium">
                      {e.outcome === "denied" && <ShieldAlert className="size-4 text-danger" />}
                      {actionLabel(e.action)}
                    </span>
                    <OutcomeBadge outcome={e.outcome} />
                  </div>
                  <div className="text-xs text-muted">{formatDateTime(e.occurred_at)}{e.ip_address && <> · <span className="num">{e.ip_address}</span></>}</div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle">
                    <span>المستخدم {idChip("actor_id", e.actor_id)}</span>
                    {e.organization_id && <span>المنشأة {idChip("organization_id", e.organization_id, orgName(e.organization_id))}</span>}
                    {e.patient_id && <span>المريض {idChip("patient_id", e.patient_id)}</span>}
                  </div>
                </div>
              )}
            />
          </div>
        )}
        {data && <div className="px-4 pb-4"><Pager page={page} count={data.count} onPage={setPage} /></div>}
      </Card>
    </>
  );
}

function OutcomeBadge({ outcome }: { outcome?: string }) {
  const o = OUTCOMES[outcome ?? "success"] ?? { text: outcome ?? "—", tone: "neutral" as Tone };
  return <Badge tone={o.tone} dot>{o.text}</Badge>;
}

function IdFilters({
  actorId, patientId, active, onApply, onClear,
}: {
  actorId: string; patientId: string; active: boolean;
  onApply: (v: { actor_id: string; patient_id: string }) => void; onClear: () => void;
}) {
  const [ids, setIds] = React.useState({ actor_id: actorId, patient_id: patientId });
  const [error, setError] = React.useState<string | null>(null);
  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const bad = Object.values(ids).some((v) => v.trim() && !UUID.test(v.trim()));
    if (bad) return setError("المعرّف يجب أن يكون UUID كاملاً.");
    setError(null);
    onApply({ actor_id: ids.actor_id.trim(), patient_id: ids.patient_id.trim() });
  };
  return (
    <>
      <form onSubmit={apply} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="معرّف المستخدم" htmlFor="f-actor">
          <Input id="f-actor" dir="ltr" className="num" placeholder="UUID" value={ids.actor_id}
            onChange={(e) => setIds({ ...ids, actor_id: e.target.value })} />
        </Field>
        <Field label="معرّف المريض" htmlFor="f-patient">
          <Input id="f-patient" dir="ltr" className="num" placeholder="UUID" value={ids.patient_id}
            onChange={(e) => setIds({ ...ids, patient_id: e.target.value })} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" variant="secondary">تطبيق</Button>
          {active && (
            <Button type="button" variant="ghost" onClick={onClear}><FilterX className="size-4" /> مسح</Button>
          )}
        </div>
      </form>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </>
  );
}
