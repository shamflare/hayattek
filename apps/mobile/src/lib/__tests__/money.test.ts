import { describe, expect, it } from "vitest";

import { balanceLabel, formatMinutes, formatMoney, moneySign, moneyTone } from "../money";

describe("moneySign", () => {
  it("reads the sign from decimal strings without float math", () => {
    expect(moneySign("-0.30")).toBe("negative");
    expect(moneySign("1000.00")).toBe("positive");
    expect(moneySign("0.00")).toBe("zero");
    expect(moneySign("-0.00")).toBe("zero");
    expect(moneySign("0.0001")).toBe("positive");
    expect(moneySign("-1000000000000000000.01")).toBe("negative");
  });
  it("treats empty / invalid values as zero", () => {
    expect(moneySign(null)).toBe("zero");
    expect(moneySign(undefined)).toBe("zero");
    expect(moneySign("")).toBe("zero");
    expect(moneySign("abc")).toBe("zero");
  });
});

describe("formatMoney", () => {
  it("formats balances with a real minus sign and grouping", () => {
    expect(formatMoney("-1234.5", "USD")).toBe("−1,234.50 $");
    expect(formatMoney("0.30", "USD")).toBe("0.30 $");
    expect(formatMoney("1000", "USD")).toBe("1,000.00 $");
    expect(formatMoney("-0.00", "USD")).toBe("0.00 $");
  });
  it("adds + only when asked (statement rows)", () => {
    expect(formatMoney("0.10", "USD", { signed: true })).toBe("+0.10 $");
    expect(formatMoney("-0.20", "USD", { signed: true })).toBe("−0.20 $");
    expect(formatMoney("0.00", "USD", { signed: true })).toBe("0.00 $");
  });
  it("keeps unit-price precision up to maxFraction without trailing zeros", () => {
    expect(formatMoney("0.1000", "USD", { maxFraction: 4 })).toBe("0.10 $");
    expect(formatMoney("0.0125", "USD", { maxFraction: 4 })).toBe("0.0125 $");
    expect(formatMoney("0.0125", "USD")).toBe("0.01 $"); // balances: cents (the server already rounded)
  });
  it("shows other currency codes and a dash for missing values", () => {
    expect(formatMoney("5", "SYP")).toBe("5.00 SYP");
    expect(formatMoney(null)).toBe("—");
  });
});

describe("balance wording and colour", () => {
  it("negative means the doctor owes the platform", () => {
    expect(balanceLabel("-12.00")).toBe("مدين للمنصة");
    expect(moneyTone("-12.00")).toBe("danger");
  });
  it("positive is a credit in the doctor's favour", () => {
    expect(balanceLabel("3.00")).toBe("رصيد دائن لصالحك");
    expect(moneyTone("3.00")).toBe("success");
  });
  it("zero is neutral", () => {
    expect(balanceLabel("0.00")).toBe("لا دين ولا رصيد");
    expect(moneyTone("0.00")).toBe("muted");
  });
});

describe("formatMinutes", () => {
  it("trims trailing zeros", () => {
    expect(formatMinutes("4.00")).toBe("4");
    expect(formatMinutes("2.50")).toBe("2.5");
    expect(formatMinutes(null)).toBe("0");
  });
});
