"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import * as React from "react";

import { BrowsePanel, ImportPanel, ReviewPanel } from "@/components/admin/catalog";
import { PageHeader } from "@/components/app/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, unwrap } from "@/lib/api";

export default function CatalogPage() {
  const [tab, setTab] = React.useState("import");
  const pending = useQuery({
    queryKey: ["admin", "catalog", "pending-count"],
    queryFn: () => unwrap(api.GET("/api/v1/admin/catalog/medications", {
      params: { query: { review_status: "pending", page_size: 1 } as never },
    })),
  });
  return (
    <>
      <PageHeader eyebrow="إدارة المنصة" title="كتالوج الأدوية"
        description="استيراد من مصدر مرخص مع معاينة قبل الاعتماد، وكشف التكرار، وإدارة الأدوية التي يضيفها الأطباء." />
      <div className="mb-5 flex gap-2 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>الإطلاق السريري يحتاج اعتماد مصدر كتالوج مرخص من مالك المشروع. البيانات الحالية اصطناعية للتطوير ولا تمثل أدوية حقيقية.</span>
      </div>
      <Tabs value={tab} onValueChange={setTab} dir="rtl">
        <TabsList className="mb-4">
          <TabsTrigger value="import">الاستيراد</TabsTrigger>
          <TabsTrigger value="browse">الكتالوج</TabsTrigger>
          <TabsTrigger value="review">أدوية أضافها الأطباء
            {pending.data && pending.data.count > 0 && <span className="num rounded-full bg-warning px-1.5 text-xs text-white">{pending.data.count}</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="import"><ImportPanel /></TabsContent>
        <TabsContent value="browse"><BrowsePanel /></TabsContent>
        <TabsContent value="review"><ReviewPanel /></TabsContent>
      </Tabs>
    </>
  );
}
