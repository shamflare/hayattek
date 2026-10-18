import {
  BadgeCheck, Building2, ClipboardList, FlaskConical, KeyRound, Pill, Printer, QrCode,
  Search, Send, Stethoscope, UsersRound,
} from "lucide-react";
import type { Metadata } from "next";

import { JoinForm } from "./join-form";

export const metadata: Metadata = {
  title: "للأطباء والمنشآت",
  description: "كيف تعمل منصة حياة داخل العيادة والمجمع والمختبر ومركز الأشعة.",
};

export default function ProvidersPage() {
  return (
    <main>
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 lg:pt-24">
        <span className="text-sm font-semibold text-brand-600">للأطباء والمنشآت</span>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-[1.4] tracking-tight sm:text-5xl">
          مفيدة لعيادتك من اليوم الأول — حتى قبل أن تنضم بقية العيادات.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-9 text-muted">
          ملفات مرضاك ووصفاتك وطلبات التحاليل منظمة في مكان واحد. وعندما يراجعك مريض من منشأة أخرى، تطّلع على تاريخه بموافقته.
        </p>
      </section>

      <section className="mx-auto grid max-w-6xl gap-5 px-4 sm:px-6 md:grid-cols-2 lg:grid-cols-3">
        {[
          { icon: Search, title: "بحث فوري", text: "بالاسم أو الرقم الصحي أو الهاتف، مع تطبيع الأسماء العربية (أحمد/احمد، عبد الله/عبدالله)." },
          { icon: QrCode, title: "مسح البطاقة", text: "كاميرا الحاسوب أو الهاتف تفتح ملف المريض فوراً — بعد التحقق من صلاحيتك." },
          { icon: Stethoscope, title: "زيارة بلا حقول إجبارية", text: "سبب الزيارة والعلامات الحيوية والفحص والتشخيص؛ احفظ مسودة واعتمد عندما تنتهي." },
          { icon: Pill, title: "أدويتك المفضلة وقوالبك", text: "أضف أدوية من قائمتك بنقرة، وأنشئ قوالب للحالات المتكررة دون أن تتغير الوصفات القديمة." },
          { icon: Printer, title: "طباعة باسم المنشأة", text: "إن كنت تعمل في أكثر من مكان، تُطبع الوصفة بهوية المنشأة التي أصدرتها منها." },
          { icon: FlaskConical, title: "مختبرات وأشعة", text: "أرسل الطلب إلكترونياً؛ النتيجة المنظمة تعود إليك بعد اعتمادها." },
          { icon: Send, title: "إحالات منظمة", text: "أحِل مريضك إلى زميل مع مشاركة ما يحتاجه فقط، وبموافقة المريض." },
          { icon: UsersRound, title: "فريق المنشأة", text: "أطباء واستقبال ومختبر بأدوار واضحة: الاستقبال لا يرى التشخيصات." },
          { icon: KeyRound, title: "أمان على مستوى المستشفيات", text: "مصادقة ثنائية للحسابات الطبية، وجلسات قابلة للإبطال، وسجل تدقيق محمي." },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-3xl border border-line bg-elevated p-6 shadow-soft">
            <div className="grid size-11 place-items-center rounded-2xl bg-brand-50 text-brand-600"><Icon className="size-5" /></div>
            <h3 className="mt-4 font-semibold">{title}</h3>
            <p className="mt-1.5 text-sm leading-7 text-muted">{text}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-6 rounded-[2rem] border border-line bg-elevated p-8 sm:p-10 lg:grid-cols-3">
          {[
            { icon: Building2, title: "1. تسجيل المنشأة", text: "نراجع بيانات منشأتك ونفعّل حسابها." },
            { icon: BadgeCheck, title: "2. اعتماد الأطباء", text: "نتحقق من الهوية المهنية لكل طبيب قبل أن يكتب أي سجل طبي." },
            { icon: ClipboardList, title: "3. التدريب والبدء", text: "جلسة تدريب قصيرة لفريقك، وتبدأ باستقبال المرضى." },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex gap-4">
              <Icon className="mt-1 size-6 shrink-0 text-brand-600" />
              <div>
                <div className="font-semibold">{title}</div>
                <p className="mt-1 text-sm leading-7 text-muted">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="join" className="scroll-mt-20 border-t border-line bg-elevated">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 className="text-3xl font-bold leading-[1.4]">طلب انضمام منشأة</h2>
            <p className="mt-4 leading-8 text-muted">
              اترك بيانات التواصل وسنتصل بك لترتيب التفعيل. لا تكتب أي معلومات عن مرضى في هذا النموذج.
            </p>
          </div>
          <JoinForm />
        </div>
      </section>
    </main>
  );
}
