"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/ui/logo";
import { api, errorMessage, unwrap } from "@/lib/api";
import { formatDate, formatDateTime, sexLabel } from "@/lib/format";
import { label } from "@/lib/i18n";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A4 imaging report (ADR-009). Finalized reports only; the API enforces visibility + audit. */
export default function PrintImagingReportPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: ["print", "imaging", id],
    queryFn: () => unwrap(api.GET("/api/v1/diagnostics/imaging-reports/{id}/print", { params: { path: { id } } })),
    retry: false,
    staleTime: Infinity,
  });
  const printed = React.useRef(false);
  React.useEffect(() => {
    if (query.data && !printed.current) {
      printed.current = true;
      setTimeout(() => window.print(), 600);
    }
  }, [query.data]);

  if (query.isLoading) return <p className="p-10 text-center text-muted">جارٍ تجهيز التقرير…</p>;
  if (query.isError || !query.data) return <p className="p-10 text-center text-danger">{errorMessage(query.error)}</p>;

  const d = query.data as any;
  const r = d.report;
  const statusText = r.status === "amended" ? `مصحح (النسخة ${r.version})` : label("recordStatus", r.status);
  return (
    <div className="min-h-dvh bg-sunken py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-end px-4">
        <Button onClick={() => window.print()}><Printer className="size-4" /> طباعة</Button>
      </div>
      <article className="mx-auto flex min-h-[273mm] max-w-[210mm] flex-col bg-white p-[14mm] text-[#0f1f1d] shadow-card print:min-h-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-[#157f74] pb-5">
          <div>
            <div className="text-[22px] font-bold leading-tight">{d.organization?.name}</div>
            {d.organization?.name_en && <div className="text-xs text-[#51625f]" dir="ltr">{d.organization.name_en}</div>}
            <div className="mt-1 text-xs leading-5 text-[#51625f]">
              {[d.organization?.address, d.organization?.city].filter(Boolean).join("، ")}
              {d.organization?.phone && <div>هاتف: <span className="num">{d.organization.phone}</span></div>}
            </div>
          </div>
          <div className="text-end">
            <div className="text-[18px] font-semibold text-[#14665e]">تقرير تصوير طبي</div>
            <div className="mt-1 text-[13px]">{label("modalities", r.modality)}{r.body_site ? ` — ${r.body_site}` : ""}</div>
            <div className="mt-1 text-xs text-[#51625f]">الحالة: <span className="font-semibold text-[#0f1f1d]">{statusText}</span></div>
          </div>
        </header>

        <section className="mt-5 grid grid-cols-[1fr_auto_auto_auto] items-center gap-6 rounded-xl bg-[#edfaf7] px-5 py-3 text-[14px]">
          <div><span className="text-[#51625f]">المريض: </span><span className="font-semibold">{d.patient.full_name}</span></div>
          <div><span className="text-[#51625f]">العمر: </span><span className="num">{d.patient.age_years ?? "—"}</span></div>
          <div>{sexLabel(d.patient.sex)}</div>
          <div><span className="text-[#51625f]">الرقم الصحي: </span><span className="num">{d.patient.health_number}</span></div>
        </section>
        <section className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-[13px] text-[#51625f]">
          <div>تاريخ الفحص: <span className="text-[#0f1f1d]">{formatDate(r.occurred_at)}</span></div>
          {d.order && <div>الطلب: <span className="num text-[#0f1f1d]">{d.order.number}</span> — {d.order.ordered_by}{d.order.organization_name ? ` · ${d.order.organization_name}` : ""}</div>}
        </section>

        <section className="mt-6 flex-1 space-y-6">
          <h1 className="text-[19px] font-bold">{r.title}</h1>
          <div>
            <div className="mb-1 text-[13px] font-semibold text-[#14665e]">الموجودات</div>
            <p className="whitespace-pre-line text-[15px] leading-8">{r.findings || "—"}</p>
          </div>
          <div className="rounded-xl border border-[#dde5e3] p-4">
            <div className="mb-1 text-[13px] font-semibold text-[#14665e]">الانطباع</div>
            <p className="whitespace-pre-line text-[15px] font-medium leading-8">{r.impression || "—"}</p>
          </div>
          {r.attachments > 0 && <p className="text-xs text-[#51625f]">مرفق بالتقرير <span className="num">{r.attachments}</span> صورة/ملف في الملف الإلكتروني.</p>}
          {r.status === "amended" && r.status_reason && <p className="text-xs text-[#51625f]">سبب التصحيح ({formatDateTime(r.amended_at)}): {r.status_reason}</p>}
          {r.status === "entered_in_error" && <p className="text-sm font-semibold text-[#b42318]">هذا التقرير أُلغي: {r.status_reason}</p>}
        </section>

        <footer className="mt-8 flex items-end justify-between gap-6 border-t border-[#dde5e3] pt-5">
          <div className="text-[12px] leading-6 text-[#51625f]">
            <div>كتب التقرير: <span className="font-semibold text-[#0f1f1d]">{d.author.name}</span>{d.author.role ? ` — ${label("roles", d.author.role)}` : ""}</div>
            {d.author.specialty && <div>الاختصاص: {d.author.specialty}</div>}
            {d.author.license_number && <div>رقم الترخيص: <span className="num">{d.author.license_number}</span></div>}
            <div>اعتُمد: {formatDateTime(r.finalized_at)}</div>
            {d.organization?.print_footer && <div className="mt-2 text-[#0f1f1d]">{d.organization.print_footer}</div>}
            <div className="mt-3 flex items-center gap-1.5 text-[11px]"><LogoMark className="size-4" /> صادر عبر منصة حياة</div>
          </div>
          <div className="text-center text-[12px] text-[#51625f]">
            <div className="mb-10">التوقيع والختم</div>
            <div className="w-40 border-t border-[#c6d2cf]" />
          </div>
        </footer>
      </article>
    </div>
  );
}
