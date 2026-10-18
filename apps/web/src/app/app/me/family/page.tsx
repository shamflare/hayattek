"use client";

import { Check, Info } from "lucide-react";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { useActivePatient } from "@/components/patient/active-patient";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, Card } from "@/components/ui/surface";
import { cn } from "@/lib/cn";

export default function FamilyPage() {
  const { patients, active, setActive } = useActivePatient();
  const router = useRouter();
  const hasWards = patients.some((p) => !p.isOwn);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="العائلة" description="الملفات الصحية التي يمكنك إدارتها من حسابك. اختر الملف الذي تريد تصفحه." />

      <ul className="space-y-3">
        {patients.map((p) => {
          const selected = p.id === active?.id;
          return (
            <li key={p.id}>
              <Card className={cn("flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5", selected && "border-brand-400 ring-4 ring-brand-100")}>
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <Avatar name={p.full_name} className="size-12 text-base" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold">{p.full_name}</span>
                      <Badge tone={p.isOwn ? "brand" : "accent"}>{p.isOwn ? "ملفي" : "تحت وصايتي"}</Badge>
                    </div>
                    <div className="mt-0.5 text-sm text-muted">الرقم الصحي: <span className="num">{p.health_number}</span></div>
                  </div>
                </div>
                {selected ? (
                  <span className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-brand-600">
                    <Check className="size-4" /> الملف المعروض الآن
                  </span>
                ) : (
                  <Button size="lg" variant="secondary" onClick={() => { setActive(p.id); router.push("/app/me"); }}>
                    عرض هذا الملف
                  </Button>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex items-start gap-3 rounded-2xl bg-sunken p-4 text-sm leading-7 text-muted">
        <Info className="mt-1 size-4 shrink-0 text-brand-600" />
        <p>
          {hasWards ? "" : "لا توجد ملفات أخرى مرتبطة بحسابك. "}
          لإضافة ملف طفلك أو أحد والديك الذي تعتني به، راجع استقبال العيادة أو المركز الطبي ومعك ما يثبت
          الصلة أو الوصاية، ليربطوا الملف بحسابك.
        </p>
      </div>
    </div>
  );
}
