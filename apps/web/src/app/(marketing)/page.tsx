import {
  ArrowLeft, Building2, CheckCircle2, ClipboardCheck, Eye, FileCheck2, FlaskConical, HeartHandshake,
  History, Lock, Microscope, Printer, QrCode, ScanLine, ShieldCheck, Smartphone, Stethoscope,
  UserRoundCheck, Users, WifiOff,
} from "lucide-react";
import Link from "next/link";

import { ProductPreview } from "@/components/marketing/product-preview";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <main>
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 -z-10 h-[620px] bg-[radial-gradient(ellipse_at_top,var(--brand-100),transparent_60%)] dark:bg-[radial-gradient(ellipse_at_top,var(--brand-50),transparent_60%)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-16 px-4 pb-24 pt-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-elevated px-3.5 py-1.5 text-sm text-brand-700 shadow-soft dark:text-brand-300">
              <span className="size-2 rounded-full bg-brand-500" /> نبدأ من الرقة — لكل سوريا لاحقاً
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-[1.35] tracking-tight sm:text-5xl lg:text-[56px]">
              ملف صحي واحد،
              <br />
              <span className="bg-gradient-to-l from-brand-500 to-brand-700 bg-clip-text text-transparent">يرافقك أينما ذهبت.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-9 text-muted">
              حياة تربط العيادات والمجمعات الطبية والمختبرات ومراكز الأشعة بسجل طبي موحد وآمن.
              الطبيب يرى ما يحتاجه خلال ثوانٍ، والمريض يملك ملفه ويقرر من يطّلع عليه.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg"><Link href="/providers#join">انضم كطبيب أو منشأة <ArrowLeft className="size-4" /></Link></Button>
              <Button asChild size="lg" variant="outline"><Link href="/login">تسجيل الدخول</Link></Button>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted">
              {["لا يُفتح ملف دون إذن المريض", "كل وصول مسجّل", "يعمل على الإنترنت الضعيف"].map((t) => (
                <span key={t} className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-brand-500" /> {t}</span>
              ))}
            </div>
          </div>
          <div className="animate-fade-up [animation-delay:120ms]">
            <ProductPreview />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- audiences */}
      <section className="border-y border-line bg-elevated">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-line sm:grid-cols-5">
          {[
            { icon: Stethoscope, label: "العيادات الخاصة" },
            { icon: Building2, label: "المجمعات الطبية" },
            { icon: HeartHandshake, label: "المشافي الخاصة" },
            { icon: Microscope, label: "المختبرات" },
            { icon: ScanLine, label: "مراكز الأشعة" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center justify-center gap-2.5 bg-elevated px-4 py-6 text-sm font-medium text-muted">
              <Icon className="size-5 text-brand-500" /> {label}
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- how it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
        <SectionTitle eyebrow="كيف تعمل" title="من الاستقبال إلى الوصفة، في دقائق" subtitle="مسار بسيط صُمم مع واقع العيادات: مريض بلا هاتف ذكي، إنترنت متقطع، ووقت ضيق." />
        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {[
            { n: "1", icon: QrCode, title: "بطاقة صحية للمريض", text: "عند أول زيارة ينشئ الاستقبال ملف المريض ويحصل على رقم صحي ثابت وبطاقة QR مطبوعة — لا حاجة لهاتف أو هوية." },
            { n: "2", icon: UserRoundCheck, title: "الطبيب يفتح الملف بإذن", text: "مسح البطاقة يتعرّف على المريض فقط. للاطلاع على سجلات الأطباء الآخرين يوافق المريض من التطبيق أو برمز أو حضورياً." },
            { n: "3", icon: ClipboardCheck, title: "زيارة، وصفة، تحليل", text: "يكتب الطبيب الزيارة ويصف الأدوية من قائمته المفضلة، ويطبع وصفة أنيقة برمز تحقق، ويطلب التحليل إلكترونياً." },
          ].map((step) => (
            <div key={step.n} className="group relative rounded-3xl border border-line bg-elevated p-7 shadow-soft transition-shadow hover:shadow-card">
              <div className="flex items-center justify-between">
                <div className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600"><step.icon className="size-6" /></div>
                <span className="num text-5xl font-bold text-line">{step.n}</span>
              </div>
              <h3 className="mt-6 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 leading-7 text-muted">{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- doctor features */}
      <section className="bg-brand-900 text-white">
        <div className="mx-auto grid max-w-6xl gap-14 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <span className="text-sm font-medium text-brand-300">للأطباء</span>
            <h2 className="mt-3 text-3xl font-bold leading-[1.4] sm:text-4xl">أداة يحبها الطبيب، لا لوحة تحكم مزدحمة.</h2>
            <p className="mt-5 leading-8 text-white/70">
              كل ما يهم في شاشة واحدة: الحساسيات والأمراض المزمنة والأدوية الحالية وآخر الزيارات والتحاليل — مع مصدر وتاريخ كل معلومة.
            </p>
            <Button asChild size="lg" className="mt-8 bg-white text-brand-800 hover:bg-brand-50">
              <Link href="/providers">اكتشف أدوات الطبيب <ArrowLeft className="size-4" /></Link>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { icon: Eye, title: "ملخص في نظرة", text: "أهم المعلومات أولاً، دون التنقل بين الصفحات." },
              { icon: FileCheck2, title: "وصفة منظمة", text: "جرعة وأوقات ومدة بنقرات، وتعليمات عربية واضحة تلقائياً." },
              { icon: Printer, title: "طباعة A4 أنيقة", text: "باسم الطبيب والمنشأة ورقم الوصفة ورمز تحقق لا يكشف الأدوية." },
              { icon: FlaskConical, title: "طلبات تحليل إلكترونية", text: "النتيجة تعود إليك وإلى المريض فور اعتمادها من المختبر." },
              { icon: History, title: "سجل لا يُمحى", text: "التصحيح موثّق بنسخة وسبب، ولا يُستبدل السجل بصمت." },
              { icon: WifiOff, title: "خفيف وسريع", text: "صفحات خفيفة، تحميل عند الطلب، مصمم لشبكات ضعيفة." },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <Icon className="size-5 text-brand-300" />
                <div className="mt-3 font-semibold">{title}</div>
                <p className="mt-1 text-sm leading-6 text-white/65">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- patients */}
      <section id="patients" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div className="order-2 grid grid-cols-2 gap-4 lg:order-1">
            {[
              { icon: Smartphone, title: "تطبيق ويب وموبايل", text: "بطاقتك وسجلك ووصفاتك وتحاليلك في جيبك." },
              { icon: Users, title: "حسابات العائلة", text: "تابع ملفات أطفالك بصلاحيات واضحة." },
              { icon: Lock, title: "أنت تقرر", text: "وافق أو ارفض، وألغِ الوصول متى شئت." },
              { icon: History, title: "من اطلع على ملفي؟", text: "سجل كامل بكل وصول: من، ومتى، ومن أي منشأة." },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-3xl border border-line bg-elevated p-6 shadow-soft">
                <div className="grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent"><Icon className="size-5" /></div>
                <div className="mt-4 font-semibold">{title}</div>
                <p className="mt-1 text-sm leading-6 text-muted">{text}</p>
              </div>
            ))}
          </div>
          <div className="order-1 lg:order-2">
            <SectionTitle align="start" eyebrow="للمرضى" title="ملفك ملكك" subtitle="لا داعي لحمل أكياس التحاليل والصور القديمة. كل ما يكتبه أطباؤك يصل إلى ملفك، ويمكنك إضافة ما لديك من أوراق قديمة — مع تمييز واضح بين ما صرّحت به وما اعتمده الطبيب." />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- privacy */}
      <section id="privacy" className="scroll-mt-20 border-y border-line bg-elevated">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <SectionTitle eyebrow="الخصوصية أولاً" title="مصممة لحماية أسرار المرضى" subtitle="الخصوصية ليست ميزة إضافية في حياة؛ إنها القاعدة التي بُني عليها كل شيء." />
          <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: QrCode, title: "QR لا يحمل بيانات", text: "البطاقة تحمل رمزاً عشوائياً فقط. مسحها من هاتف عادي لا يكشف شيئاً." },
              { icon: ShieldCheck, title: "صلاحيات على كل سجل", text: "الاستقبال لا يرى التشخيصات، ومدير المنشأة لا يفتح الملفات." },
              { icon: Lock, title: "موافقة محددة المدة", text: "الوصول لنطاق محدد ولمدة محددة، وينتهي تلقائياً." },
              { icon: History, title: "تدقيق غير قابل للتعديل", text: "سجل الوصول محمي على مستوى قاعدة البيانات." },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-3xl bg-bg p-6">
                <Icon className="size-6 text-brand-600" />
                <div className="mt-4 font-semibold">{title}</div>
                <p className="mt-1.5 text-sm leading-6 text-muted">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- CTA */}
      <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-brand-600 to-brand-800 px-8 py-16 text-center text-white sm:px-16">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.15),transparent_40%)]" />
          <h2 className="relative text-3xl font-bold leading-[1.4] sm:text-4xl">جاهزون لتجربة عيادة بلا أوراق ضائعة؟</h2>
          <p className="relative mx-auto mt-4 max-w-xl leading-8 text-white/75">
            نعمل حالياً مع منشآت محافظة الرقة. تواصل معنا لتفعيل منشأتك وتدريب فريقك مجاناً.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg" className="bg-white text-brand-800 hover:bg-brand-50"><Link href="/providers#join">طلب انضمام منشأة</Link></Button>
            <Button asChild size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10"><Link href="/login">لدي حساب</Link></Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function SectionTitle({ eyebrow, title, subtitle, align = "center" }: { eyebrow: string; title: string; subtitle?: string; align?: "center" | "start" }) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      <span className="text-sm font-semibold text-brand-600">{eyebrow}</span>
      <h2 className="mt-3 text-3xl font-bold leading-[1.4] tracking-tight sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-4 text-lg leading-8 text-muted">{subtitle}</p>}
    </div>
  );
}
