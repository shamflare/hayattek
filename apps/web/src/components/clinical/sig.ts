/**
 * Client-side preview of the Arabic instructions. Mirrors backend/apps/medications/sig.py;
 * the server-rendered `sig` stays authoritative once the item is saved.
 */
export interface SigItem {
  dose_amount?: string | number | null;
  dose_unit?: string;
  schedule_type: string;
  times_of_day?: string[];
  times_per_day?: number | null;
  interval_hours?: number | null;
  interval_days?: number | null;
  weekdays?: string[];
  as_needed_reason?: string;
  meal_relation?: string;
  duration_value?: number | null;
  duration_unit?: string;
  end_date?: string | null;
  instructions?: string;
}

const TIMES: Record<string, string> = { morning: "صباحاً", noon: "ظهراً", evening: "مساءً", bedtime: "قبل النوم" };
const ORDER = ["morning", "noon", "evening", "bedtime"];
const WEEK: Record<string, string> = { sat: "السبت", sun: "الأحد", mon: "الاثنين", tue: "الثلاثاء", wed: "الأربعاء", thu: "الخميس", fri: "الجمعة" };
const MEALS: Record<string, string> = { before: "قبل الطعام", after: "بعد الطعام", with: "مع الطعام" };

function num(v: string | number): string {
  const s = String(Number(v));
  return ({ "0.5": "نصف", "0.25": "ربع", "1.5": "واحد ونصف" } as Record<string, string>)[s] ?? s;
}

function perDay(n: number) {
  return ({ 1: "مرة واحدة يومياً", 2: "مرتين يومياً", 3: "ثلاث مرات يومياً", 4: "أربع مرات يومياً" } as Record<number, string>)[n] ?? `${n} مرات يومياً`;
}

function duration(i: SigItem) {
  if (i.duration_unit === "ongoing") return "بشكل مستمر";
  if (i.end_date) return `حتى ${i.end_date.replaceAll("-", "/")}`;
  if (i.duration_value && i.duration_unit) {
    const u = ({ days: ["يوم", "أيام"], weeks: ["أسبوع", "أسابيع"], months: ["شهر", "أشهر"] } as Record<string, string[]>)[i.duration_unit];
    const v = i.duration_value;
    if (v === 1) return `لمدة ${u[0]}`;
    if (v === 2) return ({ days: "لمدة يومين", weeks: "لمدة أسبوعين", months: "لمدة شهرين" } as Record<string, string>)[i.duration_unit];
    return `لمدة ${v} ${v <= 10 ? u[1] : u[0]}`;
  }
  return "";
}

export function renderSig(i: SigItem): string {
  const parts: string[] = [];
  if (i.dose_amount !== null && i.dose_amount !== undefined && i.dose_amount !== "") {
    parts.push([num(i.dose_amount), i.dose_unit].filter(Boolean).join(" "));
  }
  switch (i.schedule_type) {
    case "times_of_day":
      if (i.times_of_day?.length) parts.push(ORDER.filter((t) => i.times_of_day!.includes(t)).map((t) => TIMES[t]).join(" و"));
      break;
    case "times_per_day":
      if (i.times_per_day) parts.push(perDay(i.times_per_day));
      break;
    case "every_hours":
      if (i.interval_hours) parts.push(i.interval_hours <= 10 ? `كل ${i.interval_hours} ساعات` : `كل ${i.interval_hours} ساعة`);
      break;
    case "every_days":
      if (i.interval_days) parts.push(i.interval_days === 2 ? "يوماً بعد يوم" : `كل ${i.interval_days} أيام`);
      break;
    case "weekly":
      if (i.weekdays?.length) parts.push("أيام " + i.weekdays.map((d) => WEEK[d]).join("، "));
      break;
    case "as_needed":
      parts.push("عند الحاجة" + (i.as_needed_reason ? ` (${i.as_needed_reason})` : ""));
      break;
    case "single_dose":
      parts.push("جرعة واحدة");
      break;
  }
  if (i.meal_relation && MEALS[i.meal_relation]) parts.push(MEALS[i.meal_relation]);
  const d = duration(i);
  if (d) parts.push(d);
  const text = parts.filter(Boolean).join(" ");
  if (i.instructions) return text ? `${text} — ${i.instructions}` : i.instructions;
  return text;
}
