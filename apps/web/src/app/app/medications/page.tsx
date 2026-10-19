"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, LayoutTemplate, Pill, Plus, Search, Star, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import {
  blankItem, EmptyItems, fromApiItem, ItemCard, MedicationPicker, type RxItem, sigOf, toApiItem,
} from "@/components/clinical/prescription-editor";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Card, EmptyState, SkeletonList } from "@/components/ui/surface";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { useDebounced } from "@/lib/hooks";
import { label, m } from "@/lib/i18n";

export default function MedicationsPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader title="أدويتي وقوالبي" description="قائمتك الخاصة تظهر أولاً عند كتابة أي وصفة. تعديل القوالب لا يغيّر الوصفات القديمة." />
      <Tabs defaultValue="favorites" dir="rtl">
        <TabsList className="mb-5 w-fit">
          <TabsTrigger value="favorites"><Star className="size-4" /> المفضلة</TabsTrigger>
          <TabsTrigger value="templates"><LayoutTemplate className="size-4" /> قوالب الوصفات</TabsTrigger>
        </TabsList>
        <TabsContent value="favorites"><Favorites /></TabsContent>
        <TabsContent value="templates"><Templates /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ favorites */

function Favorites() {
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const [customOpen, setCustomOpen] = React.useState(false);
  const query = useDebounced(q.trim(), 250);
  const favorites = useQuery({ queryKey: ["favorites"], queryFn: () => unwrap(api.GET("/api/v1/medications/favorites")) });
  const search = useQuery({
    queryKey: ["catalog", query],
    queryFn: () => unwrap(api.GET("/api/v1/medications/catalog", { params: { query: { q: query } } })),
    enabled: query.length >= 2,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["favorites"] });
  const add = useMutation({
    mutationFn: (id: string) => unwrap(api.POST("/api/v1/medications/favorites", { body: { medication_id: id } as never })),
    onSuccess: () => { refresh(); toast.success("أضيف إلى المفضلة"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.DELETE("/api/v1/medications/favorites/{id}", { params: { path: { id } } }),
    onSuccess: refresh,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => unwrap(api.POST("/api/v1/medications/favorites/reorder", { body: { ids } })),
    onSuccess: (data) => qc.setQueryData(["favorites"], data),
  });
  const list = favorites.data ?? [];
  const move = (index: number, delta: number) => {
    const ids = list.map((f) => f.id);
    const [x] = ids.splice(index, 1);
    ids.splice(index + delta, 0, x);
    reorder.mutate(ids);
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_380px]">
      <Card className="p-2">
        {favorites.isLoading ? <div className="p-3"><SkeletonList /></div> : list.length ? (
          <ul className="divide-y divide-line">
            {list.map((f, i) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-3">
                <div className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent"><Pill className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{f.medication.name} <span className="num text-sm text-muted">{f.medication.strength}</span></div>
                  <div className="text-xs text-muted">{label("dosageForms", f.medication.dosage_form)} · استُخدم <span className="num">{f.use_count}</span> مرة</div>
                </div>
                <Button variant="ghost" size="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="أعلى"><ArrowUp className="size-4" /></Button>
                <Button variant="ghost" size="icon" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label="أسفل"><ArrowDown className="size-4" /></Button>
                <Button variant="danger-ghost" size="icon" onClick={() => remove.mutate(f.id)} aria-label="إزالة"><Trash2 className="size-4" /></Button>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={<Star className="size-6" />} title="لا توجد أدوية مفضلة" description="ابحث عن الأدوية التي تصفها كثيراً وأضفها." />}
      </Card>
      <Card className="p-4">
        <div className="mb-3 font-semibold">إضافة من الكتالوج</div>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="ps-9" placeholder="اسم الدواء…" />
        </div>
        <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto">
          {(search.data?.results ?? []).map((med) => {
            const exists = list.some((f) => f.medication.id === med.id);
            return (
              <li key={med.id} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-sunken">
                <span className="flex-1 text-sm">{med.name} <span className="num text-muted">{med.strength}</span></span>
                <Button size="sm" variant={exists ? "ghost" : "secondary"} disabled={exists} onClick={() => add.mutate(med.id)}>
                  {exists ? "مضاف" : <><Plus className="size-4" /> إضافة</>}
                </Button>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs leading-6 text-subtle">
          الكتالوج يضم الأدوية الأساسية بأسمائها العلمية. دواء تجاري أو غير موجود؟{" "}
          <button className="font-semibold text-brand-600" onClick={() => setCustomOpen(true)}>أضفه إلى الكتالوج</button>
        </p>
      </Card>
      <CustomMedicationDialog open={customOpen} onOpenChange={setCustomOpen} onCreated={(id) => add.mutate(id)} />
    </div>
  );
}

function CustomMedicationDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const [f, setF] = React.useState({ name: "", brand_name: "", strength: "", dosage_form: "tablet", unit: "", default_route: "oral" });
  const create = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/medications/catalog", { body: f as never })),
    onSuccess: (med) => { onCreated(med.id); onOpenChange(false); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="إضافة دواء إلى الكتالوج" description="يُسجّل كمصدر «أضافه طبيب». لا تكتب مادة فعالة غير مؤكدة."
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button loading={create.isPending} disabled={!f.name.trim()} onClick={() => create.mutate()}>إضافة</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الاسم كما يُكتب في الوصفة" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="التركيز" optional><Input dir="ltr" className="text-start" value={f.strength} onChange={(e) => setF({ ...f, strength: e.target.value })} placeholder="500 mg" /></Field>
          <Field label="وحدة الجرعة" optional><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="حبة" /></Field>
          <Field label="الشكل">
            <Select value={f.dosage_form} onChange={(e) => setF({ ...f, dosage_form: e.target.value })}>
              {Object.entries(m.dosageForms).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="طريق الإعطاء">
            <Select value={f.default_route} onChange={(e) => setF({ ...f, default_route: e.target.value })}>
              {Object.entries(m.routes).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ templates */

function Templates() {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ["rx-templates"], queryFn: () => unwrap(api.GET("/api/v1/medications/templates")) });
  const [editing, setEditing] = React.useState<Schemas["Template"] | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.DELETE("/api/v1/medications/templates/{id}", { params: { path: { id } } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rx-templates"] }); setDeleting(null); },
  });
  if (editing) return <TemplateEditor template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />;
  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing("new")}><Plus className="size-4" /> قالب جديد</Button></div>
      {templates.isLoading ? <SkeletonList /> : templates.data?.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.data.map((t) => {
            const items = (t.items as unknown as Record<string, unknown>[]).map(fromApiItem);
            return (
              <Card key={t.id} className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold">{t.name}</div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>تعديل</Button>
                    <Button variant="danger-ghost" size="icon" onClick={() => setDeleting(t.id)} aria-label="حذف"><Trash2 className="size-4" /></Button>
                  </div>
                </div>
                <ul className="mt-3 space-y-2 text-sm">
                  {items.map((i) => <li key={i.key}><span className="font-medium">{i.medication_name}</span> <span className="text-muted">— {sigOf(i)}</span></li>)}
                </ul>
              </Card>
            );
          })}
        </div>
      ) : <Card><EmptyState icon={<LayoutTemplate className="size-6" />} title="لا توجد قوالب" description="أنشئ قوالب للحالات المتكررة مثل التهاب البلعوم أو نزلة البرد." /></Card>}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="حذف القالب؟" tone="danger" confirmLabel="حذف"
        description="الوصفات التي كُتبت سابقاً من هذا القالب لن تتأثر." loading={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting)} />
    </div>
  );
}

function TemplateEditor({ template, onClose }: { template: Schemas["Template"] | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState(template?.name ?? "");
  const [items, setItems] = React.useState<RxItem[]>(() =>
    ((template?.items ?? []) as unknown as Record<string, unknown>[]).map(fromApiItem));
  const save = useMutation({
    mutationFn: () => {
      const body = { name, notes: "", items: items.map(toApiItem) } as never;
      return template
        ? unwrap(api.PATCH("/api/v1/medications/templates/{id}", { params: { path: { id: template.id } }, body }))
        : unwrap(api.POST("/api/v1/medications/templates", { body }));
    },
    onSuccess: () => { toast.success("حُفظ القالب"); qc.invalidateQueries({ queryKey: ["rx-templates"] }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label="اسم القالب" className="flex-1"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: التهاب بلعوم — بالغين" /></Field>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button loading={save.isPending} disabled={!name.trim() || !items.length} onClick={() => save.mutate()}>حفظ القالب</Button>
        </div>
      </Card>
      <MedicationPicker onPick={(med, preset) => setItems((all) => [...all, blankItem(med.id ? med : { name: med.name }, preset)])}
        onApplyTemplate={(tpl) => setItems((all) => [...all, ...tpl.map(fromApiItem)])} />
      {items.length ? items.map((item, index) => (
        <ItemCard key={item.key} item={item} index={index}
          onChange={(next) => setItems((all) => all.map((x) => (x.key === item.key ? next : x)))}
          onRemove={() => setItems((all) => all.filter((x) => x.key !== item.key))} />
      )) : <EmptyItems />}
    </div>
  );
}
