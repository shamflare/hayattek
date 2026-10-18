/** Display formatting. Values are stored in UTC; display uses Asia/Damascus (ADR-011). */

export const DISPLAY_TZ = "Asia/Damascus";
// Arabic month names with Latin digits: clinical numbers stay unambiguous.
const LOCALE = "ar-SY-u-nu-latn";

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmt(d: Date, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(LOCALE, { timeZone: DISPLAY_TZ, ...options }).format(d);
  } catch {
    // Some JS engines ship without full ICU data; fall back to ISO-ish output.
    return d.toISOString().slice(0, options.hour ? 16 : 10).replace("T", " ");
  }
}

export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? fmt(d, { year: "numeric", month: "long", day: "numeric" }) : "—";
}

export function formatShortDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? fmt(d, { year: "numeric", month: "short", day: "numeric" }) : "—";
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d
    ? fmt(d, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
}

/** "4821093755" -> "4821 0937 55" (ADR-004 display format). */
export function formatHealthNumber(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10) return value;
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Decimal strings from the API ("5.40") without trailing zeros ("5.4"). */
export function formatDecimal(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return String(Number(n.toFixed(4)));
}

export function greeting(): "morning" | "evening" {
  const hour = Number(
    (() => {
      try {
        return new Intl.DateTimeFormat("en-GB", { timeZone: DISPLAY_TZ, hour: "2-digit", hour12: false })
          .format(new Date());
      } catch {
        return String(new Date().getHours());
      }
    })(),
  );
  return hour >= 4 && hour < 12 ? "morning" : "evening";
}
