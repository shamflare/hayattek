import { cn } from "@/lib/cn";

/** HAYAT mark: a heartbeat line forming a leaf — life and care. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("size-9", className)} aria-hidden>
      <defs>
        <linearGradient id="hayat-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3cb7a6" />
          <stop offset="1" stopColor="#14665e" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#hayat-g)" />
      <path
        d="M7 21.5h6.2l2.6-6 4.4 12 3.3-8.2 1.7 2.2H33"
        fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="33" cy="21.5" r="2.2" fill="#fde7df" />
    </svg>
  );
}

export function Logo({ className, subtitle = true }: { className?: string; subtitle?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-xl font-bold tracking-tight text-fg">حياة</span>
        {subtitle && <span className="mt-1 text-[10px] font-medium tracking-[0.2em] text-subtle">HAYAT</span>}
      </span>
    </span>
  );
}
