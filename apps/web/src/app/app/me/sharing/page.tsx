"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2, CalendarClock, Check, ChevronLeft, Eye, History, Search, Share2, ShieldCheck,
  ShieldOff, Stethoscope, UserRound, Users,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { AccessRequestCard, purposeLabels } from "@/components/patient/access-request-card";
import { useActivePatient } from "@/components/patient/active-patient";
import { asList, portalKeys } from "@/components/patient/portal";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { ChoiceChips, Field, Input } from "@/components/ui/field";
import { Badge, Card, EmptyState, ErrorState, Skeleton, SkeletonList } from "@/components/ui/surface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage, patientApi, type Schemas, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, relativeTime } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { label, m } from "@/lib/i18n";

type Grant = Schemas["Grant"];
type Scope = Schemas["ScopesEnum"];
const allScopes = Object.keys(m.scopes) as Scope[];

export default function SharingPage() {
  const { active } = useActivePatient();
  const patientId = active!.id;
  const [tab, setTab] = React.useState("access");
  const [shareOpen, setShareOpen] = React.useState(false);

  const requests = useQuery({
    queryKey: portalKeys.requests,
    queryFn: () => unwrap(patientApi.GET("/api/v1/me/sharing/requests")),
  });
  const pending = asList(requests.data).filter((r) => r.patient === patientId);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="المشاركة والموافقات"
        description="أنت من يقرر من يرى ملفك ومتى. كل اطلاع على ملفك يُسجَّل هنا."
        actions={<Button size="lg" onClick={() => setShareOpen(true)}><Share2 className="size-5" /> مشاركة ملفي مع منشأة</Button>} />

      {/* Pending requests always come first: they need a decision. */}
      {requests.isLoading ? (
        <Skeleton className="mb-6 h-40 w-full rounded-card" />
      ) : requests.isError ? (
        <div className="mb-6"><ErrorState message={errorMessage(requests.error)} onRetry={() => requests.refetch()} /></div>
      ) : pending.length > 0 ? (
        <section className="mb-8 space-y-3">
          <h2 className="text-lg font-semibold">طلبات بانتظار قرارك</h2>
          {pending.map((r) => <AccessRequestCard key={r.id} request={r} />)}
        </section>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} dir="rtl">
        <TabsList className="mb-5">
          <TabsTrigger value="access"><ShieldCheck className="size-4" /> من يرى ملفي</TabsTrigger>
          <TabsTrigger value="log"><History className="size-4" /> سجل الاطلاع</TabsTrigger>
        </TabsList>
        <TabsContent value="access"><GrantsSection patientId={patientId} onShare={() => setShareOpen(true)} /></TabsContent>
        <TabsContent value="log"><AccessLog patientId={patientId} /></TabsContent>
      </Tabs>

      <ShareWizard open={shareOpen} onOpenChange={setShareOpen} patientId={patientId} />
    </div>
  );
}

// ------------------------------------------------------------------ grants

