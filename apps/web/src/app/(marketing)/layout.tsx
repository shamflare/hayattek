import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="حياة — الرئيسية"><Logo /></Link>
          <nav className="hidden items-center gap-6 text-[15px] text-muted md:flex">
            <Link href="/#how" className="hover:text-fg">كيف تعمل</Link>
            <Link href="/providers" className="hover:text-fg">للأطباء والمنشآت</Link>
            <Link href="/#patients" className="hover:text-fg">للمرضى</Link>
            <Link href="/#privacy" className="hover:text-fg">الخصوصية</Link>
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <Button asChild variant="ghost" className="hidden sm:inline-flex"><Link href="/login">تسجيل الدخول</Link></Button>
            <Button asChild><Link href="/providers#join">انضم إلى الشبكة</Link></Button>
          </div>
        </div>
      </header>
      {children}
      <footer className="border-t border-line bg-elevated">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-7 text-muted">
              شبكة صحية رقمية موحدة للقطاع الطبي الخاص في سوريا. نبدأ من الرقة، ونكبر معاً.
            </p>
          </div>
          <FooterCol title="المنصة" links={[["كيف تعمل", "/#how"], ["للأطباء والمنشآت", "/providers"], ["للمرضى", "/#patients"]]} />
          <FooterCol title="الثقة" links={[["الخصوصية", "/privacy"], ["الشروط", "/terms"], ["التحقق من وصفة", "/verify"]]} />
          <FooterCol title="الحساب" links={[["تسجيل الدخول", "/login"], ["استعادة كلمة المرور", "/forgot-password"]]} />
        </div>
        <div className="border-t border-line py-5 text-center text-xs text-subtle">
          © {new Date().getFullYear()} حياة · hayattek.com — جميع الحقوق محفوظة
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="mb-3 text-sm font-semibold">{title}</div>
      <ul className="space-y-2 text-sm text-muted">
        {links.map(([label, href]) => (
          <li key={href}><Link href={href} className="hover:text-brand-600">{label}</Link></li>
        ))}
      </ul>
    </div>
  );
}
