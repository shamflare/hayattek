"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell, CheckCheck, FlaskConical, Inbox, type LucideIcon, Send, ShieldCheck, ShieldQuestion, Sparkles,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, ErrorState, SkeletonList } from "@/components/ui/surface";
import { errorMessage, patientApi, type Schemas, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";

type Notification = Schemas["Notification"];

const kindIcons: Record<string, LucideIcon> = {
  access_request: ShieldQuestion,
  access_granted: ShieldCheck,
  new_record: Sparkles,
  lab_result: FlaskConical,
  referral: Send,
  incoming_order: Inbox,
  system: Bell,
};

export default function NotificationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Notifications belong to the user, not to a practice context.
  const query = useInfiniteQuery({
    queryKey: ["notifications", "list"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      unwrap(patientApi.GET("/api/v1/notifications", { params: { query: { page: pageParam, page_size: 30 } } })),
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
  });
  const items = query.data?.pages.flatMap((p) => p.results) ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const markRead = useMutation({
    mutationFn: (id: string) => unwrap(patientApi.POST("/api/v1/notifications/{id}/read", { params: { path: { id } } })),
    onSuccess: refresh,
  });
  const markAll = useMutation({
    mutationFn: () => unwrap(patientApi.POST("/api/v1/notifications/mark-all-read")),
    onSuccess: () => { refresh(); toast.success("عُلّمت كل الإشعارات كمقروءة."); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const open = (n: Notification) => {
    if (!n.read_at) markRead.mutate(n.id);
    // Only follow in-app links.
    if (n.link && n.link.startsWith("/")) router.push(n.link);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="الإشعارات"
        actions={unread > 0 ? (
          <Button variant="outline" loading={markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck className="size-4" /> تعليم الكل كمقروء
          </Button>
        ) : undefined} />

      {query.isLoading ? (
        <Card className="p-5"><SkeletonList rows={5} /></Card>
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState icon={<Bell className="size-7" />} title="لا توجد إشعارات"
            description="سنخبرك هنا بطلبات الوصول إلى ملفك، والنتائج الجديدة، وغيرها." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {items.map((n) => {
              const Icon = kindIcons[n.kind] ?? Bell;
              const isUnread = !n.read_at;
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => open(n)}
                    className={cn("flex w-full items-start gap-3 px-4 py-4 text-start transition-colors hover:bg-sunken/60 sm:px-5",
                      isUnread && "bg-brand-50/40")}>
                    <div className={cn("grid size-10 shrink-0 place-items-center rounded-xl",
                      isUnread ? "bg-brand-50 text-brand-600" : "bg-sunken text-subtle")}>
                      <Icon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={cn("leading-7", isUnread ? "font-semibold text-fg" : "text-fg")}>{n.title}</div>
                      {n.body && <p className="mt-0.5 text-sm leading-6 text-muted">{n.body}</p>}
                      <div className="mt-1 text-xs text-subtle">{relativeTime(n.created_at)}</div>
                    </div>
                    {isUnread && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-accent" aria-label="غير مقروء" />}
                  </button>
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
      )}
    </div>
  );
}
