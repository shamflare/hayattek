"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Mail, MessageSquareText } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Pager, ResponsiveList, usePageFor } from "@/components/admin/common";
import { PageHeader } from "@/components/app/page-header";
import { Field, Select } from "@/components/ui/field";
import { Badge, Card, EmptyState, ErrorState, SkeletonList, type Tone } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";

type Message = Schemas["OutboundMessageAdmin"];

const STATUSES: Record<string, { text: string; tone: Tone }> = {
  queued: { text: "في الطابور", tone: "info" },
  sending: { text: "قيد الإرسال", tone: "info" },
  sent: { text: "أُرسلت", tone: "success" },
  failed: { text: "فشلت", tone: "danger" },
  not_configured: { text: "الخدمة غير مفعلة", tone: "warning" },
  suppressed: { text: "أوقفت (حد الإرسال)", tone: "neutral" },
};
const PURPOSES: Record<string, string> = {
  otp: "رمز تحقق",
  account_activation: "تفعيل حساب",
  password_reset: "استعادة كلمة المرور",
  notification: "إشعار",
};
const CHANNELS: Record<string, string> = { sms: "رسالة نصية", email: "بريد إلكتروني" };
const FILTERS = ["status", "channel", "purpose"] as const;
type FilterKey = (typeof FILTERS)[number];

export default function MessagesPage() {
  return (
    <React.Suspense fallback={<SkeletonList rows={8} />}>
      <MessagesInner />
    </React.Suspense>
  );
}

function MessagesInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ""])) as Record<FilterKey, string>;
  const [page, setPage] = usePageFor(params.toString());
  const setFilter = (key: FilterKey, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const stats = useQuery({
    queryKey: ["admin", "messages", "stats"],
    queryFn: () => unwrap(api.GET("/api/v1/admin/messages/stats")),
  });
  const { data, isLoading, error, refetch, isPlaceholderData } = useQuery({
    queryKey: ["admin", "messages", filters, page],
    queryFn: () => unwrap(api.GET("/api/v1/admin/messages", {
      params: { query: { page, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) } },
    })),
    placeholderData: keepPreviousData,
  });
  const rows = data?.results ?? [];
  const active = FILTERS.some((k) => filters[k]);

  return (
    <>
      <PageHeader
        eyebrow="إدارة المنصة"
        title="حالة الرسائل"
        description="متابعة إرسال الرسائل النصية والبريد. يظهر المستلم مخفياً جزئياً، ولا تُعرض نصوص الرسائل أو الرموز."
      />

      {stats.data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <ProviderCard icon={MessageSquareText} title="الرسائل النصية" provider={stats.data.sms_provider} configured={stats.data.sms_configured} />
          <ProviderCard icon={Mail} title="البريد الإلكتروني" provider={stats.data.email_provider} configured={stats.data.email_configured} />
        </div>
      )}

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="الحالة" htmlFor="f-status">
            <Select id="f-status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="">الكل</option>
              {Object.entries(STATUSES).map(([v, s]) => (
                <option key={v} value={v}>{s.text}{stats.data?.by_status[v] ? ` (${stats.data.by_status[v]})` : ""}</option>
              ))}
            </Select>
          </Field>
          <Field label="القناة" htmlFor="f-channel">
            <Select id="f-channel" value={filters.channel} onChange={(e) => setFilter("channel", e.target.value)}>
              <option value="">الكل</option>
              {Object.entries(CHANNELS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </Select>
          </Field>
          <Field label="الغرض" htmlFor="f-purpose" className="col-span-2 sm:col-span-1">
            <Select id="f-purpose" value={filters.purpose} onChange={(e) => setFilter("purpose", e.target.value)}>
              <option value="">الكل</option>
              {Object.entries(PURPOSES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        {error ? (
          <div className="p-4"><ErrorState message={errorMessage(error)} onRetry={() => refetch()} /></div>
        ) : isLoading ? (
          <div className="p-5"><SkeletonList rows={8} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<MessageSquareText className="size-6" />} title="لا توجد رسائل مطابقة"
            description={active ? "غيّر المرشحات لرؤية رسائل أخرى." : "لم تُرسل أي رسالة بعد."} />
        ) : (
          <div className={cn(isPlaceholderData && "opacity-60")}>
            <ResponsiveList<Message>
              items={rows}
              rowKey={(r) => r.id}
              head={["الوقت", "القناة", "الغرض", "المستلم", "الحالة", "المحاولات", "المزود", "آخر خطأ"]}
              row={(r) => [
                <span key="t" className="whitespace-nowrap text-muted">{formatDateTime(r.created_at)}</span>,
                <span key="c">{CHANNELS[r.channel] ?? r.channel}</span>,
                <span key="p">{PURPOSES[r.purpose] ?? r.purpose}</span>,
                <span key="r" dir="ltr" className="num text-xs">{r.recipient_masked}</span>,
                <StatusBadge key="s" status={r.status} />,
                <span key="a" className="num text-xs">{r.attempts}/{r.max_attempts}</span>,
                <span key="v" className="text-xs text-muted">{r.provider || "—"}</span>,
                <span key="e" dir="ltr" className="text-xs text-muted">{r.last_error || "—"}</span>,
              ]}
              card={(r) => (
                <div className="space-y-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{PURPOSES[r.purpose] ?? r.purpose} · {CHANNELS[r.channel] ?? r.channel}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="text-xs text-muted">
                    {formatDateTime(r.created_at)} · <span dir="ltr" className="num">{r.recipient_masked}</span>
                  </div>
                  <div className="text-xs text-subtle">
                    المحاولات <span className="num">{r.attempts}/{r.max_attempts}</span>
                    {r.last_error && <> · <span dir="ltr">{r.last_error}</span></>}
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

function StatusBadge({ status }: { status: string }) {
  const s = STATUSES[status] ?? { text: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone} dot>{s.text}</Badge>;
}

function ProviderCard({ icon: Icon, title, provider, configured }: {
  icon: React.ElementType; title: string; provider: string; configured: boolean;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-sunken text-muted"><Icon className="size-5" /></div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{title}</div>
        <div dir="ltr" className="truncate text-start text-xs text-muted">{provider}</div>
      </div>
      {!configured
        ? <Badge tone="warning" dot>غير مفعلة — لا يُرسل شيء</Badge>
        : provider === "console"
          ? <Badge tone="info" dot>وضع التطوير — لا تغادر الخادم</Badge>
          : <Badge tone="success" dot>مفعلة</Badge>}
    </Card>
  );
}
