"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import * as React from "react";

import { Money, PAYMENT_METHOD } from "@/components/billing/money";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { api, errorMessage, unwrap } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

function Receipt() {
  const { id } = useParams<{ id: string }>();
  const scope = useSearchParams().get("scope") === "me" ? "me" : "admin";
  const query = useQuery({
    queryKey: ["receipt", scope, id],
    queryFn: () => scope === "me"
      ? unwrap(api.GET("/api/v1/billing/me/transactions/{id}/receipt", { params: { path: { id } } }))
      : unwrap(api.GET("/api/v1/billing/admin/transactions/{id}/receipt", { params: { path: { id } } })),
  });
  React.useEffect(() => { if (query.data) setTimeout(() => window.print(), 500); }, [query.data]);
  if (query.isLoading) return <p className="p-10 text-center text-muted">جارٍ تجهيز الإيصال…</p>;
  if (query.isError || !query.data) return <p className="p-10 text-center text-danger">{errorMessage(query.error)}</p>;
  const r = query.data;
  const rows: [string, React.ReactNode][] = [
    ["رقم الإيصال", <span key="n" className="num font-semibold">{r.receipt_number}</span>],
    ["استلمنا من", r.practitioner_name],
    ["المبلغ", <Money key="a" value={r.amount} currency={r.currency} className="text-lg font-bold" />],
    ["تاريخ الدفع", formatDateTime(r.paid_at)],
    ["طريقة الدفع", PAYMENT_METHOD[r.method] ?? r.method],
    ["رقم المرجع", r.reference || "—"],
    ["ملاحظات", r.notes || "—"],
    ["استلمها", r.received_by ?? "—"],
    ["الرصيد بعد الدفعة", <Money key="b" value={r.balance_after} currency={r.currency} />],
  ];
  return (
    <div className="min-h-dvh bg-sunken py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[148mm] justify-end px-4">
        <Button onClick={() => window.print()}><Printer className="size-4" /> طباعة</Button>
      </div>
      <article className="mx-auto max-w-[148mm] bg-white p-[12mm] text-[#0f1f1d] shadow-card print:shadow-none">
        <header className="flex items-center justify-between border-b-2 border-[#157f74] pb-4">
          <Logo />
          <div className="text-end">
            <div className="text-lg font-bold">إيصال استلام</div>
            <div className="text-xs text-[#51625f]">خدمة HayatTek AI</div>
          </div>
        </header>
        {r.is_reversed && <div className="mt-4 rounded-lg border-2 border-[#d64545] p-2 text-center font-bold text-[#d64545]">ملغى — تم عكس هذه الدفعة</div>}
        <dl className="mt-6 divide-y divide-[#dde5e3] text-[14px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5"><dt className="text-[#51625f]">{k}</dt><dd className="text-end">{v}</dd></div>
          ))}
        </dl>
        <footer className="mt-10 flex justify-between text-xs text-[#51625f]">
          <span>hayattek.com</span>
          <span>التوقيع: ____________</span>
        </footer>
      </article>
    </div>
  );
}

export default function ReceiptPage() {
  return <React.Suspense><Receipt /></React.Suspense>;
}
