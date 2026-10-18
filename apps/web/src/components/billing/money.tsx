import { cn } from "@/lib/cn";

/** Amounts arrive from the API as decimal strings; we never do money math in the UI. */
export function Money({ value, currency = "USD", signed = false, className, colored = false }: {
  value: string | number | null | undefined; currency?: string; signed?: boolean;
  className?: string; colored?: boolean;
}) {
  if (value === null || value === undefined || value === "") return <span className={className}>—</span>;
  const text = String(value);
  const negative = text.startsWith("-");
  const abs = negative ? text.slice(1) : text;
  const [int, frac = "00"] = abs.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = currency === "USD" ? "$" : currency;
  const sign = negative ? "−" : signed && Number(abs) > 0 ? "+" : "";
  return (
    <span className={cn("num whitespace-nowrap",
      colored && (negative ? "text-danger" : Number(abs) > 0 ? "text-success" : "text-muted"), className)}>
      {sign}{grouped}.{frac.padEnd(2, "0").slice(0, 2)} {symbol}
    </span>
  );
}

export const TX_KIND: Record<string, string> = {
  ai_usage: "استهلاك الذكاء الاصطناعي",
  payment: "دفعة",
  reversal: "عكس عملية",
  manual_debit: "خصم يدوي",
  credit_grant: "رصيد مجاني",
  charge_correction: "تصحيح رسوم",
  settlement: "تسوية مالية",
  refund: "استرداد مبلغ",
};

export const PAYMENT_METHOD: Record<string, string> = {
  cash: "نقداً", bank_transfer: "تحويل مصرفي", money_transfer: "حوالة", other: "أخرى",
};

export function balanceLabel(balance: string): string {
  const n = Number(balance);
  if (n < 0) return "مدين للمنصة";
  if (n > 0) return "رصيد دائن لصالحك";
  return "لا دين ولا رصيد";
}
