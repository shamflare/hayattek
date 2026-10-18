"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, PenLine, Printer } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app/page-header";
import { PrescriptionForm } from "@/components/clinical/prescription-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { RecordStatusBadge } from "@/components/ui/status";
import { Badge, Card, ErrorState, Skeleton } from "@/components/ui/surface";
import { api, errorMessage, type Schemas, unwrap } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { label } from "@/lib/i18n";

export default function PrescriptionPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: ["prescription", id],
    queryFn: () => unwrap(api.GET("/api/v1/prescriptions/{id}", { params: { path: { id } } })),
  });
  if (query.isLoading) return <Skeleton className="h-[70vh] rounded-card" />;
  if (query.isError || !query.data) return <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />;
  const rx = query.data;

  if (rx.can_edit) {
    return (
      <div className="animate-fade-up">
        <PageHeader back={`/app/patients/${rx.patient}`} eyebrow={<>مسودة وصفة · <span className="num">{rx.number}</span></>} title={rx.patient_name} />
        <PrescriptionForm patientId={rx.patient} encounterId={rx.encounter} prescription={rx} />
      </div>
    );
  }
  return <PrescriptionView rx={rx} />;
}

function PrescriptionView({ rx }: { rx: Schemas["Prescription"] }) {
  const [dialog, setDialog] = React.useState<"amend" | "void" | null>(null);
  const printable = rx.status === "final" || rx.status === "amended";
  return (
    <div className="mx-auto max-w-3xl animate-fade-up">
      <PageHeader back={`/app/patients/${rx.patient}`}
        eyebrow={<>وصفة <span className="num">{rx.number}</span></>}
        title={rx.patient_name}
        description={`${rx.author_name}${rx.organization_name ? ` · ${rx.organization_name}` : ""} · ${formatDateTime(rx.occurred_at)}`}
        actions={<>
          {printable && <Button asChild><Link href={`/print/prescriptions/${rx.id}`} target="_blank"><Printer className="size-4" /> طباعة</Link></Button>}
          {rx.can_amend && <Button variant="outline" onClick={() => setDialog("amend")}><PenLine className="size-4" /> تصحيح</Button>}
          {rx.can_amend && <Button variant="danger-ghost" onClick={() => setDialog("void")}><Ban className="size-4" /> إلغاء</Button>}
        </>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <RecordStatusBadge status={rx.status} />
        {rx.version > 1 && <Badge tone="info">نسخة <span className="num">{rx.version}</span></Badge>}
        {rx.print_count > 0 && <Badge>طُبعت <span className="num">{rx.print_count}</span> مرة</Badge>}
        {rx.status_reason && <Badge tone={rx.status === "entered_in_error" ? "danger" : "neutral"}>{rx.status_reason}</Badge>}
      </div>
      <Card className="divide-y divide-line">
        {rx.diagnosis_text && <div className="p-5 text-sm"><span className="text-muted">التشخيص: </span>{rx.diagnosis_text}</div>}
        {rx.items.map((item, i) => (
          <div key={item.id} className="flex gap-4 p-5">
            <span className="num grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{item.medication_name} <span className="num font-normal text-muted">{item.strength}</span></div>
              {item.dosage_form && <div className="text-xs text-subtle">{label("dosageForms", item.dosage_form)}</div>}
              <p className="mt-1.5 text-[15px] leading-7">{item.sig}</p>
              {item.quantity && <div className="mt-1 text-xs text-muted">الكمية: <span className="num">{Number(item.quantity)}</span> {item.quantity_unit}</div>}
            </div>
          </div>
        ))}
        {rx.notes && <div className="p-5 text-sm leading-7"><span className="text-muted">ملاحظات: </span>{rx.notes}</div>}
      </Card>
      <AmendRxDialog rx={rx} mode={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

function AmendRxDialog({ rx, mode, onClose }: { rx: Schemas["Prescription"]; mode: "amend" | "void" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = React.useState("");
  const [notes, setNotes] = React.useState(rx.notes);
  const [diagnosis, setDiagnosis] = React.useState(rx.diagnosis_text);
  const run = useMutation({
    mutationFn: () => mode === "void"
      ? unwrap(api.POST("/api/v1/prescriptions/{id}/entered-in-error", { params: { path: { id: rx.id } }, body: { reason } }))
      : unwrap(api.POST("/api/v1/prescriptions/{id}/amend", {
          params: { path: { id: rx.id } }, body: { reason, changes: { notes, diagnosis_text: diagnosis } } as never,
        })),
    onSuccess: (r) => {
      qc.setQueryData(["prescription", rx.id], r);
      toast.success(mode === "void" ? "أُلغيت الوصفة" : "تم التصحيح");
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={mode === "void" ? "إلغاء الوصفة" : "تصحيح الوصفة"}
        description={mode === "void"
          ? "تبقى الوصفة في السجل بحالة «ملغاة» ويظهر ذلك عند التحقق من رمزها."
          : "لتغيير الأدوية: ألغِ هذه الوصفة واكتب وصفة جديدة. هنا يمكن تصحيح التشخيص والملاحظات."}
        footer={<><Button variant="ghost" onClick={onClose}>تراجع</Button>
          <Button variant={mode === "void" ? "danger" : "primary"} loading={run.isPending} disabled={reason.trim().length < 3} onClick={() => run.mutate()}>
            {mode === "void" ? "إلغاء الوصفة" : "حفظ التصحيح"}
          </Button></>}>
        <div className="space-y-4">
          <Field label="السبب"><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {mode === "amend" && <>
            <Field label="التشخيص المطبوع"><Input value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} /></Field>
            <Field label="ملاحظات"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

