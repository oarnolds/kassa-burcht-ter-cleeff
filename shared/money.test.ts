import { describe, expect, it } from "vitest";
import { formatAmount, formatEuro, formatEuroShort, parseEuro } from "./money";

const nb = String.fromCharCode(160); // non-breaking space

describe("formatEuro", () => {
  it("writes a euro sign, a non-breaking space and a decimal comma", () => {
    expect(formatEuro(110)).toBe(`€${nb}1,10`);
    expect(formatEuro(0)).toBe(`€${nb}0,00`);
  });
  it("groups thousands with a dot", () => {
    expect(formatEuro(123456)).toBe(`€${nb}1.234,56`);
  });
  it("puts the minus before the euro sign", () => {
    expect(formatEuro(-360)).toBe(`-€${nb}3,60`);
  });
});

describe("formatEuroShort", () => {
  it("drops the cents of a whole amount", () => {
    expect(formatEuroShort(1000)).toBe(`€${nb}10`);
  });
  it("keeps the cents otherwise", () => {
    expect(formatEuroShort(1050)).toBe(`€${nb}10,50`);
  });
});

describe("formatAmount", () => {
  it("writes a bare amount with a decimal comma", () => {
    expect(formatAmount(1230)).toBe("12,30");
    expect(formatAmount(-5)).toBe("-0,05");
  });
});

describe("parseEuro", () => {
  it("reads whole euros and decimals with a comma or a dot", () => {
    expect(parseEuro("4")).toBe(400);
    expect(parseEuro("4,5")).toBe(450);
    expect(parseEuro("4.50")).toBe(450);
  });
  it("ignores the euro sign and surrounding spaces", () => {
    expect(parseEuro(" € 12,30 ")).toBe(1230);
  });
  it("rejects text, negatives and empty input", () => {
    expect(parseEuro("abc")).toBeNull();
    expect(parseEuro("-1")).toBeNull();
    expect(parseEuro("")).toBeNull();
  });
  it("rejects more than two decimals", () => {
    expect(parseEuro("1,234")).toBeNull();
  });
  it("reads a dot before a decimal comma as a thousands separator", () => {
    expect(parseEuro("1.250,00")).toBe(125000);
  });
  it("rejects a dot with three digits and no comma as ambiguous", () => {
    expect(parseEuro("1.250")).toBeNull();
  });
});
