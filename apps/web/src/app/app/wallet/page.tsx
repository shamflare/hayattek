"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Clock, CreditCard, Receipt, Sparkles, Wallet } from "lucide-react";
import * as React from "react";

import { balanceLabel, Money } from "@/components/billing/money";
import { Statement } from "@/components/billing/statement";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, ErrorState, Skeleton } from "@/components/ui/surface";
import { api, errorMessage, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";

export default function MyWalletPage() {
  const [page, setPage] = React.useState(1);
  const summary = useQuery({ queryKey: ["billing", "me"], queryFn: () => unwrap(api.GET("/api/v1/billing/me")) });
  const txs = useQuery({
    queryKey: ["billing", "me", "tx", page],
    queryFn: () => unwrap(api.GET("/api/v1/billing/me/transactions", { params: { query: { page } as never } })),
    placeholderData: keepPreviousData,
  });

  if (summary.isLoading) return <div className="space-y-4"><Skeleton className="h-40 rounded-card" /><Skeleton className="h-80 rounded-card" /></div>;
  if (summary.isError || !summary.data) return <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />;
  const s = summary.data;
  const negative = Number(s.balance) < 0;
  const pages = txs.data ? Math.max(1, Math.ceil(txs.data.count / 20)) : 1;

  return (
    <div className="animate-fade-up">
      <PageHeader title="حسابي المالي" description="استخدام HayatTek AI يُسجَّل على حسابك ويُسدَّد لاحقاً لإدارة المنصة." />

      <Card className={cn("mb-5 overflow-hidden", negative ? "border-danger/30" : "border-success/30")}>
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <div className={cn("grid size-14 place-items-center rounded-2xl", negative ? "bg-danger-soft text-danger" : "bg-success-soft text-success")}>
            <Wallet className="size-7" />
          </div>
          <div className="flex-1">
            <div className="text-sm text-muted">الرصيد الحالي</div>
            <div className="text-3xl font-bold"><Money value={s.balance} currency={s.currency} colored /></div>
            <div className="mt-1 text-sm text-muted">{balanceLabel(s.balance)}</div>
          </div>
          {negative && (
            <div className="rounded-2xl bg-danger-soft px-5 py-3 text-center">
              <div className="text-xs text-danger">المبلغ المستحق</div>
              <div className="text-xl font-bold text-danger"><Money value={s.amount_due} currency={s.currency} /></div>
            </div>
          )}
        </div>
      </Card>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Sparkles} label="إجمالي استخدام الذكاء الاصطناعي" value={<Money value={s.total_charges} currency={s.currency} />} />
        <Kpi icon={Clock} label="الدقائق المحاسبة" value={<span className="num">{s.billable_minutes}</span>} hint={`${s.sessions} جلسة`} />
        <Kpi icon={Receipt} label="سعر الدقيقة" value={<Money value={s.price_per_minute} currency={s.currency} />} hint={s.plan_name} />
        <Kpi icon={CreditCard} label="إجمالي المدفوعات" value={<Money value={s.total_payments} currency={s.currency} />}
          hint={s.last_payment_at ? `آخر دفعة ${formatDate(s.last_payment_at)}` : "لا دفعات بعد"} />
      </div>

      <div className="mb-3 flex items-center gap-2">
        <Badge tone={s.ai_enabled ? "success" : "neutral"} dot>{s.ai_enabled ? "المساعد الذكي مفعل" : "المساعد الذكي غير مفعل"}</Badge>
        <span className="text-xs text-muted">التفعيل والأسعار تحددها إدارة المنصة.</span>
      </div>

      <Card>
        <CardHeader title="كشف الحساب" description="الرسوم والدفعات وأي تصحيحات، مع الرصيد بعد كل عملية." />
        <div className="p-2 pt-4">
          {txs.isLoading ? <Skeleton className="h-40" /> : <Statement rows={txs.data?.results ?? []} receiptScope="me" />}
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 border-t border-line p-3 text-sm">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>الأحدث</Button>
            <span className="num text-muted">{page} / {pages}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>الأقدم</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, hint }: { icon: React.ElementType; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted"><Icon className="size-4 text-brand-600" /> {label}</div>
      <div className="mt-2 text-xl font-bold">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-subtle">{hint}</div>}
    </Card>
  );
}
