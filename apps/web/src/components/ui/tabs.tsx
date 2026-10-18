"use client";

import { Tabs as T } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/cn";

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return (
    <T.List
      className={cn(
        "flex gap-1 overflow-x-auto rounded-2xl border border-line bg-sunken p-1 [scrollbar-width:none]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 rounded-xl px-4 text-sm text-muted transition-all hover:text-fg",
        "data-[state=active]:bg-elevated data-[state=active]:font-semibold data-[state=active]:text-fg data-[state=active]:shadow-soft",
        className,
      )}
      {...props}
    />
  );
}
