"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import * as React from "react";

import { Money } from "@/components/billing/money";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { api, errorMessage, unwrap } from "@/lib/api";
import { formatDate } from "@/lib/format";

/** Printable (→ PDF) statement of doctors' balances. No patient or clinical data. */
export default function DebtsPrintPage() {
  const rows = useQuery({
    queryKey: ["billing", "rows", "print"],
    queryFn: () => unwrap(api.GET("/api/v1/billing/admin/practitioners", { params: { query: { ordering: "-debt" } } })),
  });
  const ov = useQuery({ queryKey: ["billing", "overview"], queryFn: () => unwrap(api.GET("/api/v1/billing/admin/overview")) });
  React.useEffect(() => { if (rows.data && ov.data) setTimeout(() => window.print(), 500); }, [rows.data, ov.data]);
  if (rows.isError || ov.isError) return <p className="p-10 text-center text-danger">{errorMessage(rows.error ?? ov.error)}</p>;
  if (!rows.data || !ov.data) return <p className="p-10 text-center text-muted">جارٍ التجهيز…</p>;
  return (
    <div className="min-h-dvh bg-sunken py-8 print:bg-white print:py-0">
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[277mm] justify-end px-4">
        <Button onClick={() => window.print()}><Printer className="size-4" /> طباعة / حفظ PDF</Button>
      </div>
      <article className="mx-auto max-w-[277mm] bg-white p-[10mm] text-[12px] text-[#0f1f1d] shadow-card print:shadow-none">
        <header className="mb-4 flex items-center justify-between border-b-2 border-[#157f74] pb-3">
          <Logo />
          <div className="text-end">
            <div className="text-lg font-bold">كشف مديونية الأطباء — HayatTek AI</div>
            <div className="text-[#51625f]">{formatDate(new Date())}</div>
          </div>
        </header>
        <div className="mb-4 grid grid-cols-4 gap-3">
          {[["إجمالي الديون", ov.data.total_debt], ["المحصّل", ov.data.total_collected], ["الإيرادات المفوترة", ov.data.ai_revenue], ["صافي الأرصدة", ov.data.total_balance]].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-[#dde5e3] p-2"><div className="text-[#51625f]">{k}</div><div className="text-base font-bold"><Money value={v} /></div></div>
          ))}
        </div>
        <table className="w-full border-collapse">
          <thead><tr className="bg-[#eef2f1]">{["الطبيب", "المنشأة", "سعر الدقيقة", "الجلسات", "الرسوم", "المدفوعات", "الرصيد", "الدين", "آخر دفعة"].map((h) => <th key={h} className="border border-[#dde5e3] p-1.5 text-start">{h}</th>)}</tr></thead>
          <tbody>
            {rows.data.map((r) => (
              <tr key={r.practitioner_id}>
                <td className="border border-[#dde5e3] p-1.5">{r.name}</td>
                <td className="border border-[#dde5e3] p-1.5">{r.organizations.join("، ")}</td>
                <td className="border border-[#dde5e3] p-1.5"><Money value={r.price_per_minute} /></td>
                <td className="num border border-[#dde5e3] p-1.5">{r.sessions}</td>
                <td className="border border-[#dde5e3] p-1.5"><Money value={r.total_charges} /></td>
                <td className="border border-[#dde5e3] p-1.5"><Money value={r.total_payments} /></td>
                <td className="border border-[#dde5e3] p-1.5"><Money value={r.balance} /></td>
                <td className="border border-[#dde5e3] p-1.5 font-bold"><Money value={r.debt} /></td>
                <td className="border border-[#dde5e3] p-1.5">{r.last_payment_at ? formatDate(r.last_payment_at) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </div>
  );
}
