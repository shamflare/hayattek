"use client";

import { Building2, ChevronLeft, UserRound } from "lucide-react";

import { RecordStatusBadge, SourceBadge } from "@/components/ui/status";
import type { Schemas } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";

import { recordTypeMeta, RecordTypeIcon } from "./portal";

type TimelineItem = Schemas["TimelineItem"];

export function TimelineCard({ item, onOpen }: { item: TimelineItem; onOpen: (item: TimelineItem) => void }) {
  const meta = recordTypeMeta(item.type);
  const byPatient = item.source === "patient";
  return (
    <button type="button" onClick={() => onOpen(item)}
      className={cn(
        "group flex w-full items-start gap-3 rounded-card border bg-elevated p-4 text-start shadow-soft transition-colors hover:border-brand-300 sm:gap-4",
        byPatient ? "border-dashed border-accent/50" : "border-line",
      )}>
      <RecordTypeIcon type={item.type} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="font-medium text-brand-700 dark:text-brand-300">{meta.label}</span>
          <span aria-hidden>·</span>
          <span>{formatDate(item.occurred_at)}</span>
        </div>
        <div className="mt-1 text-[16px] font-semibold leading-7 text-fg"><bdi>{item.title}</bdi></div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          {item.author_name && (
            <span className="inline-flex items-center gap-1"><UserRound className="size-3.5" /> {item.author_name}</span>
          )}
          {item.organization_name && (
            <span className="inline-flex items-center gap-1"><Building2 className="size-3.5" /> {item.organization_name}</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {!byPatient && <RecordStatusBadge status={item.status} />}
          <SourceBadge source={item.source} />
        </div>
      </div>
      <ChevronLeft className="mt-3 size-5 shrink-0 text-subtle transition-transform group-hover:-translate-x-0.5" />
    </button>
  );
}
