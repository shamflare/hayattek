"use client";

import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, FileBadge, Mail, ShieldCheck, Stethoscope, XCircle } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Pager, SearchBox, usePageFor, VerificationBadge } from "@/components/admin/common";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { Avatar, Card, EmptyState, ErrorState, SkeletonList } from "@/components/ui/surface";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { formatDate, formatPhone } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { label } from "@/lib/i18n";

type Practitioner = Schemas["Practitioner"];
type Decision = "verified" | "rejected" | "suspended";

const STATUSES = ["pending", "verified", "rejected", "suspended"] as const;

const DECISIONS: Record<Decision, {
  title: string; confirm: string; tone: "primary" | "danger"; description: string;
}> = {
  verified: {
    title: "اعتماد الطبيب؟",
    confirm: "اعتماد",
    tone: "primary",
    description: "تأكد من صحة الترخيص لدى الجهة المانحة قبل الاعتماد. بعد الاعتماد يستطيع الطبيب العمل على السجلات الطبية للمرضى المسجلين لدى منشأته أو بموجب موافقة.",
  },
  rejected: {
    title: "رفض طلب الاعتماد؟",
    confirm: "رفض",
    tone: "danger",
    description: "لن يتمكن الطبيب من الوصول إلى أي سجل طبي. اكتب سبب الرفض ليظهر له.",
  },
  suspended: {
    title: "إيقاف الطبيب؟",
    confirm: "إيقاف",
    tone: "danger",
    description: "يتوقف وصول الطبيب إلى السجلات الطبية فوراً في كل المنشآت. السجلات التي كتبها تبقى كما هي.",
  },
};

