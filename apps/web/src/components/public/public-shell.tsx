import Link from "next/link";
import * as React from "react";

import { Logo } from "@/components/ui/logo";

/** Minimal frame for public, no-login pages (card scan, prescription check). */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-line bg-elevated/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4">
          <Link href="/" aria-label="حياة — الصفحة الرئيسية"><Logo /></Link>
          <Link href="/login" className="text-sm font-medium text-brand-600 hover:underline">تسجيل الدخول</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">{children}</main>
      <footer className="py-6 text-center text-xs text-subtle">© حياة · hayattek.com</footer>
    </div>
  );
}
