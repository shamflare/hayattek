import { HeartPulse, Lock, QrCode } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/ui/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="w-fit"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">{children}</div>
        <p className="text-center text-xs text-subtle">© {new Date().getFullYear()} حياة · hayattek.com</p>
      </div>
      <div className="relative hidden overflow-hidden bg-brand-800 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(114,210,194,0.35),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(224,122,95,0.25),transparent_40%)]" />
        <svg className="absolute inset-0 h-full w-full opacity-[0.07]" aria-hidden>
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M32 0H0v32" fill="none" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        <div className="relative flex h-full flex-col justify-center px-16 text-white">
          <h2 className="max-w-md text-4xl font-bold leading-[1.4]">ملف صحي واحد، يرافق المريض أينما ذهب.</h2>
          <p className="mt-4 max-w-md text-lg leading-8 text-white/75">
            حياة تربط العيادات والمختبرات ومراكز الأشعة بملف موحد وآمن — بإذن المريض دائماً.
          </p>
          <div className="mt-10 grid max-w-md gap-3">
            {[
              { icon: QrCode, text: "بطاقة صحية بـ QR تفتح الملف خلال ثوانٍ" },
              { icon: Lock, text: "لا يرى أحد الملف إلا بموافقة المريض، وكل وصول مسجّل" },
              { icon: HeartPulse, text: "وصفات وتحاليل وتقارير منظمة في سجل زمني واضح" },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
                <Icon className="size-5 shrink-0 text-brand-200" />
                <span className="text-[15px]">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
