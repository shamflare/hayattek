"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Clock, ShieldQuestion, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { errorMessage, patientApi, type Schemas, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { label } from "@/lib/i18n";

import { portalKeys } from "./portal";

type AccessRequest = Schemas["AccessRequest"];
type Scope = Schemas["ScopesEnum"];

export const purposeLabels: Record<string, string> = {
  treatment: "العلاج",
  referral: "إحالة",
  second_opinion: "رأي طبي ثانٍ",
  diagnostics: "فحوص تشخيصية",
};

export function durationLabel(hours?: number): string {
  if (!hours) return "";
  if (hours < 24) return `${hours} ساعة`;
  const days = Math.round(hours / 24);
  if (days === 1) return "يوم واحد";
  if (days === 2) return "يومان";
  return days <= 10 ? `${days} أيام` : `${days} يوماً`;
}

/**
 * A pending request from a facility to see the patient's file. The patient can untick
 * any category before approving: only what stays ticked is shared.
 */
export function AccessRequestCard({ request, showPatient }: { request: AccessRequest; showPatient?: boolean }) {
  const queryClient = useQueryClient();
  const [scopes, setScopes] = React.useState<Scope[]>(request.scopes);
  const [confirmDeny, setConfirmDeny] = React.useState(false);

  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      unwrap(patientApi.POST("/api/v1/me/sharing/requests/{request_id}/decide", {
        params: { path: { request_id: request.id } },
        body: approve ? { approve, scopes } : { approve },
      })),
    onSuccess: (_, approve) => {
      toast.success(approve ? "تمت الموافقة. يمكنك إلغاء الوصول في أي وقت." : "رُفض الطلب.");
      setConfirmDeny(false);
      queryClient.invalidateQueries({ queryKey: portalKeys.requests });
      queryClient.invalidateQueries({ queryKey: portalKeys.grants });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggle = (s: Scope) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  return (
    <div className="rounded-card border border-warning/40 bg-elevated p-4 shadow-soft sm:p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-warning-soft text-warning">
          <ShieldQuestion className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-semibold leading-7">
            {request.practitioner_name || "طاقم المنشأة"} يطلب الاطلاع على ملفك
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1"><Building2 className="size-3.5" /> {request.organization_name}</span>
            <span className="inline-flex items-center gap-1"><Clock className="size-3.5" /> {relativeTime(request.created_at)}</span>
          </div>
          {showPatient && (
            <p className="mt-1 text-sm text-muted">ملف: <strong className="text-fg">{request.patient_name}</strong></p>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3 rounded-2xl bg-sunken/60 p-3 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
          {request.purpose && <span>الغرض: <span className="text-fg">{purposeLabels[request.purpose] ?? request.purpose}</span></span>}
          {request.duration_hours ? <span>المدة: <span className="text-fg">{durationLabel(request.duration_hours)}</span></span> : null}
        </div>
        {request.note && <p className="leading-7 text-fg">«{request.note}»</p>}
        <div>
          <p className="mb-2 text-muted">ما الذي سيُشارَك؟ أزل العلامة عمّا لا تريد مشاركته:</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {request.scopes.map((s) => {
              const on = scopes.includes(s);
              return (
                <li key={s}>
                  <label className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors",
                    on ? "border-brand-300 bg-elevated" : "border-line bg-transparent opacity-70",
                  )}>
                    <input type="checkbox" checked={on} onChange={() => toggle(s)}
                      className="mt-1 size-4 shrink-0 accent-[var(--brand-600)]" />
                    <span>
                      <span className="block font-medium text-fg">{label("scopes", s)}</span>
                      <span className="block text-xs text-muted">{label("scopeHints", s)}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button size="lg" className="w-full sm:w-auto sm:flex-1" disabled={scopes.length === 0}
          loading={decide.isPending && decide.variables === true} onClick={() => decide.mutate(true)}>
          <Check className="size-5" /> موافقة
        </Button>
        <Button size="lg" variant="outline" className="w-full sm:w-auto sm:flex-1" onClick={() => setConfirmDeny(true)}>
          <X className="size-5" /> رفض
        </Button>
      </div>
      {scopes.length === 0 && (
        <p className="mt-2 text-center text-xs text-muted">اختر فئة واحدة على الأقل للموافقة، أو ارفض الطلب.</p>
      )}

      <ConfirmDialog open={confirmDeny} onOpenChange={setConfirmDeny} tone="danger"
        title="رفض طلب الوصول؟" confirmLabel="رفض الطلب"
        description={`لن تتمكن ${request.organization_name} من رؤية سجلاتك من المنشآت الأخرى. يمكنهم طلب الوصول مجدداً لاحقاً.`}
        loading={decide.isPending && decide.variables === false} onConfirm={() => decide.mutate(false)} />
    </div>
  );
}
