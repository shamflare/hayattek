"use client";

import { useQuery } from "@tanstack/react-query";
import { Inbox, Send } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/app/page-header";
import { Badge, Card, EmptyState, ErrorState, SkeletonList } from "@/components/ui/surface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { label } from "@/lib/i18n";

export default function ReferralsPage() {
  const inbox = useQuery({ queryKey: ["referrals", "inbox"], queryFn: () => unwrap(api.GET("/api/v1/referrals/inbox")) });
  const sent = useQuery({ queryKey: ["referrals", "sent"], queryFn: () => unwrap(api.GET("/api/v1/referrals/sent")) });
  return (
    <div className="animate-fade-up">
      <PageHeader title="الإحالات" description="الإحالات الواردة إليك وإلى منشأتك، والإحالات التي أرسلتها." />
      <Tabs defaultValue="inbox" dir="rtl">
        <TabsList className="mb-4 w-fit">
          <TabsTrigger value="inbox"><Inbox className="size-4" /> الواردة</TabsTrigger>
          <TabsTrigger value="sent"><Send className="size-4" /> المرسلة</TabsTrigger>
        </TabsList>
        <TabsContent value="inbox"><List query={inbox} direction="in" /></TabsContent>
        <TabsContent value="sent"><List query={sent} direction="out" /></TabsContent>
      </Tabs>
    </div>
  );
}

function List({ query, direction }: {
  query: { data?: { results: Schemas["Referral"][] }; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
  direction: "in" | "out";
}) {
  if (query.isLoading) return <SkeletonList />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} onRetry={query.refetch} />;
  const rows = query.data?.results ?? [];
  if (!rows.length) return <Card><EmptyState icon={<Send className="size-6" />} title="لا توجد إحالات" /></Card>;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <Link key={r.id} href={`/app/referrals/${r.id}`} className="block">
          <Card className="flex flex-wrap items-center gap-4 p-4 transition hover:border-brand-300 hover:shadow-card">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.patient_brief.full_name}</span>
                {r.priority !== "routine" && <Badge tone="danger">{label("priority", r.priority)}</Badge>}
                <Badge tone={r.state === "sent" ? "warning" : r.state === "accepted" ? "success" : "neutral"}>{label("referralState", r.state)}</Badge>
              </div>
              <div className="mt-1 truncate text-sm text-muted">
                {direction === "in"
                  ? `من ${r.author_name}${r.organization_name ? ` · ${r.organization_name}` : ""}`
                  : `إلى ${r.target_practitioner_name ?? r.target_organization_name ?? label("specialties", r.target_specialty)}`}
              </div>
              <p className="mt-1 line-clamp-1 text-sm">{r.reason}</p>
            </div>
            <span className="text-xs text-subtle">{relativeTime(r.occurred_at)}</span>
          </Card>
        </Link>
      ))}
    </div>
  );
}
