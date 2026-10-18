"use client";

import {
  AlertTriangle, ClipboardList, FileText, FlaskConical, HeartPulse, Image as ImageIcon, Send,
  Stethoscope, TestTubes,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { RecordStatusBadge, SourceBadge } from "@/components/ui/status";
import { EmptyState, ErrorState, SkeletonList } from "@/components/ui/surface";
import { TabsList, TabsTrigger, Tabs } from "@/components/ui/tabs";
import { errorMessage, type Schemas } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate, formatTime } from "@/lib/format";

import { useTimeline } from "./queries";
import { RecordViewer } from "./record-viewer";

type Item = Schemas["TimelineItem"];

export const TYPE_META: Record<string, { label: string; icon: React.ElementType; tone: string }> = {
  encounter: { label: "زيارة", icon: Stethoscope, tone: "bg-brand-50 text-brand-600" },
  prescription: { label: "وصفة", icon: ClipboardList, tone: "bg-accent-soft text-accent" },
  lab_report: { label: "تحليل", icon: FlaskConical, tone: "bg-info-soft text-info" },
  imaging_report: { label: "تصوير", icon: ImageIcon, tone: "bg-warning-soft text-warning" },
  document: { label: "مستند", icon: FileText, tone: "bg-sunken text-muted" },
  service_request: { label: "طلب", icon: TestTubes, tone: "bg-sunken text-muted" },
  referral: { label: "إحالة", icon: Send, tone: "bg-sunken text-muted" },
  condition: { label: "تشخيص", icon: HeartPulse, tone: "bg-sunken text-muted" },
  allergy: { label: "حساسية", icon: AlertTriangle, tone: "bg-danger-soft text-danger" },
};

const FILTERS = [
  { value: "", label: "الكل" },
  { value: "encounter", label: "الزيارات" },
  { value: "prescription", label: "الوصفات" },
  { value: "lab_report,service_request", label: "التحاليل والطلبات" },
  { value: "imaging_report", label: "الأشعة" },
  { value: "document", label: "المستندات" },
  { value: "referral", label: "الإحالات" },
];

export function Timeline({ patientId, enabled = true }: { patientId: string; enabled?: boolean }) {
  const [filter, setFilter] = React.useState("");
  const [open, setOpen] = React.useState<Item | null>(null);
  const query = useTimeline(patientId, filter, enabled);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  // Group by day for readability.
  const groups: { day: string; items: Item[] }[] = [];
  for (const item of items) {
    const day = formatDate(item.occurred_at);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }

  return (
    <div>
      <Tabs value={filter} onValueChange={setFilter} dir="rtl">
        <TabsList className="mb-4">
          {FILTERS.map((f) => <TabsTrigger key={f.value} value={f.value}>{f.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {query.isLoading ? <SkeletonList rows={5} /> : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !items.length ? (
        <EmptyState icon={<Stethoscope className="size-6" />} title="لا توجد سجلات بعد" description="ستظهر هنا الزيارات والوصفات والتحاليل بترتيب زمني." />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.day}>
              <div className="sticky top-16 z-10 mb-2 bg-bg/90 py-1 text-xs font-semibold text-subtle backdrop-blur">{g.day}</div>
              <ol className="relative space-y-2.5 border-s-2 border-line ps-5">
                {g.items.map((item) => <TimelineCard key={`${item.type}-${item.id}`} item={item} onOpen={() => setOpen(item)} />)}
              </ol>
            </div>
          ))}
          {query.hasNextPage && (
            <div className="text-center">
              <Button variant="outline" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>عرض الأقدم</Button>
            </div>
          )}
        </div>
      )}
      <RecordViewer item={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function TimelineCard({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const meta = TYPE_META[item.type] ?? TYPE_META.document;
  const href = item.type === "encounter" ? `/app/encounters/${item.id}`
    : item.type === "prescription" ? `/app/prescriptions/${item.id}` : null;
  const body = (
    <>
      <span className={cn("absolute -start-[29px] top-4 grid size-4 place-items-center rounded-full border-2 border-bg", meta.tone)} />
      <div className={cn("grid size-10 shrink-0 place-items-center rounded-xl", meta.tone)}><meta.icon className="size-5" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{item.title}</span>
          {item.status !== "final" && <RecordStatusBadge status={item.status} />}
          <SourceBadge source={item.source} />
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">
          {meta.label} · {item.author_name}{item.organization_name ? ` · ${item.organization_name}` : ""}
        </div>
      </div>
      <span className="num shrink-0 text-xs text-subtle">{formatTime(item.occurred_at)}</span>
    </>
  );
  const cls = cn("relative flex w-full items-center gap-3 rounded-2xl border border-line bg-elevated p-3 text-start shadow-soft transition hover:border-brand-300 hover:shadow-card",
    item.status === "entered_in_error" && "opacity-60");
  return (
    <li>
      {href ? <Link href={href} className={cls}>{body}</Link> : <button onClick={onOpen} className={cls}>{body}</button>}
    </li>
  );
}
