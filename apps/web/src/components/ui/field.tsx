import * as React from "react";

import { cn } from "@/lib/cn";

const control =
  "w-full rounded-xl border border-line bg-elevated px-3.5 text-[15px] text-fg placeholder:text-subtle transition-colors focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:bg-sunken disabled:text-muted aria-[invalid=true]:border-danger";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(control, "h-11", className)} {...props} />;
  },
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...props }, ref) {
  return (
    <textarea ref={ref} rows={rows} className={cn(control, "py-2.5 leading-7", className)} {...props} />
  );
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(control, "h-11 appearance-none bg-no-repeat pe-3 ps-9", className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%237c8b88' stroke-width='2' viewBox='0 0 24 24'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundPosition: "left 0.75rem center",
        }}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-fg", className)} {...props} />;
}

interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  optional?: boolean;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}

export function Field({ label, hint, error, optional, htmlFor, className, children }: FieldProps) {
  // Link the label to a single native control automatically (accessibility + tests).
  const autoId = React.useId();
  let id = htmlFor;
  if (!id && React.isValidElement(children) && isNativeControl(children)) {
    const element = children as React.ReactElement<{ id?: string }>;
    id = element.props.id ?? autoId;
    if (!element.props.id) children = React.cloneElement(element, { id });
  }
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <Label htmlFor={id} className="flex items-center gap-1.5">
          {label}
          {optional && <span className="text-xs font-normal text-subtle">(اختياري)</span>}
        </Label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">{error}</p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

const NATIVE = new Set<unknown>(["input", "textarea", "select"]);

function isNativeControl(el: React.ReactElement): boolean {
  const type = el.type as unknown;
  return NATIVE.has(type) || type === Input || type === Textarea || type === Select;
}

/** Pill-style multi/single choice used for quick clinical inputs (times of day, scopes…). */
export function ChoiceChips<T extends string>({
  options, value, onChange, multiple = false, className,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T[] | T | null;
  onChange: (next: T[] | T) => void;
  multiple?: boolean;
  className?: string;
}) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  return (
    <div className={cn("flex flex-wrap gap-2", className)} role={multiple ? "group" : "radiogroup"}>
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role={multiple ? "checkbox" : "radio"}
            aria-checked={active}
            onClick={() => {
              if (multiple) {
                onChange(active ? selected.filter((v) => v !== option.value) : [...selected, option.value]);
              } else {
                onChange(option.value);
              }
            }}
            className={cn(
              "h-9 rounded-full border px-3.5 text-sm transition-all",
              active
                ? "border-brand-500 bg-brand-500 text-white shadow-soft"
                : "border-line bg-elevated text-muted hover:border-brand-300 hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