function GrantsSection({ patientId, onShare }: { patientId: string; onShare: () => void }) {
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = React.useState<Grant | null>(null);
  const grants = useQuery({
    queryKey: portalKeys.grants,
    queryFn: () => unwrap(patientApi.GET("/api/v1/me/sharing/grants", { params: { query: { page_size: 100 } } })),
  });
  const mine = (grants.data?.results ?? []).filter((g) => g.patient === patientId);
  const current = mine.filter((g) => g.is_effective);
  const past = mine.filter((g) => !g.is_effective);

  const revoke = useMutation({
    mutationFn: (id: string) =>
      unwrap(patientApi.POST("/api/v1/me/sharing/grants/{grant_id}/revoke", { params: { path: { grant_id: id } } })),
    onSuccess: () => {
      toast.success("أُلغي الوصول فوراً.");
      setRevoking(null);
      queryClient.invalidateQueries({ queryKey: portalKeys.grants });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (grants.isLoading) return <Card className="p-5"><SkeletonList rows={3} /></Card>;
  if (grants.isError) return <ErrorState message={errorMessage(grants.error)} onRetry={() => grants.refetch()} />;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-sunken px-4 py-3 text-sm leading-7 text-muted">
        المنشأة التي سجّلتك تستطيع دائماً رؤية ما كتبته هي في ملفك. القائمة أدناه هي الجهات التي سمحتَ لها
        برؤية سجلاتك من <strong className="text-fg">منشآت أخرى</strong>.
      </div>

      {current.length === 0 ? (
        <Card>
          <EmptyState icon={<ShieldCheck className="size-7" />} title="لا أحد يملك وصولاً إضافياً إلى ملفك"
            description="عندما توافق على طلب طبيب أو تشارك ملفك مع منشأة سيظهر ذلك هنا، ويمكنك إلغاؤه في أي وقت."
            action={<Button variant="secondary" onClick={onShare}><Share2 className="size-4" /> مشاركة ملفي</Button>} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {current.map((g) => (
            <li key={g.id}><GrantCard grant={g} onRevoke={() => setRevoking(g)} /></li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-sm font-medium text-brand-600">
            <span className="inline-flex items-center gap-1">
              <ChevronLeft className="size-4 transition-transform group-open:-rotate-90" />
              وصول منتهٍ أو ملغى (<span className="num">{past.length}</span>)
            </span>
          </summary>
          <ul className="mt-3 space-y-3">
            {past.map((g) => <li key={g.id}><GrantCard grant={g} /></li>)}
          </ul>
        </details>
      )}

      <ConfirmDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)} tone="danger"
        title="إلغاء الوصول؟" confirmLabel="إلغاء الوصول" loading={revoke.isPending}
        description={revoking ? `لن تتمكن ${revoking.organization_name} من رؤية سجلاتك من المنشآت الأخرى بعد الآن. ما اطّلعت عليه سابقاً يبقى في سجل الاطلاع.` : undefined}
        onConfirm={() => revoking && revoke.mutate(revoking.id)} />
    </div>
  );
}

function GrantCard({ grant, onRevoke }: { grant: Grant; onRevoke?: () => void }) {
  const active = grant.is_effective;
  return (
    <div className={cn("rounded-card border bg-elevated p-4 shadow-soft sm:p-5", active ? "border-line" : "border-line opacity-75")}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className={cn("grid size-11 shrink-0 place-items-center rounded-2xl", active ? "bg-brand-50 text-brand-600" : "bg-sunken text-subtle")}>
            <Building2 className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold leading-7">{grant.organization_name}</div>
            <div className="text-sm text-muted">
              {grant.practitioner_name ? <><Stethoscope className="me-1 inline size-3.5" />{grant.practitioner_name} فقط</> : "كل أطباء المنشأة"}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {grant.scopes.map((s) => <Badge key={s} tone="brand">{label("scopes", s)}</Badge>)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>{label("grantMethods", grant.method)}</span>
              {grant.purpose && <span>الغرض: {purposeLabels[grant.purpose] ?? grant.purpose}</span>}
              {grant.revoked_at ? (
                <span className="text-danger">أُلغي في {formatDate(grant.revoked_at)}</span>
              ) : (
                <span className={cn("inline-flex items-center gap-1", active ? "text-fg" : "")}>
                  <CalendarClock className="size-3.5" />
                  {active ? `ينتهي ${relativeTime(grant.expires_at)}` : `انتهى في ${formatDate(grant.expires_at)}`}
                </span>
              )}
            </div>
          </div>
        </div>
        {onRevoke && active && (
          <Button variant="outline" className="text-danger" onClick={onRevoke}>
            <ShieldOff className="size-4" /> إلغاء الوصول
          </Button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ access log

function AccessLog({ patientId }: { patientId: string }) {
  const query = useInfiniteQuery({
    queryKey: portalKeys.accessLog(patientId),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      unwrap(patientApi.GET("/api/v1/me/sharing/access-log", {
        params: { query: { patient: patientId, page: pageParam, page_size: 30 } },
      })),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
  });
  const rows = query.data?.pages.flatMap((p) => p.results) ?? [];

  if (query.isLoading) return <Card className="p-5"><SkeletonList rows={5} /></Card>;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Eye className="size-7" />} title="لم يطّلع أحد على ملفك بعد"
          description="كل مرة يفتح فيها طبيب أو موظف ملفك ستظهر هنا مع اسمه والمنشأة والوقت." />
      </Card>
    );
  }
  return (
    <Card>
      <ul className="divide-y divide-line">
        {rows.map((r, i) => {
          const denied = r.outcome !== "success";
          return (
            <li key={`${r.occurred_at}-${i}`} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
              <div className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl", denied ? "bg-danger-soft text-danger" : "bg-sunken text-muted")}>
                {denied ? <ShieldOff className="size-4" /> : <UserRound className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{label("auditActions", r.action)}</span>
                  {denied && <Badge tone="danger">مُنع</Badge>}
                </div>
                <div className="mt-0.5 text-sm text-muted">
                  {[r.actor_name, r.organization_name].filter(Boolean).join(" · ") || "النظام"}
                </div>
              </div>
              <time className="shrink-0 text-xs text-subtle" dateTime={r.occurred_at}>{formatDateTime(r.occurred_at)}</time>
            </li>
          );
        })}
      </ul>
      {query.hasNextPage && (
        <div className="border-t border-line p-3 text-center">
          <Button variant="ghost" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>عرض المزيد</Button>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ share wizard

const dayOptions = [
  { value: "1", label: "يوم واحد" },
  { value: "7", label: "أسبوع" },
  { value: "30", label: "شهر" },
  { value: "90", label: "3 أشهر" },
  { value: "365", label: "سنة" },
];

function ShareWizard({ open, onOpenChange, patientId }: { open: boolean; onOpenChange: (o: boolean) => void; patientId: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <ShareWizardBody onDone={() => onOpenChange(false)} patientId={patientId} />}
    </Dialog>
  );
}

/** Mounted only while open: each opening starts at step 1 with default choices. */
function ShareWizardBody({ onDone, patientId }: { onDone: () => void; patientId: string }) {
  const queryClient = useQueryClient();
  const [step, setStep] = React.useState(1);
  const [q, setQ] = React.useState("");
  const [org, setOrg] = React.useState<Schemas["PublicOrganization"] | null>(null);
  const [practitioner, setPractitioner] = React.useState<Schemas["PublicPractitioner"] | null>(null);
  const [scopes, setScopes] = React.useState<Scope[]>(["summary", "encounters", "prescriptions", "labs", "imaging"]);
  const [days, setDays] = React.useState("30");
  const query = useDebounced(q.trim(), 250);

  const orgs = useQuery({
    queryKey: ["directory", "organizations", query],
    queryFn: () => {
      const params = { q: query || undefined, page_size: 20 };
      return unwrap(patientApi.GET("/api/v1/directory/organizations", { params: { query: params } }));
    },
    enabled: step === 1,
  });
  const practitioners = useQuery({
    queryKey: ["directory", "practitioners", org?.id],
    queryFn: () => {
      const params = { organization: org!.id, page_size: 50 };
      return unwrap(patientApi.GET("/api/v1/directory/practitioners", { params: { query: params } }));
    },
    enabled: !!org,
  });

  const share = useMutation({
    mutationFn: () =>
      unwrap(patientApi.POST("/api/v1/me/sharing/grants", {
        body: {
          patient_id: patientId, organization_id: org!.id, practitioner_id: practitioner?.id ?? null,
          scopes, days: Number(days), purpose: "treatment",
        },
      })),
    onSuccess: () => {
      toast.success(`شاركتَ ملفك مع ${org!.name}.`);
      queryClient.invalidateQueries({ queryKey: portalKeys.grants });
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const footer = (
    <>
      {step > 1 && <Button variant="ghost" onClick={() => setStep(step - 1)}>رجوع</Button>}
      {step === 2 && <Button onClick={() => setStep(3)}>التالي</Button>}
      {step === 3 && <Button disabled={scopes.length === 0} onClick={() => setStep(4)}>التالي</Button>}
      {step === 4 && (
        <Button loading={share.isPending} onClick={() => share.mutate()}><Check className="size-4" /> تأكيد المشاركة</Button>
      )}
    </>
  );

  return (
      <DialogContent size="md" title="مشاركة ملفي مع منشأة"
        description={<span>الخطوة <span className="num">{step}</span> من <span className="num">4</span></span>}
        footer={step > 1 ? footer : undefined}>
        {step === 1 && (
          <div className="space-y-3">
            <Field label="ابحث عن العيادة أو المشفى أو المختبر" htmlFor="org-q">
              <div className="relative">
                <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-subtle" />
                <Input id="org-q" value={q} onChange={(e) => setQ(e.target.value)} className="ps-9" autoFocus placeholder="اسم المنشأة" />
              </div>
            </Field>
            {orgs.isLoading ? (
              <SkeletonList rows={3} />
            ) : orgs.isError ? (
              <ErrorState message={errorMessage(orgs.error)} onRetry={() => orgs.refetch()} />
            ) : (orgs.data?.results.length ?? 0) === 0 ? (
              <p className="py-6 text-center text-sm text-muted">لا توجد منشأة بهذا الاسم في حياة.</p>
            ) : (
              <ul className="space-y-2">
                {orgs.data!.results.map((o) => (
                  <li key={o.id}>
                    <button type="button" onClick={() => { setOrg(o); setPractitioner(null); setStep(2); }}
                      className="flex w-full items-center gap-3 rounded-2xl border border-line p-3 text-start transition-colors hover:border-brand-300 hover:bg-sunken/50">
                      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><Building2 className="size-5" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{o.name}</div>
                        <div className="text-xs text-muted">
                          {label("orgKinds", o.kind)}{o.city ? ` · ${o.city}` : o.governorate ? ` · ${label("governorates", o.governorate)}` : ""}
                        </div>
                      </div>
                      <ChevronLeft className="size-4 text-subtle" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === 2 && org && (
          <div className="space-y-3">
            <p className="text-sm text-muted">من في <strong className="text-fg">{org.name}</strong> يستطيع رؤية ملفك؟</p>
            <PickRow selected={!practitioner} onClick={() => setPractitioner(null)} icon={<Users className="size-5" />}
              title="كل أطباء المنشأة" hint="مناسب للمشافي والمجمعات الطبية" />
            {practitioners.isLoading ? (
              <SkeletonList rows={2} />
            ) : (
              practitioners.data?.results.map((p) => (
                <PickRow key={p.id} selected={practitioner?.id === p.id} onClick={() => setPractitioner(p)}
                  icon={<Stethoscope className="size-5" />} title={p.display_name}
                  hint={p.specialty_detail || label("specialties", p.specialty)} />
              ))
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-sm font-medium">ماذا تريد أن تشارك؟</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {allScopes.map((s) => {
                  const on = scopes.includes(s);
                  return (
                    <li key={s}>
                      <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5",
                        on ? "border-brand-300 bg-brand-50/50" : "border-line")}>
                        <input type="checkbox" checked={on} className="mt-1 size-4 shrink-0 accent-[var(--brand-600)]"
                          onChange={() => setScopes((cur) => (on ? cur.filter((x) => x !== s) : [...cur, s]))} />
                        <span>
                          <span className="block text-sm font-medium">{label("scopes", s)}</span>
                          <span className="block text-xs text-muted">{label("scopeHints", s)}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
            <Field label="لمدة">
              <ChoiceChips options={dayOptions} value={days} onChange={(v) => setDays(v as string)} />
            </Field>
          </div>
        )}

        {step === 4 && org && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-sunken p-4 text-[15px] leading-8">
              <p>ستتمكن <strong>{org.name}</strong> {practitioner ? <>(<strong>{practitioner.display_name}</strong> فقط)</> : "(كل أطبائها)"} من رؤية:</p>
              <p className="text-brand-700 dark:text-brand-300">{scopes.map((s) => label("scopes", s)).join("، ")}</p>
              <p>لمدة <strong>{dayOptions.find((d) => d.value === days)?.label}</strong>، وتستطيع الإلغاء في أي وقت.</p>
            </div>
            <p className="text-xs leading-6 text-muted">كل اطلاع على ملفك سيُسجَّل وتراه في «سجل الاطلاع».</p>
          </div>
        )}
      </DialogContent>
  );
}

function PickRow({ selected, onClick, icon, title, hint }: { selected: boolean; onClick: () => void; icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      className={cn("flex w-full items-center gap-3 rounded-2xl border p-3 text-start transition-colors",
        selected ? "border-brand-500 bg-brand-50/60" : "border-line hover:border-brand-300")}>
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-sunken text-muted">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <span className={cn("grid size-5 place-items-center rounded-full border", selected ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong")}>
        {selected && <Check className="size-3.5" />}
      </span>
    </button>
  );
}
