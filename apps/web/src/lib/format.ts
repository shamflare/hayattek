/** Display formatting. Values are stored in UTC; display uses Asia/Damascus (ADR-011). */

export const DISPLAY_TZ = "Asia/Damascus";
// "ar-SY" with Latin digits: clinical numbers stay unambiguous and copyable.
const LOCALE = "ar-SY-u-nu-latn";

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: DISPLAY_TZ, year: "numeric", month: "long", day: "numeric",
  }).format(d);
}

export function formatShortDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: DISPLAY_TZ, year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

export function formatTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: DISPLAY_TZ, hour: "2-digit", minute: "2-digit",
  }).format(d);
}

export function relativeTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return "—";
  const diff = (d.getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(d);
}

export function ageLabel(years: number | null | undefined, precision?: string | null): string {
  if (years === null || years === undefined) return "العمر غير معروف";
  const approx = precision && precision !== "exact" ? "حوالي " : "";
  if (years === 0) return `${approx}أقل من سنة`;
  if (years === 1) return `${approx}سنة واحدة`;
  if (years === 2) return `${approx}سنتان`;
  if (years <= 10) return `${approx}${years} سنوات`;
  return `${approx}${years} سنة`;
}

export function sexLabel(sex?: string | null): string {
  return sex === "male" ? "ذكر" : sex === "female" ? "أنثى" : "غير محدد";
}

export function initials(name?: string | null): string {
  if (!name) return "؟";
  const parts = name.replace(/^د\.\s*/, "").trim().split(/\s+/);
  return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
}

export function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatPhone(phone?: string | null): string {
  if (!phone) return "—";
  if (phone.startsWith("+963") && phone.length === 13) {
    return `0${phone.slice(4, 7)} ${phone.slice(7, 10)} ${phone.slice(10)}`;
  }
  return phone;
}
