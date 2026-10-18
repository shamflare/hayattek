"use client";

import { useQuery } from "@tanstack/react-query";
import { HeartPulse, Printer } from "lucide-react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { api, errorMessage, unwrap } from "@/lib/api";

/** Printable health card (credit-card size, 85.6 × 54 mm). The QR holds only a random token. */
export default function PrintCardPage() {
  const { id } = useParams<{ id: string }>();
  const patient = useQuery({
    queryKey: ["patient", id],
    queryFn: () => unwrap(api.GET("/api/v1/patients/{id}", { params: { path: { id } } })),
  });
  const card = useQuery({
    queryKey: ["card", id],
    queryFn: () => unwrap(api.GET("/api/v1/patients/{id}/card", { params: { path: { id } } })),
  });
  const ready = patient.data && card.data;
  React.useEffect(() => {
    if (ready) setTimeout(() => window.print(), 600);
  }, [ready]);

  if (patient.isError || card.isError) return <p className="p-10 text-center text-danger">{errorMessage(patient.error ?? card.error)}</p>;
  if (!ready) return <p className="p-10 text-center text-muted">جارٍ تجهيز البطاقة…</p>;
  const p = patient.data.patient;

  return (
    <div className="min-h-dvh bg-sunken py-10 print:bg-white print:py-0">
      <style>{`@media print { @page { size: 85.6mm 54mm; margin: 0; } }`}</style>
      <div className="no-print mb-6 flex justify-center">
        <Button onClick={() => window.print()}><Printer className="size-4" /> طباعة البطاقة</Button>
      </div>
      <div className="mx-auto flex h-[54mm] w-[85.6mm] overflow-hidden rounded-[3mm] bg-gradient-to-br from-[#157f74] to-[#123f3c] text-white shadow-float print:rounded-none print:shadow-none"
        style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
        <div className="flex flex-1 flex-col justify-between p-[4mm]">
          <div className="flex items-center gap-1.5 text-[11pt] font-bold"><HeartPulse className="size-[4.5mm]" /> حياة</div>
          <div>
            <div className="text-[10.5pt] font-semibold leading-tight">{p.full_name}</div>
            <div className="mt-[2mm] text-[6.5pt] text-white/70">الرقم الصحي</div>
            <div className="num text-[13pt] font-bold tracking-wider">{p.health_number}</div>
          </div>
          <div className="text-[5.5pt] text-white/60">قدّم هذه البطاقة في أي منشأة مشاركة · hayattek.com</div>
        </div>
        <div className="grid place-items-center bg-white p-[3mm]">
          <QRCodeSVG value={card.data.qr_url} size={110} level="M" />
        </div>
      </div>
    </div>
  );
}
