"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Bell, Building2, Check, ChevronDown, HeartPulse, LogOut, Menu, Moon, Search, ShieldCheck,
  Sun, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import * as React from "react";

import { toggleTheme } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Avatar, Badge, Kbd } from "@/components/ui/surface";
import { api, patientApi, unwrap } from "@/lib/api";
import { cn } from "@/lib/cn";
import { label } from "@/lib/i18n";
import { useSession } from "@/lib/session";

import { CommandPalette } from "./command-palette";
import { adminNav, areaForPath, type NavItem, patientNav, staffNav } from "./nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const session = useSession();
  const { me, membership, roles, isClinician } = session;
  const area = areaForPath(pathname);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  const nav: NavItem[] =
    area === "patient" ? patientNav : area === "admin" ? adminNav : staffNav(roles, isClinician);

  React.useEffect(() => setMobileOpen(false), [pathname]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && area === "staff") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [area]);

  // The most specific nav entry matching the current path is the active one.
  const activeHref = nav
    .map((n) => n.href)
    .filter((h) => pathname === h || pathname.startsWith(h + "/"))
    .sort((a, b) => b.length - a.length)[0];
  const isActive = (href: string) => href === activeHref;

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 px-2 pt-2">
        <Link href="/app"><Logo /></Link>
      </div>
      <ContextSwitcher />
      <div className="mt-3 flex flex-col gap-0.5">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "group flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors",
              isActive(item.href)
                ? "bg-brand-600 font-semibold text-white shadow-soft"
                : "text-muted hover:bg-sunken hover:text-fg",
            )}
          >
            <item.icon className="size-[18px] shrink-0" />
            {item.label}
          </Link>
        ))}
      </div>
      <div className="mt-auto rounded-2xl border border-line bg-sunken/60 p-3 text-xs leading-6 text-muted">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-fg">
          <ShieldCheck className="size-4 text-brand-600" /> خصوصية محمية
        </div>
        كل وصول إلى ملف طبي يُسجّل ويستطيع المريض رؤيته.
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[272px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-e border-line bg-elevated lg:block">{sidebar}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-fg/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-[86%] max-w-xs animate-fade-up bg-elevated shadow-float">
            <button className="absolute end-3 top-4 p-2 text-muted" onClick={() => setMobileOpen(false)} aria-label="إغلاق">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur-md lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="القائمة">
            <Menu className="size-5" />
          </Button>
          {area === "staff" && membership && (session.has("physician", "receptionist", "nurse", "lab_staff", "imaging_staff")) ? (
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex h-10 w-full max-w-md items-center gap-2 rounded-xl border border-line bg-elevated px-3 text-sm text-subtle transition-colors hover:border-brand-300"
            >
              <Search className="size-4" />
              <span className="flex-1 text-start">ابحث عن مريض بالاسم أو الرقم الصحي أو الهاتف…</span>
              <span className="hidden sm:inline"><Kbd>Ctrl K</Kbd></span>
            </button>
          ) : (
            <div className="flex-1" />
          )}
          <div className="ms-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="الوضع الليلي">
              <Sun className="hidden size-5 dark:block" />
              <Moon className="size-5 dark:hidden" />
            </Button>
            <NotificationsBell area={area} />
            <UserMenu />
          </div>
        </header>

        {me?.mfa_setup_required && (
          <div className="no-print border-b border-warning/30 bg-warning-soft px-4 py-2 text-center text-sm text-warning lg:px-8">
            حسابك يتطلب تفعيل المصادقة الثنائية.{" "}
            <Link href="/app/settings/security" className="font-semibold underline">فعّلها الآن</Link>
          </div>
        )}

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-6 lg:px-8 lg:pb-10">{children}</main>

        <MobileTabBar items={nav.filter((n) => n.mobile).slice(0, 5)} isActive={isActive} />
      </div>
      {area === "staff" && <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />}
    </div>
  );
}

