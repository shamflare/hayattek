"use client";

import { useMutation } from "@tanstack/react-query";
import { MessageSquareWarning } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { errorMessage, patientApi, type Schemas, unwrap } from "@/lib/api";

type TargetType = Schemas["TargetTypeEnum"];

/**
 * Patients never edit clinical records. They send a note to the record's author, who
 * decides whether to amend it (the original version is kept).
 */
export function CorrectionDialog({
  patientId, target, onClose,
}: {
  patientId: string;
  target: { type: TargetType; id: string; title: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      {target && <CorrectionBody key={target.id} patientId={patientId} target={target} onClose={onClose} />}
    </Dialog>
  );
}

function CorrectionBody({
  patientId, target, onClose,
}: {
  patientId: string;
  target: { type: TargetType; id: string; title: string };
  onClose: () => void;
}) {
  const [message, setMessage] = React.useState("");

  const send = useMutation({
    mutationFn: () =>
      unwrap(patientApi.POST("/api/v1/me/patients/{id}/corrections", {
        params: { path: { id: patientId } },
        body: { target_type: target.type, target_id: target.id, message: message.trim() },
      })),
    onSuccess: () => {
      toast.success("أُرسل طلب التصحيح إلى الطبيب أو الجهة التي أضافت السجل.");
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const tooShort = message.trim().length < 5;

  return (
        <DialogContent size="md" title="طلب تصحيح"
          description={<>بخصوص: <bdi>{target.title}</bdi></>}
          footer={
            <>
              <Button variant="ghost" onClick={onClose}>إلغاء</Button>
              <Button loading={send.isPending} disabled={tooShort} onClick={() => send.mutate()}>
                <MessageSquareWarning className="size-4" /> إرسال الطلب
              </Button>
            </>
          }>
          <div className="space-y-4">
            <p className="rounded-2xl bg-sunken p-4 text-sm leading-7 text-muted">
              لا يمكنك تعديل السجلات الطبية بنفسك. صف ما تراه خطأً، وسيصل طلبك إلى الطبيب أو الجهة
              التي أضافت السجل. إن وافقوا على التصحيح تبقى النسخة الأصلية محفوظة.
            </p>
            <Field label="ما الذي تراه غير صحيح؟" htmlFor="correction-message"
              hint="مثال: اسم الدواء مكتوب خطأ، أو التاريخ غير صحيح.">
              <Textarea id="correction-message" rows={4} maxLength={1000} value={message}
                onChange={(e) => setMessage(e.target.value)} autoFocus />
            </Field>
          </div>
        </DialogContent>
  );
}
