"use client";

import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/cn";

import { Button } from "./button";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title, description, children, className, size = "md", footer,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  footer?: React.ReactNode;
}) {
  const width = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" }[size];
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-fg/30 backdrop-blur-[2px] data-[state=open]:animate-fade-up" />
      <D.Content
        dir="rtl"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border border-line bg-elevated shadow-float focus:outline-none",
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl",
          "data-[state=open]:animate-fade-up",
          width,
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <D.Title className="text-lg font-semibold text-fg">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{typeof title === "string" ? title : ""}</D.Description>
            )}
          </div>
          <D.Close asChild>
            <Button variant="ghost" size="icon" aria-label="إغلاق"><X className="size-5" /></Button>
          </D.Close>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-sunken/50 px-6 py-4 sm:rounded-b-3xl">
            {footer}
          </div>
        )}
      </D.Content>
    </D.Portal>
  );
}

/** Small confirmation dialog for destructive or irreversible actions. */
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = "تأكيد", tone = "primary", loading,
  onConfirm, children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  loading?: boolean;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        title={title}
        description={description}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button variant={tone} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
          </>
        }
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
