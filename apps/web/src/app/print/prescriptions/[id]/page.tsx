"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/ui/logo";
import { api, errorMessage, unwrap } from "@/lib/api";
import { formatDate, sexLabel } from "@/lib/format";
import { label } from "@/lib/i18n";

/** A4 prescription (ADR-009). Rendered by the browser for perfect Arabic shaping. */
export default function PrintPrescriptionPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: ["print", "rx", id],
    queryFn: () => unwrap(api.GET("/api/v1/prescriptions/{id}/print", { params: { path: { id } } })),
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

  if (query.isLoading) return <p className="p-10 text-center text-muted">جارٍ تجهيز الوصفة…</p>;
  if (query.isError || !query.data) return <p className="p-10 text-center text-danger">{errorMessage(query.error)}</p>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = query.data as any;
  const rx = d.prescription;
  return (
    <div className="min-h-dvh bg-sunken py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] justify-end px-4">
        <Button onClick={() => window.print()}><Printer className="size-4" /> طباعة</Button>
      </div>
      <article className="mx-auto flex min-h-[273mm] max-w-[210mm] flex-col bg-white p-[14mm] text-[#0f1f1d] shadow-card print:min-h-0 print:max-w-none print:p-0 print:shadow-none">
        {/* header */}
        <header className="flex items-start justify-between gap-6 border-b-2 border-[#157f74] pb-5">
          <div>
            <div className="text-[22px] font-bold leading-tight">{d.practitioner.display_name}</div>
            {d.practitioner.specialty && <div className="mt-1 text-[15px] text-[#14665e]">اختصاص {d.practitioner.specialty}{d.practitioner.specialty_detail ? ` — ${d.practitioner.specialty_detail}` : ""}</div>}
            {d.practitioner.license_number && <div className="mt-1 text-xs text-[#51625f]">رقم الترخيص: <span className="num">{d.practitioner.license_number}</span></div>}
          </div>
          <div className="text-start">
            <div className="flex items-center gap-2">
              <div className="text-end">
                <div className="text-[17px] font-semibold">{d.organization?.name}</div>
                {d.organization?.name_en && <div className="text-xs text-[#51625f]" dir="ltr">{d.organization.name_en}</div>}
              </div>
            </div>
            <div className="mt-1 text-xs leading-5 text-[#51625f]">
              {[d.organization?.address, d.organization?.city].filter(Boolean).join("، ")}
              {d.organization?.phone && <div>هاتف: <span className="num">{d.organization.phone}</span></div>}
            </div>
          </div>
        </header>

        {/* patient band */}
        <section className="mt-5 grid grid-cols-[1fr_auto_auto_auto] items-center gap-6 rounded-xl bg-[#edfaf7] px-5 py-3 text-[14px]">
          <div><span className="text-[#51625f]">المريض: </span><span className="font-semibold">{d.patient.full_name}</span></div>
          <div><span className="text-[#51625f]">العمر: </span><span className="num">{d.patient.age_years ?? "—"}</span></div>
          <div>{sexLabel(d.patient.sex)}</div>
          <div><span className="text-[#51625f]">التاريخ: </span>{formatDate(rx.occurred_at)}</div>
        </section>
        {rx.diagnosis_text && <div className="mt-3 text-[14px]"><span className="text-[#51625f]">التشخيص: </span>{rx.diagnosis_text}</div>}

        {/* items */}
        <section className="mt-6 flex-1">
          <div className="mb-3 text-[28px] font-bold italic text-[#157f74]" dir="ltr" style={{ fontFamily: "'Segoe UI Symbol','Noto Sans Symbols 2','DejaVu Sans',serif" }}>℞</div>
          <ol className="space-y-4">
            {rx.items.map((item: Record<string, string>, i: number) => (
              <li key={item.id} className="flex gap-4 border-b border-dashed border-[#dde5e3] pb-4 last:border-0">
                <span className="num mt-0.5 text-[15px] font-bold text-[#157f74]">{i + 1}.</span>
                <div className="flex-1">
                  <div className="text-[17px] font-semibold">
                    {item.medication_name} <span className="num font-normal">{item.strength}</span>
                    {item.dosage_form && <span className="ms-2 text-[13px] font-normal text-[#51625f]">({label("dosageForms", item.dosage_form)})</span>}
                  </div>
                  <div className="mt-1 text-[15px] leading-7">{item.sig}</div>
                  {item.quantity && <div className="text-[13px] text-[#51625f]">الكمية: <span className="num">{Number(item.quantity)}</span> {item.quantity_unit}</div>}
                </div>
              </li>
            ))}
          </ol>
          {rx.notes && <p className="mt-6 rounded-xl border border-[#dde5e3] p-4 text-[14px] leading-7">{rx.notes}</p>}
        </section>

        {/* footer */}
        <footer className="mt-8 flex items-end justify-between gap-6 border-t border-[#dde5e3] pt-5">
          <div className="text-[12px] leading-6 text-[#51625f]">
            <div>رقم الوصفة: <span className="num font-semibold text-[#0f1f1d]">{rx.number}</span>{rx.version > 1 && ` (نسخة ${rx.version})`}</div>
            <div>رمز التحقق: <span className="num font-semibold tracking-wider text-[#0f1f1d]">{d.verification.code}</span></div>
            <div>للتحقق من صحة الوصفة امسح الرمز أو زر <span dir="ltr">hayattek.com/verify</span></div>
            {d.organization?.print_footer && <div className="mt-2 text-[#0f1f1d]">{d.organization.print_footer}</div>}
            <div className="mt-3 flex items-center gap-1.5 text-[11px]"><LogoMark className="size-4" /> صادرة عبر منصة حياة</div>
          </div>
          <div className="flex items-end gap-6">
            <div className="text-center text-[12px] text-[#51625f]">
              <div className="mb-10">توقيع الطبيب وختمه</div>
              <div className="w-40 border-t border-[#c6d2cf]" />
            </div>
            <QRCodeSVG value={d.verification.url} size={84} level="M" />
          </div>
        </footer>
      </article>
    </div>
  );
}
