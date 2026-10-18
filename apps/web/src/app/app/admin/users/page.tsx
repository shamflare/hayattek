"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldOff, UserCheck, UserX, Users } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Pager, ResponsiveList, SearchBox, usePageFor } from "@/components/admin/common";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Avatar, Badge, Card, EmptyState, ErrorState, SkeletonList } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { formatPhone, relativeTime } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { useSession } from "@/lib/session";

type User = Schemas["UserSummary"];

export default function UsersPage() {
  const { me } = useSession();
  const queryClient = useQueryClient();
  const [q, setQ] = React.useState("");
  const [target, setTarget] = React.useState<User | null>(null);
  const query = useDebounced(q.trim(), 300);
  const [page, setPage] = usePageFor(query);

  const { data, isLoading, error, refetch, isPlaceholderData } = useQuery({
    queryKey: ["admin", "users", { query, page }],
    queryFn: () => unwrap(api.GET("/api/v1/admin/users", { params: { query: { q: query || undefined, page } } })),
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: (u: User) => unwrap(api.POST("/api/v1/admin/users/{id}/set-active", {
      params: { path: { id: u.id } }, body: { is_active: !u.is_active },
    })),
    onSuccess: (u) => {
      toast.success(u.is_active ? "فُعّل الحساب" : "عُطّل الحساب");
      setTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const users = data?.results ?? [];
  const actionButton = (u: User) => u.id === me?.id ? (
    <span className="text-xs text-subtle">حسابك</span>
  ) : (
    <Button size="sm" variant={u.is_active ? "danger-ghost" : "secondary"} onClick={() => setTarget(u)}>
      {u.is_active ? <><UserX className="size-4" /> تعطيل</> : <><UserCheck className="size-4" /> تفعيل</>}
    </Button>
  );

  return (
    <>
      <PageHeader
        eyebrow="إدارة المنصة"
        title="المستخدمون"
        description="حسابات الدخول لكل الأطراف. تعطيل الحساب يمنع الدخول فوراً دون حذف أي سجل."
      />
      <Card>
        <div className="border-b border-line p-4">
          <SearchBox value={q} onChange={setQ} placeholder="ابحث بالاسم أو البريد أو الهاتف…" className="sm:max-w-md" />
        </div>
        {error ? (
          <div className="p-4"><ErrorState message={errorMessage(error)} onRetry={() => refetch()} /></div>
        ) : isLoading ? (
          <div className="p-5"><SkeletonList rows={6} /></div>
        ) : users.length === 0 ? (
          <EmptyState icon={<Users className="size-6" />} title="لا يوجد مستخدمون مطابقون" description="جرّب جزءاً من الاسم أو البريد." />
        ) : (
          <div className={isPlaceholderData ? "opacity-60" : undefined}>
            <ResponsiveList<User>
              items={users}
              rowKey={(u) => u.id}
              head={["المستخدم", "المصادقة الثنائية", "آخر دخول", "الحالة", ""]}
              rowClassName={(u) => (u.is_active ? undefined : "bg-sunken/40")}
              row={(u) => [
                <UserCell key="u" user={u} />,
                <MfaBadge key="m" enabled={u.mfa_enabled} />,
                <span key="l" className="text-muted">{u.last_login ? relativeTime(u.last_login) : "لم يدخل بعد"}</span>,
                <ActiveBadge key="s" active={u.is_active} />,
                <div key="a" className="text-end">{actionButton(u)}</div>,
              ]}
              card={(u) => (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <UserCell user={u} />
                    <ActiveBadge active={u.is_active} />
                  </div>
                  <div className="flex items-center justify-between gap-2 ps-[52px]">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <MfaBadge enabled={u.mfa_enabled} />
                      {u.last_login ? relativeTime(u.last_login) : "لم يدخل بعد"}
                    </div>
                    {actionButton(u)}
                  </div>
                </div>
              )}
            />
          </div>
        )}
        {data && <div className="px-4 pb-4"><Pager page={page} count={data.count} onPage={setPage} /></div>}
      </Card>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={target?.is_active ? "تعطيل الحساب؟" : "تفعيل الحساب؟"}
        description={target && (target.is_active
          ? <>لن يتمكن <b className="text-fg">{target.full_name}</b> من تسجيل الدخول على الويب أو التطبيق. السجلات التي كتبها تبقى محفوظة.</>
          : <>سيتمكن <b className="text-fg">{target.full_name}</b> من تسجيل الدخول مجدداً بصلاحياته السابقة.</>)}
        confirmLabel={target?.is_active ? "تعطيل" : "تفعيل"}
        tone={target?.is_active ? "danger" : "primary"}
        loading={toggle.isPending}
        onConfirm={() => target && toggle.mutate(target)}
      />
    </>
  );
}

function UserCell({ user }: { user: User }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={user.full_name} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 truncate font-medium">
          {user.full_name}
          {user.is_platform_admin && <Badge tone="accent">مدير منصة</Badge>}
        </div>
        <div className="truncate text-xs text-muted" dir="ltr">
          {[user.email, user.phone ? formatPhone(user.phone) : null].filter(Boolean).join(" · ")}
        </div>
      </div>
    </div>
  );
}

function MfaBadge({ enabled }: { enabled?: boolean }) {
  return enabled
    ? <Badge tone="success"><ShieldCheck className="size-3" /> مفعّلة</Badge>
    : <Badge tone="neutral"><ShieldOff className="size-3" /> غير مفعّلة</Badge>;
}

function ActiveBadge({ active }: { active?: boolean }) {
  return <Badge tone={active ? "success" : "danger"} dot>{active ? "فعال" : "معطل"}</Badge>;
}
