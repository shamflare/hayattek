import { ar, type Messages } from "./ar";
import { en } from "./en";

export type Locale = "ar" | "en";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T extends object>(base: T, override: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    out[key] =
      value && typeof value === "object" && current && typeof current === "object"
        ? merge(current as object, value as object)
        : value;
  }
  return out as T;
}

const dictionaries: Record<Locale, Messages> = { ar, en: merge(ar, en) };

/** Current UI locale. English is scaffolded and falls back to Arabic for missing keys. */
export const locale: Locale = "ar";
export const m: Messages = dictionaries[locale];

/** Label for an enum value, falling back to the raw value. */
export function label<K extends keyof Messages>(group: K, value?: string | null): string {
  if (!value) return "—";
  const table = m[group] as unknown as Record<string, string>;
  return table[value] ?? value;
}

export type { DeepPartial, Messages };
