"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ScanLine, Search, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageHeader } from "@/components/app/page-header";
import { PatientRow } from "@/components/clinical/patient-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Card, EmptyState, ErrorState, SkeletonList } from "@/components/ui/surface";
import { api, errorMessage, unwrap } from "@/lib/api";
import { useDebounced } from "@/lib/hooks";
import { useSession } from "@/lib/session";

export default function PatientsPage() {
  const { has } = useSession();
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const query = useDebounced(q.trim(), 300);
  React.useEffect(() => setPage(1), [query]);

  const list = useQuery({
    queryKey: ["patients", "list", query, page],
    queryFn: () => unwrap(api.GET("/api/v1/patients", {
      params: { query: { ...(query ? { q: query } : {}), page } as never },
    })),
    placeholderData: keepPreviousData,
  });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.count / 20)) : 1;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="المرضى"
        description="مرضى منشأتك، والمرضى الذين منحوك وصولاً."
        actions={<>
          <Button asChild variant="outline"><Link href="/app/scan"><ScanLine className="size-4" /> مسح بطاقة</Link></Button>
          {has("receptionist", "physician", "nurse", "lab_staff", "imaging_staff") && (
            <Button asChild><Link href="/app/patients/new"><UserPlus className="size-4" /> مريض جديد</Link></Button>
          )}
        </>}
      />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-subtle" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="h-13 ps-12 text-base"
          placeholder="ابحث بالاسم الثلاثي أو الرقم الصحي أو رقم الهاتف" />
      </div>
      <Card className="p-2">
        {list.isLoading ? <div className="p-3"><SkeletonList rows={6} /></div> : list.isError ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => list.refetch()} />
        ) : list.data?.results.length ? (
          <div className="divide-y divide-line">
            {list.data.results.map((p) => <PatientRow key={p.id} patient={p} />)}
          </div>
        ) : (
          <EmptyState icon={<Users className="size-6" />}
            title={query ? "لا يوجد مريض مطابق" : "لا يوجد مرضى بعد"}
            description={query
              ? "البحث يشمل مرضى منشأتك فقط. إن كان المريض مسجلاً في منشأة أخرى، امسح بطاقته أو أدخل رقمه الصحي من صفحة المسح."
              : "سجّل أول مريض لتبدأ."}
            action={<div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline"><Link href="/app/scan">المسح أو الرقم الصحي</Link></Button>
              <Button asChild><Link href="/app/patients/new">مريض جديد</Link></Button>
            </div>} />
        )}
      </Card>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>السابق</Button>
          <span className="num text-muted">{page} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>التالي</Button>
        </div>
      )}
    </div>
  );
}
