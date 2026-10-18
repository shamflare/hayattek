"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Badge, type Tone } from "@/components/ui/surface";
import { cn } from "@/lib/cn";
import { label } from "@/lib/i18n";

/** Default page size of the API (apps.core.pagination.StandardPagination). */
export const PAGE_SIZE = 20;

export function KpiTile({
  label: title, value, icon, hint, href, tone = "neutral", className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  tone?: "neutral" | "danger" | "warning" | "brand";
  className?: string;
}) {
  const toneClass = {
    neutral: "border-line bg-elevated",
    brand: "border-brand-100 bg-brand-50/60",
    warning: "border-warning/30 bg-warning-soft",
    danger: "border-danger/30 bg-danger-soft",
  }[tone];
  const iconClass = {
    neutral: "bg-sunken text-brand-600",
    brand: "bg-elevated text-brand-600",
    warning: "bg-elevated text-warning",
    danger: "bg-elevated text-danger",
  }[tone];
  const body = (
    <div className={cn("flex h-full flex-col gap-3 rounded-card border p-4 shadow-soft transition-colors sm:p-5",
      toneClass, href && "hover:border-brand-300", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-muted">{title}</span>
        {icon && <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", iconClass)}>{icon}</span>}
      </div>
      <div className={cn("text-3xl font-bold tracking-tight", tone === "danger" ? "text-danger" : "text-fg")}>
        <span className="num">{value}</span>
      </div>
      {hint && <div className="mt-auto text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block rounded-card">{body}</Link> : body;
}

export function SearchBox({
  value, onChange, placeholder, className,
}: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="ps-9 pe-9" type="search" />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="مسح البحث"
          className="absolute end-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-subtle hover:bg-sunken hover:text-fg">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function Pager({
  page, count, pageSize = PAGE_SIZE, onPage,
}: { page: number; count: number; pageSize?: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-4 text-sm text-muted">
      <span>
        صفحة <span className="num">{page}</span> من <span className="num">{pages}</span>
        {" · "}<span className="num">{count}</span> نتيجة
      </span>
      <div className="flex gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronRight className="size-4" /> السابق
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          التالي <ChevronLeft className="size-4" />
        </Button>
      </div>
    </div>
  );
}

const orgStatusTone: Record<string, Tone> = { active: "success", pending: "warning", suspended: "danger" };
export function OrgStatusBadge({ status }: { status: string }) {
  return <Badge tone={orgStatusTone[status] ?? "neutral"} dot>{label("orgStatus", status)}</Badge>;
}

const verificationTone: Record<string, Tone> = {
  pending: "warning", verified: "success", rejected: "danger", suspended: "neutral",
};
export function VerificationBadge({ status }: { status: string }) {
  return <Badge tone={verificationTone[status] ?? "neutral"}>{label("verification", status)}</Badge>;
}

const membershipStatus: Record<string, { text: string; tone: Tone }> = {
  active: { text: "فعال", tone: "success" },
  suspended: { text: "موقوف", tone: "danger" },
  ended: { text: "منتهٍ", tone: "neutral" },
};
export function MembershipStatusBadge({ status }: { status?: string }) {
  const s = membershipStatus[status ?? "active"] ?? { text: status ?? "—", tone: "neutral" as Tone };
  return <Badge tone={s.tone} dot>{s.text}</Badge>;
}

export function RoleBadges({ roles }: { roles?: string[] | null }) {
  if (!roles?.length) return <span className="text-subtle">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => <Badge key={r} tone="brand">{label("roles", r)}</Badge>)}
    </div>
  );
}

/** A table on wide screens, stacked cards on phones. Pass both renderers. */
export function ResponsiveList<T>({
  items, rowKey, head, row, card, rowClassName,
}: {
  items: T[];
  rowKey: (item: T) => string;
  head: React.ReactNode[];
  row: (item: T) => React.ReactNode[];
  card: (item: T) => React.ReactNode;
  rowClassName?: (item: T) => string | undefined;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-start text-xs text-subtle">
              {head.map((h, i) => <th key={i} className="px-4 py-3 text-start font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={rowKey(item)} className={cn("border-b border-line last:border-0 hover:bg-sunken/50", rowClassName?.(item))}>
                {row(item).map((cell, i) => <td key={i} className="px-4 py-3 align-middle">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-line md:hidden">
        {items.map((item) => (
          <div key={rowKey(item)} className={cn("p-4", rowClassName?.(item))}>{card(item)}</div>
        ))}
      </div>
    </>
  );
}

/** Page number that resets to 1 whenever `resetKey` (the active filters) changes. */
export function usePageFor(resetKey: string): [number, (page: number) => void] {
  const [state, setState] = React.useState({ key: resetKey, page: 1 });
  const page = state.key === resetKey ? state.page : 1;
  return [page, (p: number) => setState({ key: resetKey, page: p })];
}

/** Copies text and briefly shows a confirmation label. */
export function useCopy() {
  const [copied, setCopied] = React.useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return { copied, copy };
}
