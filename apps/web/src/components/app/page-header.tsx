import { ArrowRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/cn";

export function PageHeader({
  title, description, actions, back, className, eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: string;
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {back && (
          <Link href={back} className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <ArrowRight className="size-4" /> رجوع
          </Link>
        )}
        {eyebrow && <div className="mb-1 text-sm font-medium text-brand-600">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
