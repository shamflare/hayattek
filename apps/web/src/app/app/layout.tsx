"use client";

import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { AppShell } from "@/components/app/app-shell";
import { LogoMark } from "@/components/ui/logo";
import { SessionProvider, useSession } from "@/lib/session";

function Gate({ children }: { children: React.ReactNode }) {
  const { me, isLoading, ready } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (!isLoading && !me) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [isLoading, me, pathname, router]);

  if (!me || !ready) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-3 text-sm text-muted">
          <LogoMark className="size-12 animate-pulse" />
          جارٍ التحميل…
        </div>
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Gate>{children}</Gate>
    </SessionProvider>
  );
}
