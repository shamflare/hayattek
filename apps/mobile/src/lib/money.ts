/**
 * Money display helpers (pure, unit-tested in `src/lib/__tests__/money.test.ts`).
 *
 * Amounts arrive from the API as decimal strings ("-12.30"). The app never does money
 * arithmetic: every figure (balance, amount due, price) is computed by the server from
 * the ledger. We only parse the sign and format the digits.
 *
 * Sign convention (docs/POSTPAID_WALLET.md): positive = credit in the doctor's favour,
 * negative = the doctor owes the platform.
 */

export type MoneySign = "negative" | "positive" | "zero";

const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?$/;

function parts(value: string | number): { negative: boolean; int: string; frac: string } | null {
  const text = String(value).trim();
  const m = text.match(DECIMAL_RE);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) return null;
  const int = (m[2] || "0").replace(/^0+(?=\d)/, "");
  const frac = m[3] ?? "";
  const isZero = /^0*$/.test(int) && /^0*$/.test(frac);
  return { negative: m[1] === "-" && !isZero, int, frac };
}

/** Sign of a decimal string without converting it to a float. */
export function moneySign(value: string | number | null | undefined): MoneySign {
  if (value === null || value === undefined || value === "") return "zero";
  const p = parts(value);
  if (!p) return "zero";
  if (p.negative) return "negative";
  return /^0*$/.test(p.int) && /^0*$/.test(p.frac) ? "zero" : "positive";
}

export function currencySymbol(currency: string | null | undefined): string {
  if (!currency || currency === "USD") return "$";
  return currency;
}

/**
 * "-1234.5" -> "−1,234.50 $". `signed` adds "+" for positive amounts (statement rows).
 * `maxFraction` keeps extra precision for unit prices ("0.0125" per minute) while
 * balances stay at cents. Returns "—" for missing values.
 */
export function formatMoney(
  value: string | number | null | undefined,
  currency: string | null | undefined = "USD",
  opts: { signed?: boolean; maxFraction?: number } = {},
): string {
  if (value === null || value === undefined || value === "") return "—";
  const p = parts(value);
  if (!p) return String(value);
  const maxFraction = Math.max(2, opts.maxFraction ?? 2);
  let frac = p.frac.slice(0, maxFraction).replace(/0+$/, "");
  frac = frac.padEnd(2, "0");
  const grouped = p.int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = p.negative ? "−" : opts.signed && moneySign(value) === "positive" ? "+" : "";
  return `${sign}${grouped}.${frac} ${currencySymbol(currency)}`;
}

/** Arabic explanation of the balance sign. */
export function balanceLabel(value: string | number | null | undefined): string {
  switch (moneySign(value)) {
    case "negative": return "مدين للمنصة";
    case "positive": return "رصيد دائن لصالحك";
    default: return "لا دين ولا رصيد";
  }
}

/** Colour tone for a balance or a statement amount. */
export function moneyTone(value: string | number | null | undefined): "danger" | "success" | "muted" {
  const s = moneySign(value);
  return s === "negative" ? "danger" : s === "positive" ? "success" : "muted";
}

/** "4.00" billable minutes -> "4", "2.50" -> "2.5" (display only). */
export function formatMinutes(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "0";
  const p = parts(value);
  if (!p) return String(value);
  const frac = p.frac.replace(/0+$/, "");
  return `${p.negative ? "−" : ""}${p.int}${frac ? `.${frac}` : ""}`;
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
  cash: "نقداً",
  bank_transfer: "تحويل مصرفي",
  money_transfer: "حوالة",
  other: "أخرى",
};
