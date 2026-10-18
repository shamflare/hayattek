import { AlertTriangle, FlaskConical, HeartPulse, Pill, QrCode, ShieldCheck, Stethoscope } from "lucide-react";

/**
 * Static, illustrative composition of the product (synthetic names only).
 * Built in HTML so it stays crisp, RTL-correct and light in both themes.
 */
export function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[560px]" aria-hidden>
      <div className="absolute -inset-10 -z-10 rounded-[3rem] bg-[radial-gradient(circle_at_30%_30%,var(--brand-200),transparent_60%),radial-gradient(circle_at_80%_70%,var(--accent-50),transparent_55%)] opacity-70 blur-2xl" />

      {/* Patient chart window */}
      <div className="rounded-[1.75rem] border border-line bg-elevated p-5 shadow-float">
        <div className="flex items-center gap-3">
          <div className="grid size-12 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-semibold text-white">ل.م</div>
          <div className="flex-1">
            <div className="font-semibold">ليلى محمود <span className="text-xs font-normal text-subtle">(اسم تجريبي)</span></div>
            <div className="text-xs text-muted">أنثى · 36 سنة · <span className="num">4821 0937 55</span></div>
          </div>
          <span className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">وصول مصرح</span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1 text-xs font-medium text-danger">
            <AlertTriangle className="size-3.5" /> حساسية: بنسلين
          </span>
          <span className="rounded-full bg-warning-soft px-3 py-1 text-xs font-medium text-warning">ارتفاع ضغط</span>
          <span className="rounded-full bg-info-soft px-3 py-1 text-xs font-medium text-info">سكري نوع 2</span>
        </div>

        <div className="mt-5 space-y-2.5">
          {[
            { icon: Stethoscope, title: "معاينة — داخلية", sub: "د. أحمد · مجمع الرقة الطبي", time: "اليوم", tone: "text-brand-600 bg-brand-50" },
            { icon: FlaskConical, title: "تحليل خضاب سكري", sub: "مختبر الفرات · نتيجة معتمدة", time: "أمس", tone: "text-info bg-info-soft" },
            { icon: Pill, title: "وصفة — 3 أدوية", sub: "د. سلمى · عيادة القلبية", time: "منذ أسبوع", tone: "text-accent bg-accent-soft" },
          ].map((row) => (
            <div key={row.title} className="flex items-center gap-3 rounded-2xl border border-line bg-bg/60 p-3">
              <div className={`grid size-9 place-items-center rounded-xl ${row.tone}`}><row.icon className="size-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{row.title}</div>
                <div className="truncate text-xs text-muted">{row.sub}</div>
              </div>
              <div className="text-xs text-subtle">{row.time}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Floating health card */}
      <div className="absolute -bottom-20 -start-8 hidden w-56 rotate-[-4deg] rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 p-4 text-white shadow-float sm:block">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm font-semibold"><HeartPulse className="size-4" /> حياة</div>
          <QrCode className="size-9 rounded-lg bg-white p-1 text-brand-800" />
        </div>
        <div className="mt-6 text-xs text-white/70">الرقم الصحي</div>
        <div className="num text-lg font-semibold tracking-wider">4821 0937 55</div>
      </div>

      {/* Floating consent toast */}
      <div className="absolute -top-6 -end-4 hidden items-center gap-2.5 rounded-2xl border border-line bg-elevated px-4 py-3 shadow-card sm:flex">
        <ShieldCheck className="size-5 text-brand-600" />
        <div className="text-xs">
          <div className="font-semibold">وافقت المريضة على الاطلاع</div>
          <div className="text-muted">لمدة 24 ساعة · قابل للإلغاء</div>
        </div>
      </div>
    </div>
  );
}
