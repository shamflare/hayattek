import { describe, expect, it } from "vitest";

import { extractCardToken, parseHealthNumber } from "../card-token";

const TOKEN = "Abc123_-XyZ7890qwerty";

describe("extractCardToken", () => {
  it("accepts the production card URL", () => {
    expect(extractCardToken(`https://hayattek.com/c/${TOKEN}`)).toBe(TOKEN);
  });
  it("accepts dev URLs, trailing slash, query and fragment", () => {
    expect(extractCardToken(`http://localhost:3100/c/${TOKEN}/`)).toBe(TOKEN);
    expect(extractCardToken(`http://192.168.1.20:3100/c/${TOKEN}?src=qr#x`)).toBe(TOKEN);
  });
  it("accepts a bare token with surrounding whitespace", () => {
    expect(extractCardToken(`  ${TOKEN}\n`)).toBe(TOKEN);
  });
  it("rejects foreign QR codes and garbage", () => {
    expect(extractCardToken("https://example.com/other/path")).toBeNull();
    expect(extractCardToken("WIFI:S:home;T:WPA;P:secret;;")).toBeNull();
    expect(extractCardToken("")).toBeNull();
    expect(extractCardToken("short")).toBeNull();
    expect(extractCardToken("javascript:alert(1)")).toBeNull();
  });
  it("does not mistake a long number for a token", () => {
    expect(extractCardToken("12345678901234567890")).toBeNull();
  });
});

describe("parseHealthNumber", () => {
  it("accepts 10 digits with spaces or dashes", () => {
    expect(parseHealthNumber("4821 0937 55")).toBe("4821093755");
    expect(parseHealthNumber("4821-0937-55")).toBe("4821093755");
  });
  it("accepts Arabic-Indic digits", () => {
    expect(parseHealthNumber("٤٨٢١ ٠٩٣٧ ٥٥")).toBe("4821093755");
  });
  it("rejects other lengths", () => {
    expect(parseHealthNumber("12345")).toBeNull();
    expect(parseHealthNumber("48210937551")).toBeNull();
  });
});
