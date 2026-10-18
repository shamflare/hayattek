"use client";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronLeft, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { OrgStatusBadge, Pager, ResponsiveList, SearchBox, usePageFor } from "@/components/admin/common";
import { OrganizationFormDialog } from "@/components/admin/organization-form";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Card, EmptyState, ErrorState, SkeletonList } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { label, m } from "@/lib/i18n";

type Org = Schemas["Organization"];

export default function OrganizationsPage() {
  return (
    <React.Suspense fallback={<SkeletonList rows={6} />}>
      <OrganizationsInner />
    </React.Suspense>
  );
}

function OrganizationsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [q, setQ] = React.useState(params.get("q") ?? "");
  const kind = params.get("kind") ?? "";
  const status = params.get("status") ?? "";
  const [adding, setAdding] = React.useState(false);
  const query = useDebounced(q.trim(), 300);
  const [page, setPage] = usePageFor(`${query}|${kind}|${status}`);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const { data, isLoading, error, refetch, isPlaceholderData } = useQuery({
    queryKey: ["admin", "organizations", { query, kind, status, page }],
    queryFn: () => unwrap(api.GET("/api/v1/admin/organizations", {
      params: { query: { q: query || undefined, kind: kind || undefined, status: status || undefined, page } },
    })),
    placeholderData: keepPreviousData,
  });
  const orgs = data?.results ?? [];
  const filtered = Boolean(query || kind || status);

  return (
    <>
      <PageHeader
        eyebrow="إدارة المنصة"
        title="المنشآت"
        description="العيادات والمجمعات والمشافي والمختبرات ومراكز الأشعة المشتركة في الشبكة."
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> إضافة منشأة</Button>}
      />

      <Card>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_200px_180px]">
          <SearchBox value={q} onChange={setQ} placeholder="ابحث باسم المنشأة…" />
          <Select value={kind} onChange={(e) => setParam("kind", e.target.value)} aria-label="النوع">
            <option value="">كل الأنواع</option>
            {Object.entries(m.orgKinds).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setParam("status", e.target.value)} aria-label="الحالة">
            <option value="">كل الحالات</option>
            {Object.entries(m.orgStatus).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </Select>
        </div>

        {error ? (
          <div className="p-4"><ErrorState message={errorMessage(error)} onRetry={() => refetch()} /></div>
        ) : isLoading ? (
          <div className="p-5"><SkeletonList rows={6} /></div>
        ) : orgs.length === 0 ? (
          <EmptyState
            icon={<Building2 className="size-6" />}
            title={filtered ? "لا توجد منشآت مطابقة" : "لا توجد منشآت بعد"}
            description={filtered ? "جرّب تغيير البحث أو المرشحات." : "أضف أول منشأة لتبدأ بإضافة فريقها."}
            action={!filtered && <Button onClick={() => setAdding(true)}><Plus className="size-4" /> إضافة منشأة</Button>}
          />
        ) : (
          <div className={isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
            <ResponsiveList<Org>
              items={orgs}
              rowKey={(o) => o.id}
              head={["المنشأة", "النوع", "المدينة", "الأعضاء", "الحالة", "أُضيفت", ""]}
              row={(o) => [
                <Link key="n" href={`/app/admin/organizations/${o.id}`} className="font-medium hover:text-brand-600">
                  {o.name}
                  {o.name_en && <div className="text-xs font-normal text-subtle" dir="ltr">{o.name_en}</div>}
                </Link>,
                label("orgKinds", o.kind),
                <span key="c" className="text-muted">{[o.city, label("governorates", o.governorate)].filter((x) => x && x !== "—").join("، ")}</span>,
                <span key="m" className="num">{o.member_count}</span>,
                <OrgStatusBadge key="s" status={o.status} />,
                <span key="d" className="whitespace-nowrap text-muted">{formatDate(o.created_at)}</span>,
                <Button key="a" variant="ghost" size="icon" asChild aria-label="فتح">
                  <Link href={`/app/admin/organizations/${o.id}`}><ChevronLeft className="size-4" /></Link>
                </Button>,
              ]}
              card={(o) => (
                <Link href={`/app/admin/organizations/${o.id}`} className="flex items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                    <Building2 className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium">{o.name}</div>
                      <OrgStatusBadge status={o.status} />
                    </div>
                    <div className="mt-1 text-sm text-muted">
                      {label("orgKinds", o.kind)}{o.city ? ` · ${o.city}` : ""} · <span className="num">{o.member_count}</span> عضو
                    </div>
                  </div>
                </Link>
              )}
            />
          </div>
        )}
        {data && <div className="px-4 pb-4"><Pager page={page} count={data.count} onPage={setPage} /></div>}
      </Card>

      <OrganizationFormDialog
        open={adding}
        onOpenChange={setAdding}
        onSaved={(org) => {
          queryClient.invalidateQueries({ queryKey: ["admin"] });
          router.push(`/app/admin/organizations/${org.id}`);
        }}
      />
    </>
  );
}