export default function PractitionersPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]>("pending");
  const [q, setQ] = React.useState("");
  const [action, setAction] = React.useState<{ p: Practitioner; decision: Decision } | null>(null);
  const [notes, setNotes] = React.useState("");
  const query = useDebounced(q.trim(), 300);
  const [page, setPage] = usePageFor(`${query}|${status}`);

  const counts = useQueries({
    queries: STATUSES.map((s) => ({
      queryKey: ["admin", "practitioners", "count", s],
      queryFn: () => unwrap(api.GET("/api/v1/admin/practitioners", {
        params: { query: { verification_status: s, page_size: 1 } },
      })),
    })),
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "practitioners", { status, query, page }],
    queryFn: () => unwrap(api.GET("/api/v1/admin/practitioners", {
      params: { query: { verification_status: status, q: query || undefined, page } },
    })),
    placeholderData: keepPreviousData,
  });

  const decide = useMutation({
    mutationFn: ({ p, decision }: { p: Practitioner; decision: Decision }) =>
      unwrap(api.POST("/api/v1/admin/practitioners/{id}/verification", {
        params: { path: { id: p.id } }, body: { status: decision, notes: notes.trim() },
      })),
    onSuccess: (p) => {
      toast.success(`${p.display_name}: ${label("verification", p.verification_status)}`);
      setAction(null);
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const list = data?.results ?? [];

  return (
    <>
      <PageHeader
        eyebrow="إدارة المنصة"
        title="اعتماد الأطباء"
        description="لا يصل الطبيب إلى السجلات الطبية قبل التحقق من ترخيصه. كل قرار يُسجل في السجل الأمني."
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)} dir="rtl">
          <TabsList>
            {STATUSES.map((s, i) => (
              <TabsTrigger key={s} value={s}>
                {label("verification", s)}
                {counts[i].data && (
                  <span className={`num rounded-full px-1.5 text-xs ${s === "pending" && counts[i].data.count > 0 ? "bg-warning text-white" : "bg-sunken text-muted"}`}>
                    {counts[i].data.count}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <SearchBox value={q} onChange={setQ} placeholder="ابحث باسم الطبيب…" className="sm:w-72" />
      </div>

      {error ? (
        <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />
      ) : isLoading ? (
        <Card className="p-5"><SkeletonList rows={4} /></Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={status === "pending" ? <ShieldCheck className="size-6" /> : <Stethoscope className="size-6" />}
            title={status === "pending" ? "لا توجد طلبات بانتظار التحقق" : "لا يوجد أطباء في هذه القائمة"}
            description={status === "pending" ? "عندما تضيف منشأة طبيباً جديداً يظهر هنا لتتحقق من ترخيصه." : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((p) => (
            <Card key={p.id} className="flex flex-col p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <Avatar name={p.display_name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold">{p.display_name}</div>
                    <VerificationBadge status={p.verification_status} />
                  </div>
                  <div className="text-sm text-muted">
                    {label("specialties", p.specialty)}{p.specialty_detail ? ` · ${p.specialty_detail}` : ""}
                  </div>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-sunken/60 p-3 text-sm">
                <div className="col-span-2 flex items-start gap-2 sm:col-span-1">
                  <FileBadge className="mt-0.5 size-4 shrink-0 text-subtle" />
                  <div className="min-w-0">
                    <dt className="text-xs text-subtle">رقم الترخيص</dt>
                    <dd className="truncate font-medium">{p.license_number ? <span className="num">{p.license_number}</span> : "غير مدخل"}</dd>
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <dt className="text-xs text-subtle">جهة الترخيص</dt>
                  <dd className="font-medium">{p.license_authority || "غير مدخلة"}</dd>
                </div>
                <div className="col-span-2 flex items-start gap-2 sm:col-span-1">
                  <Mail className="mt-0.5 size-4 shrink-0 text-subtle" />
                  <div className="min-w-0">
                    <dt className="text-xs text-subtle">الحساب</dt>
                    <dd className="truncate" dir="ltr">{p.user.email ?? formatPhone(p.user.phone)}</dd>
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <dt className="text-xs text-subtle">تاريخ الطلب</dt>
                  <dd>{formatDate(p.created_at)}</dd>
                </div>
              </dl>

              {p.verification_notes && (
                <p className="mt-3 rounded-xl border border-line px-3 py-2 text-sm text-muted">
                  <span className="text-xs text-subtle">ملاحظات التحقق: </span>{p.verification_notes}
                </p>
              )}
              {p.verified_at && p.verification_status === "verified" && (
                <p className="mt-3 text-xs text-subtle">اعتُمد في {formatDate(p.verified_at)}</p>
              )}

              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
                {p.verification_status !== "verified" && (
                  <Button size="sm" onClick={() => setAction({ p, decision: "verified" })}>
                    <CheckCircle2 className="size-4" /> اعتماد
                  </Button>
                )}
                {p.verification_status === "pending" && (
                  <Button size="sm" variant="danger-ghost" onClick={() => setAction({ p, decision: "rejected" })}>
                    <XCircle className="size-4" /> رفض
                  </Button>
                )}
                {p.verification_status === "verified" && (
                  <Button size="sm" variant="danger-ghost" onClick={() => setAction({ p, decision: "suspended" })}>
                    <Ban className="size-4" /> إيقاف
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {data && <Pager page={page} count={data.count} onPage={setPage} />}

      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => { if (!open) { setAction(null); setNotes(""); } }}
        title={action ? DECISIONS[action.decision].title : ""}
        description={action && (
          <><b className="text-fg">{action.p.display_name}</b> — {DECISIONS[action.decision].description}</>
        )}
        confirmLabel={action ? DECISIONS[action.decision].confirm : ""}
        tone={action ? DECISIONS[action.decision].tone : "primary"}
        loading={decide.isPending}
        onConfirm={() => action && decide.mutate(action)}
      >
        <Field label="ملاحظات" optional htmlFor="v-notes"
          hint={action?.decision === "verified" ? "مثال: تم التحقق هاتفياً من النقابة." : "تُحفظ مع القرار."}>
          <Textarea id="v-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}
