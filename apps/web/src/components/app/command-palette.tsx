"use client";

import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, ScanLine, Search, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog as D } from "radix-ui";
import * as React from "react";

import { Avatar, Kbd } from "@/components/ui/surface";
import { api, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ageLabel, sexLabel } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = React.useState("");
  const [index, setIndex] = React.useState(0);
  const query = useDebounced(q.trim(), 250);

  const { data, isFetching } = useQuery({
    queryKey: ["patients", "search", query],
    queryFn: () => unwrap(api.GET("/api/v1/patients", { params: { query: { q: query } } })),
    enabled: open && query.length >= 2,
  });
  const patients = data?.results ?? [];

  const actions = [
    { id: "new", label: "تسجيل مريض جديد", icon: UserPlus, href: "/app/patients/new" },
    { id: "scan", label: "مسح بطاقة صحية", icon: ScanLine, href: "/app/scan" },
  ];
  const items = [
    ...patients.map((p) => ({ kind: "patient" as const, id: p.id, href: `/app/patients/${p.id}`, p })),
    ...(query.length < 2 ? actions.map((a) => ({ kind: "action" as const, ...a })) : []),
  ];

  React.useEffect(() => setIndex(0), [query]);
  React.useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-fg/30 backdrop-blur-[2px]" />
        <D.Content dir="rtl" className="fixed inset-x-3 top-[10vh] z-50 mx-auto max-w-xl overflow-hidden rounded-3xl border border-line bg-elevated shadow-float">
          <D.Title className="sr-only">بحث سريع</D.Title>
          <D.Description className="sr-only">ابحث عن مريض أو نفذ إجراءً سريعاً</D.Description>
          <div className="flex items-center gap-3 border-b border-line px-5">
            <Search className="size-5 text-subtle" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, items.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
                if (e.key === "Enter" && items[index]) go(items[index].href);
              }}
              placeholder="اسم المريض، الرقم الصحي، أو رقم الهاتف"
              className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-subtle"
            />
            {isFetching && <span className="text-xs text-subtle">…</span>}
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-2">
            {query.length >= 2 && !isFetching && patients.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted">
                لا يوجد مريض مطابق ضمن مرضى منشأتك.
                <button className="mt-2 block w-full font-semibold text-brand-600" onClick={() => go("/app/patients/new")}>
                  تسجيل مريض جديد
                </button>
              </div>
            )}
            {items.map((item, i) => (
              <button
                key={item.id}
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(item.href)}
                className={cn("flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-start", i === index && "bg-sunken")}
              >
                {item.kind === "patient" ? (
                  <>
                    <Avatar name={item.p.full_name} className="size-9 text-xs" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{item.p.full_name}</div>
                      <div className="text-xs text-muted">
                        {sexLabel(item.p.sex)} · {ageLabel(item.p.age_years, item.p.birth_date_precision)} ·{" "}
                        <span className="num">{item.p.health_number}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand-600"><item.icon className="size-4" /></div>
                    <div className="flex-1 font-medium">{item.label}</div>
                  </>
                )}
                {i === index && <CornerDownLeft className="size-4 text-subtle" />}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 border-t border-line bg-sunken/50 px-5 py-2.5 text-xs text-subtle">
            <Kbd>↑↓</Kbd> للتنقل <Kbd>Enter</Kbd> للفتح <Kbd>Esc</Kbd> للإغلاق
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
