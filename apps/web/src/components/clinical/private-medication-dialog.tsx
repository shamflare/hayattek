"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { m } from "@/lib/i18n";

const blank = { name: "", active_ingredient: "", strength: "", dosage_form: "tablet", unit: "", default_route: "oral" };

/** A medicine missing from the catalog, saved for this physician only (isolation). It is added
 *  to their favorites so it appears as a one-tap chip in every new prescription. */
export function PrivateMedicationDialog({ open, onOpenChange, initialName = "", onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialName?: string;
  onCreated?: (med: Schemas["Medication"]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <PrivateMedicationForm initialName={initialName} onOpenChange={onOpenChange} onCreated={onCreated} />}
    </Dialog>
  );
}

function PrivateMedicationForm({ initialName, onOpenChange, onCreated }: {
  initialName: string;
  onOpenChange: (o: boolean) => void;
  onCreated?: (med: Schemas["Medication"]) => void;
}) {
  const qc = useQueryClient();
  const [f, setF] = React.useState({ ...blank, name: initialName });

  const create = useMutation({
    mutationFn: async () => {
      const med = await unwrap(api.POST("/api/v1/medications/catalog", { body: f as never }));
      await api.POST("/api/v1/medications/favorites", { body: { medication_id: med.id } as never });
      return med;
    },
    onSuccess: (med) => {
      qc.invalidateQueries({ queryKey: ["favorites"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
      toast.success("حُفظ الدواء في أدويتك الخاصة");
      onCreated?.(med);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
      <DialogContent title="إضافة دواء خاص"
        description="يُحفظ لك وحدك ويظهر في مفضلتك وفي بحث الوصفات. لا يراه أي طبيب آخر إلا إذا اعتمدته إدارة المنصة للجميع."
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button loading={create.isPending} disabled={!f.name.trim()} onClick={() => create.mutate()}><Lock className="size-4" /> حفظ</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الاسم كما يُكتب في الوصفة" className="sm:col-span-2">
            <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="مثال: Augmentin" autoFocus />
          </Field>
          <Field label="المادة الفعالة أو الاسم العلمي" optional className="sm:col-span-2">
            <Input dir="ltr" className="text-start" value={f.active_ingredient} onChange={(e) => setF({ ...f, active_ingredient: e.target.value })} placeholder="Amoxicillin + clavulanic acid" />
          </Field>
          <Field label="التركيز" optional><Input dir="ltr" className="text-start" value={f.strength} onChange={(e) => setF({ ...f, strength: e.target.value })} placeholder="1 g" /></Field>
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
  );
}
