"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Printer, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";

import { blankItem, EmptyItems, fromApiItem, ItemCard, MedicationPicker, type RxItem, toApiItem } from "./prescription-editor";

/** Create (no `prescription`) or edit a draft prescription. */
export function PrescriptionForm({ patientId, encounterId, prescription }: {
  patientId: string; encounterId?: string | null; prescription?: Schemas["Prescription"];
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [items, setItems] = React.useState<RxItem[]>(() =>
    prescription ? prescription.items.map((i) => fromApiItem(i as unknown as Record<string, unknown>)) : []);
  const [diagnosis, setDiagnosis] = React.useState(prescription?.diagnosis_text ?? "");
  const [notes, setNotes] = React.useState(prescription?.notes ?? "");
  const [confirm, setConfirm] = React.useState(false);

  const body = () => ({
    patient: patientId, diagnosis_text: diagnosis, notes, items: items.map(toApiItem),
    ...(encounterId ? { encounter: encounterId } : {}),
  });

  const persist = async () => {
    if (prescription) {
      return unwrap(api.PATCH("/api/v1/prescriptions/{id}", {
        params: { path: { id: prescription.id } }, body: body() as never,
      }));
    }
    return unwrap(api.POST("/api/v1/prescriptions", { body: body() as never }));
  };

  const save = useMutation({
    mutationFn: persist,
    onSuccess: (rx) => {
      toast.success("حُفظت الوصفة كمسودة");
      qc.setQueryData(["prescription", rx.id], rx);
      if (!prescription) router.replace(`/app/prescriptions/${rx.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const finalize = useMutation({
    mutationFn: async () => {
      const rx = await persist();
      return unwrap(api.POST("/api/v1/prescriptions/{id}/finalize", { params: { path: { id: rx.id } } }));
    },
    onSuccess: (rx) => {
      toast.success("اعتُمدت الوصفة");
      qc.setQueryData(["prescription", rx.id], rx);
      qc.invalidateQueries({ queryKey: ["timeline", patientId] });
      qc.invalidateQueries({ queryKey: ["summary", patientId] });
      setConfirm(false);
      window.open(`/print/prescriptions/${rx.id}`, "_blank");
      router.replace(`/app/prescriptions/${rx.id}`);
    },
    onError: (e) => { toast.error(errorMessage(e)); setConfirm(false); },
  });

  const addMed = (med: Schemas["Medication"], preset?: Record<string, unknown>) =>
    setItems((all) => [...all, blankItem(med.id ? med : { name: med.name }, preset)]);
  const applyTemplate = (tplItems: Record<string, unknown>[]) =>
    setItems((all) => [...all, ...tplItems.map(fromApiItem)]);

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        <MedicationPicker onPick={addMed} onApplyTemplate={applyTemplate} />
        {items.length ? items.map((item, index) => (
          <ItemCard key={item.key} item={item} index={index}
            onChange={(next) => setItems((all) => all.map((x) => (x.key === item.key ? next : x)))}
            onRemove={() => setItems((all) => all.filter((x) => x.key !== item.key))} />
        )) : <EmptyItems />}
      </div>
      <aside className="space-y-4 lg:sticky lg:top-20">
        <Card className="space-y-4 p-4">
          <Field label="التشخيص المطبوع" optional><Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} /></Field>
          <Field label="ملاحظات للمريض" optional><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </Card>
        <Card className="grid gap-2 p-4">
          <Button size="lg" disabled={!items.length} onClick={() => setConfirm(true)}><CheckCircle2 className="size-5" /> اعتماد وطباعة</Button>
          <Button variant="outline" disabled={!items.length} loading={save.isPending} onClick={() => save.mutate()}><Save className="size-4" /> حفظ كمسودة</Button>
          <p className="flex items-center gap-1.5 pt-1 text-xs text-subtle"><Printer className="size-3.5" /> تُطبع باسم المنشأة التي تعمل باسمها الآن.</p>
        </Card>
      </aside>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="اعتماد الوصفة؟" confirmLabel="اعتماد وطباعة"
        loading={finalize.isPending} onConfirm={() => finalize.mutate()}
        description={`تحتوي ${items.length} ${items.length > 2 ? "أدوية" : "دواء"}. بعد الاعتماد تظهر في ملف المريض، ولا تُعدّل إلا بتصحيح موثق.`} />
    </div>
  );
}
