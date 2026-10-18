"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, GripVertical, LayoutTemplate, Pill, Plus, Search, Star, Trash2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ChoiceChips, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Card } from "@/components/ui/surface";
import { api, type Schemas, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/lib/hooks";
import { label, m } from "@/lib/i18n";

import { renderSig } from "./sig";

export interface RxItem {
  key: string;
  medication: string | null;
  medication_name: string;
  strength: string;
  dosage_form: string;
  dose_amount: string;
  dose_unit: string;
  route: string;
  schedule_type: string;
  times_of_day: string[];
  times_per_day: string;
  interval_hours: string;
  interval_days: string;
  weekdays: string[];
  as_needed_reason: string;
  meal_relation: string;
  duration_value: string;
  duration_unit: string;
  end_date: string;
  quantity: string;
  quantity_unit: string;
  instructions: string;
}

let counter = 0;
const newKey = () => `i${Date.now()}${counter++}`;

export function blankItem(med?: Partial<Schemas["Medication"]> & { id?: string }, preset?: Record<string, unknown>): RxItem {
  return {
    key: newKey(),
    medication: med?.id ?? null,
    medication_name: med?.name ?? "",
    strength: med?.strength ?? "",
    dosage_form: med?.dosage_form ?? "",
    dose_amount: "1",
    dose_unit: med?.unit ?? "",
    route: med?.default_route ?? "",
    schedule_type: "times_of_day",
    times_of_day: [],
    times_per_day: "",
    interval_hours: "",
    interval_days: "",
    weekdays: [],
    as_needed_reason: "",
    meal_relation: "",
    duration_value: "",
    duration_unit: "days",
    end_date: "",
    quantity: "",
    quantity_unit: "",
    instructions: "",
    ...(preset as Partial<RxItem> | undefined),
  };
}

/** Convert a saved/serialized item (API or template) into editor state. */
export function fromApiItem(i: Record<string, unknown>): RxItem {
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return {
    key: newKey(),
    medication: (i.medication as string) ?? null,
    medication_name: s(i.medication_name), strength: s(i.strength), dosage_form: s(i.dosage_form),
    dose_amount: i.dose_amount ? String(Number(i.dose_amount)) : "", dose_unit: s(i.dose_unit), route: s(i.route),
    schedule_type: s(i.schedule_type) || "times_of_day", times_of_day: (i.times_of_day as string[]) ?? [],
    times_per_day: s(i.times_per_day), interval_hours: s(i.interval_hours), interval_days: s(i.interval_days),
    weekdays: (i.weekdays as string[]) ?? [], as_needed_reason: s(i.as_needed_reason), meal_relation: s(i.meal_relation),
    duration_value: s(i.duration_value), duration_unit: s(i.duration_unit), end_date: s(i.end_date),
    quantity: i.quantity ? String(Number(i.quantity)) : "", quantity_unit: s(i.quantity_unit), instructions: s(i.instructions),
  };
}

/** Editor state → API payload (only fields relevant to the schedule are sent). */
export function toApiItem(i: RxItem) {
  const n = (v: string) => (v === "" ? null : Number(v));
  return {
    medication: i.medication, medication_name: i.medication_name, strength: i.strength,
    dosage_form: i.dosage_form, dose_amount: i.dose_amount || null, dose_unit: i.dose_unit, route: i.route,
    schedule_type: i.schedule_type,
    times_of_day: i.schedule_type === "times_of_day" ? i.times_of_day : [],
    times_per_day: i.schedule_type === "times_per_day" ? n(i.times_per_day) : null,
    interval_hours: i.schedule_type === "every_hours" ? n(i.interval_hours) : null,
    interval_days: i.schedule_type === "every_days" ? n(i.interval_days) : null,
    weekdays: i.schedule_type === "weekly" ? i.weekdays : [],
    as_needed_reason: i.schedule_type === "as_needed" ? i.as_needed_reason : "",
    meal_relation: i.meal_relation, duration_value: i.duration_unit === "ongoing" ? null : n(i.duration_value),
    duration_unit: i.duration_value || i.duration_unit === "ongoing" ? i.duration_unit : "",
    end_date: i.end_date || null, quantity: i.quantity || null, quantity_unit: i.quantity_unit,
    instructions: i.instructions,
  };
}

export function sigOf(i: RxItem) {
  return renderSig({
    ...i, times_per_day: Number(i.times_per_day) || null, interval_hours: Number(i.interval_hours) || null,
    interval_days: Number(i.interval_days) || null, duration_value: Number(i.duration_value) || null,
    end_date: i.end_date || null,
  });
}

/* ================================================================== picker */

export function MedicationPicker({ onPick, onApplyTemplate }: {
  onPick: (med: Schemas["Medication"], preset?: Record<string, unknown>) => void;
  onApplyTemplate: (items: Record<string, unknown>[]) => void;
}) {
  const [q, setQ] = React.useState("");
  const query = useDebounced(q.trim(), 250);
  const favorites = useQuery({
    queryKey: ["favorites"],
    queryFn: () => unwrap(api.GET("/api/v1/medications/favorites")),
  });
  const templates = useQuery({
    queryKey: ["rx-templates"],
    queryFn: () => unwrap(api.GET("/api/v1/medications/templates")),
  });
  const search = useQuery({
    queryKey: ["catalog", query],
    queryFn: () => unwrap(api.GET("/api/v1/medications/catalog", { params: { query: { q: query } } })),
    enabled: query.length >= 2,
  });

  return (
    <Card className="p-4">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} className="h-12 ps-11 text-base"
          placeholder="ابحث عن دواء بالاسم التجاري أو العلمي…" />
      </div>
      {query.length >= 2 ? (
        <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
          {(search.data?.results ?? []).map((med) => (
            <button key={med.id} type="button" onClick={() => { onPick(med); setQ(""); }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start hover:bg-sunken">
              <Pill className="size-4 text-accent" />
              <span className="flex-1 font-medium">{med.name} <span className="num text-sm font-normal text-muted">{med.strength}</span></span>
              <span className="text-xs text-subtle">{label("dosageForms", med.dosage_form)}</span>
            </button>
          ))}
          {search.data && !search.data.results.length && (
            <button type="button" onClick={() => { onPick({ id: "", name: q.trim() } as Schemas["Medication"]); setQ(""); }}
              className="w-full rounded-xl border border-dashed border-line-strong px-3 py-3 text-sm text-muted hover:border-brand-400">
              غير موجود في الكتالوج — أضف «{q.trim()}» كنص حر
            </button>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted"><Star className="size-3.5" /> أدويتي المفضلة</div>
            {favorites.data?.length ? (
              <div className="flex flex-wrap gap-2">
                {favorites.data.map((f) => (
                  <button key={f.id} type="button" onClick={() => onPick(f.medication, f.preset as Record<string, unknown>)}
                    className="rounded-full border border-line bg-elevated px-3.5 py-2 text-sm transition hover:border-brand-400 hover:bg-brand-50">
                    {f.medication.name} <span className="num text-xs text-muted">{f.medication.strength}</span>
                  </button>
                ))}
              </div>
            ) : <p className="text-sm text-subtle">أضف أدويتك المتكررة من صفحة «أدويتي وقوالبي» لتظهر هنا.</p>}
          </div>
          {!!templates.data?.length && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted"><LayoutTemplate className="size-3.5" /> قوالبي</div>
              <div className="flex flex-wrap gap-2">
                {templates.data.map((t) => (
                  <button key={t.id} type="button" onClick={() => onApplyTemplate(t.items as unknown as Record<string, unknown>[])}
                    className="rounded-full bg-brand-50 px-3.5 py-2 text-sm text-brand-800 hover:bg-brand-100 dark:text-brand-200">
                    {t.name} <span className="num text-xs opacity-70">({(t.items as unknown[]).length})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/* ================================================================== item card */

export function ItemCard({ item, index, onChange, onRemove }: {
  item: RxItem; index: number; onChange: (i: RxItem) => void; onRemove: () => void;
}) {
  const [more, setMore] = React.useState(Boolean(item.instructions || item.quantity || item.end_date));
  const set = <K extends keyof RxItem>(k: K, v: RxItem[K]) => onChange({ ...item, [k]: v });
  const sig = sigOf(item);
  const incomplete =
    (item.schedule_type === "times_of_day" && !item.times_of_day.length) ||
    (item.schedule_type === "custom" && !item.instructions);

  return (
    <Card className={cn("overflow-hidden", incomplete && "border-warning/50")}>
      <div className="flex items-center gap-3 border-b border-line bg-sunken/40 px-4 py-3">
        <GripVertical className="size-4 text-subtle" />
        <span className="num grid size-7 place-items-center rounded-full bg-accent text-xs font-bold text-white">{index + 1}</span>
        <div className="min-w-0 flex-1">
          {item.medication ? (
            <div className="truncate font-semibold">{item.medication_name} <span className="num font-normal text-muted">{item.strength}</span></div>
          ) : (
            <Input value={item.medication_name} onChange={(e) => set("medication_name", e.target.value)} className="h-9" placeholder="اسم الدواء" />
          )}
          {item.dosage_form && <div className="text-xs text-muted">{label("dosageForms", item.dosage_form)}{item.route ? ` · ${label("routes", item.route)}` : ""}</div>}
        </div>
        <Button variant="danger-ghost" size="icon" onClick={onRemove} aria-label="حذف الدواء"><Trash2 className="size-4" /></Button>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-[110px_1fr] gap-3 sm:grid-cols-[110px_160px_1fr]">
          <Field label="الجرعة">
            <Input inputMode="decimal" className="num" value={item.dose_amount} onChange={(e) => set("dose_amount", e.target.value)} />
          </Field>
          <Field label="الوحدة">
            <Input value={item.dose_unit} onChange={(e) => set("dose_unit", e.target.value)} placeholder="حبة، مل…" />
          </Field>
          <Field label="طريقة الاستعمال" className="col-span-2 sm:col-span-1">
            <ChoiceChips value={item.schedule_type} onChange={(v) => set("schedule_type", v as string)}
              options={["times_of_day", "times_per_day", "every_hours", "every_days", "weekly", "as_needed", "single_dose", "custom"]
                .map((v) => ({ value: v, label: label("schedule", v) }))} />
          </Field>
        </div>

        {item.schedule_type === "times_of_day" && (
          <ChoiceChips multiple value={item.times_of_day} onChange={(v) => set("times_of_day", v as string[])}
            options={Object.entries(m.timesOfDay).map(([value, l]) => ({ value, label: l }))} />
        )}
        {item.schedule_type === "times_per_day" && (
          <ChoiceChips value={item.times_per_day} onChange={(v) => set("times_per_day", v as string)}
            options={["1", "2", "3", "4"].map((v) => ({ value: v, label: `${v} ×` }))} />
        )}
        {item.schedule_type === "every_hours" && (
          <ChoiceChips value={item.interval_hours} onChange={(v) => set("interval_hours", v as string)}
            options={["4", "6", "8", "12", "24"].map((v) => ({ value: v, label: `كل ${v} ساعات` }))} />
        )}
        {item.schedule_type === "every_days" && (
          <div className="flex items-center gap-2 text-sm">كل <Input inputMode="numeric" className="num w-20" value={item.interval_days} onChange={(e) => set("interval_days", e.target.value)} /> أيام</div>
        )}
        {item.schedule_type === "weekly" && (
          <ChoiceChips multiple value={item.weekdays} onChange={(v) => set("weekdays", v as string[])}
            options={Object.entries(m.weekdays).map(([value, l]) => ({ value, label: l }))} />
        )}
        {item.schedule_type === "as_needed" && (
          <Input value={item.as_needed_reason} onChange={(e) => set("as_needed_reason", e.target.value)} placeholder="عند الحاجة لـ… (ألم، حرارة، غثيان)" />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="علاقة بالطعام">
            <ChoiceChips value={item.meal_relation} onChange={(v) => set("meal_relation", (v as string) === item.meal_relation ? "" : (v as string))}
              options={Object.entries(m.meals).map(([value, l]) => ({ value, label: l }))} />
          </Field>
          <Field label="المدة">
            <div className="flex gap-2">
              {item.duration_unit !== "ongoing" && (
                <Input inputMode="numeric" className="num w-20" value={item.duration_value} onChange={(e) => set("duration_value", e.target.value)} />
              )}
              <Select value={item.duration_unit} onChange={(e) => set("duration_unit", e.target.value)} className="flex-1">
                {Object.entries(m.durationUnits).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
          </Field>
        </div>

        <button type="button" onClick={() => setMore((v) => !v)} className="flex items-center gap-1 text-sm text-brand-600">
          <ChevronDown className={cn("size-4 transition-transform", more && "rotate-180")} /> الكمية والتعليمات الإضافية
        </button>
        {more && (
          <div className="grid gap-4 sm:grid-cols-[120px_140px_1fr]">
            <Field label="الكمية"><Input inputMode="decimal" className="num" value={item.quantity} onChange={(e) => set("quantity", e.target.value)} /></Field>
            <Field label="وحدتها"><Input value={item.quantity_unit} onChange={(e) => set("quantity_unit", e.target.value)} placeholder="علبة، عبوة" /></Field>
            <Field label="أو حتى تاريخ"><Input type="date" value={item.end_date} onChange={(e) => set("end_date", e.target.value)} /></Field>
            <Field label="تعليمات إضافية" className="sm:col-span-3">
              <Textarea rows={2} value={item.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="مثال: يُذاب في كوب ماء، يُرج قبل الاستعمال" />
            </Field>
          </div>
        )}

        <div className="flex items-start gap-2 rounded-xl bg-brand-50 px-3.5 py-2.5 text-[15px] leading-7 text-brand-900 dark:text-brand-100">
          <span className="text-xs font-semibold text-brand-600">على الوصفة:</span>
          <span className="flex-1">{sig || <span className="text-subtle">حدد الجرعة وطريقة الاستعمال…</span>}</span>
          {incomplete && <Badge tone="warning">ناقص</Badge>}
        </div>
      </div>
    </Card>
  );
}

export function EmptyItems() {
  return (
    <div className="flex flex-col items-center rounded-card border-2 border-dashed border-line-strong px-6 py-12 text-center text-muted">
      <Plus className="mb-2 size-7 text-subtle" />
      اختر دواءً من المفضلة أو ابحث عنه في الأعلى
    </div>
  );
}