function MobileTabBar({ items, isActive }: { items: NavItem[]; isActive: (h: string) => boolean }) {
  if (items.length < 2) return null;
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-elevated/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
      <div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((item) => (
          <Link key={item.href} href={item.href}
            className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px]",
              isActive(item.href) ? "font-semibold text-brand-600" : "text-subtle")}>
            <item.icon className="size-5" />
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function ContextSwitcher() {
  const { me, membership, switchMembership } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const area = areaForPath(pathname);
  if (!me) return null;
  const hasPatientArea = Boolean(me.patient) || me.wards.length > 0;
  const options = me.memberships.length + (hasPatientArea ? 1 : 0) + (me.is_platform_admin ? 1 : 0);

  const current =
    area === "patient"
      ? { title: "ملفي الصحي", subtitle: me.patient?.health_number ?? "حسابي", icon: HeartPulse }
      : area === "admin"
        ? { title: "إدارة المنصة", subtitle: "حياة", icon: ShieldCheck }
        : {
            title: membership?.organization.name ?? "اختر المنشأة",
            subtitle: (membership?.roles as string[] | undefined)?.map((r) => label("roles", r)).join("، ") ?? "",
            icon: Building2,
          };

  const trigger = (
    <div className="flex w-full items-center gap-3 rounded-2xl border border-line bg-sunken/50 p-2.5 text-start">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-elevated text-brand-600 shadow-soft">
        <current.icon className="size-[18px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{current.title}</div>
        <div className="truncate text-xs text-muted">{current.subtitle}</div>
      </div>
      {options > 1 && <ChevronDown className="size-4 text-subtle" />}
    </div>
  );
  if (options <= 1) return trigger;

  return (
    <DropdownMenu.Root dir="rtl">
      <DropdownMenu.Trigger className="w-full rounded-2xl">{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6}
          className="z-50 w-64 rounded-2xl border border-line bg-elevated p-1.5 shadow-float">
          <DropdownMenu.Label className="px-2 py-1.5 text-xs text-subtle">أعمل باسم</DropdownMenu.Label>
          {me.memberships.map((m) => (
            <DropdownMenu.Item key={m.id} onSelect={() => switchMembership(m.id)}
              className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm outline-none data-[highlighted]:bg-sunken">
              <Building2 className="size-4 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate">{m.organization.name}</div>
                <div className="text-xs text-subtle">{(m.roles as string[]).map((r) => label("roles", r)).join("، ")}</div>
              </div>
              {area === "staff" && membership?.id === m.id && <Check className="size-4 text-brand-600" />}
            </DropdownMenu.Item>
          ))}
          {(hasPatientArea || me.is_platform_admin) && <DropdownMenu.Separator className="my-1 h-px bg-line" />}
          {hasPatientArea && (
            <DropdownMenu.Item onSelect={() => router.push("/app/me")}
              className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm outline-none data-[highlighted]:bg-sunken">
              <HeartPulse className="size-4 text-accent" /> ملفي الصحي
            </DropdownMenu.Item>
          )}
          {me.is_platform_admin && (
            <DropdownMenu.Item onSelect={() => router.push("/app/admin")}
              className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm outline-none data-[highlighted]:bg-sunken">
              <ShieldCheck className="size-4 text-brand-600" /> إدارة المنصة
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function NotificationsBell({ area }: { area: string }) {
  const client = area === "patient" ? patientApi : api;
  const { data } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => unwrap(client.GET("/api/v1/notifications/unread-count")),
    refetchInterval: 60_000,
  });
  return (
    <Button variant="ghost" size="icon" asChild aria-label="الإشعارات">
      <Link href="/app/notifications" className="relative">
        <Bell className="size-5" />
        {!!data?.unread && (
          <span className="absolute end-1 top-1 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
            {data.unread > 9 ? "9+" : data.unread}
          </span>
        )}
      </Link>
    </Button>
  );
}

function UserMenu() {
  const { me, logout } = useSession();
  if (!me) return null;
  const name = me.practitioner?.display_name ?? me.full_name;
  return (
    <DropdownMenu.Root dir="rtl">
      <DropdownMenu.Trigger className="flex items-center gap-2 rounded-xl p-1 hover:bg-sunken">
        <Avatar name={name} className="size-9 text-xs" />
        <span className="hidden max-w-36 truncate text-sm font-medium md:inline">{name}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-60 rounded-2xl border border-line bg-elevated p-1.5 shadow-float">
          <div className="px-2 py-2">
            <div className="truncate text-sm font-semibold">{name}</div>
            <div className="truncate text-xs text-muted">{me.email ?? me.phone}</div>
            {me.practitioner && (
              <Badge tone={me.practitioner.verification_status === "verified" ? "success" : "warning"} className="mt-2">
                {label("verification", me.practitioner.verification_status)}
              </Badge>
            )}
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item asChild>
            <Link href="/app/settings/security" className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm outline-none data-[highlighted]:bg-sunken">
              <ShieldCheck className="size-4" /> الأمان وكلمة المرور
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={() => logout()} className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 text-sm text-danger outline-none data-[highlighted]:bg-danger-soft">
            <LogOut className="size-4" /> تسجيل الخروج
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
