import { describe, expect, it } from "vitest";
import { budgetYears, formatWholeEuros, proposeRule, readRule, readWholeEuros, spread, type BudgetRule } from "./budget";

/** Twelve months from whole euros (January first), the rest 0. */
const euros = (...values: number[]): number[] => [...values, ...Array<number>(12 - values.length).fill(0)].map((value) => value * 100);
/** Twelve months with whole euros in the given months (1 to 12). */
const at = (pairs: Record<number, number>): number[] => Array.from({ length: 12 }, (_, i) => (pairs[i + 1] ?? 0) * 100);
const sum = (months: number[]) => months.reduce((total, cents) => total + cents, 0);

describe("spread", () => {
  it("puts a monthly amount in every month", () => {
    expect(spread({ kind: "monthly", amountCents: 3100 }, null)).toEqual(Array(12).fill(3100));
  });

  it("puts a quarterly amount in the first month of its position and every third month after", () => {
    expect(spread({ kind: "quarterly", amountCents: 50200, month: 1 }, null)).toEqual(at({ 1: 502, 4: 502, 7: 502, 10: 502 }));
    expect(spread({ kind: "quarterly", amountCents: -400, month: 2 }, null)).toEqual(at({ 2: -4, 5: -4, 8: -4, 11: -4 }));
    expect(spread({ kind: "quarterly", amountCents: 400, month: 3 }, null)).toEqual(at({ 3: 4, 6: 4, 9: 4, 12: 4 }));
  });

  it("puts a yearly amount in its month", () => {
    expect(spread({ kind: "yearly", amountCents: 58200, month: 10 }, null)).toEqual(at({ 10: 582 }));
  });

  it("spreads a year's amount like the base, in whole euros, the rest on the largest month", () => {
    const rent = at({ 1: 1153, 2: 208, 4: 1153, 7: 1182, 10: 1182 });
    expect(spread({ kind: "pattern", amountCents: sum(rent) }, rent)).toEqual(rent);
    expect(spread({ kind: "pattern", amountCents: 600000 }, rent)).toEqual(at({ 1: 1418, 2: 256, 4: 1418, 7: 1454, 10: 1454 }));
    // 1000 over three equal months is 333,33 each: the euro left goes to the first of the largest.
    expect(spread({ kind: "pattern", amountCents: 100000 }, euros(100, 100, 100))).toEqual(euros(334, 333, 333));
    expect(spread({ kind: "pattern", amountCents: 200000 }, euros(100, 100, 100))).toEqual(euros(666, 667, 667));
    expect(spread({ kind: "pattern", amountCents: 700 }, euros(1, 1, 1, 2))).toEqual(euros(1, 1, 1, 4));
    // Raw cents in the base, and a month of the other sign.
    const base = [3099, -1250, 12001, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const months = spread({ kind: "pattern", amountCents: 50000 }, base);
    expect(sum(months)).toBe(50000);
    expect(months.every((cents) => cents % 100 === 0)).toBe(true);
    expect(months).toEqual(euros(112, -45, 433));
  });

  it("cannot spread like a base that is not there or adds up to nothing", () => {
    expect(() => spread({ kind: "pattern", amountCents: 100 }, null)).toThrow("no_pattern");
    expect(() => spread({ kind: "pattern", amountCents: 100 }, euros(5, -5))).toThrow("no_pattern");
  });

  it("takes the months of a custom rule as they are", () => {
    const months = euros(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, -12);
    expect(spread({ kind: "custom", months }, null)).toEqual(months);
  });
});

describe("proposeRule", () => {
  const propose = (months: number[], covered = 11) => proposeRule(months, covered);

  it("proposes the same amount every month when nearly every month has about the same", () => {
    // Energy: one month double, the rest close: the average of the active months.
    expect(propose(euros(34, 34, 68, 26, 26, 26, 26, 26, 26, 26, 26))).toEqual({ kind: "monthly", amountCents: 3100 });
    // A phone bill that went up a little.
    expect(propose(euros(50, 50, 50, 50, 50, 50, 52, 52, 52, 52, 52))).toEqual({ kind: "monthly", amountCents: 5100 });
    // A fee in ten of eleven months.
    expect(propose(euros(22, 22, 22, 22, 22, 22, 22, 0, 22, 22, 22))).toEqual({ kind: "monthly", amountCents: 2200 });
    // A whole year, and amounts in cents that round to whole euros first.
    expect(propose(Array(12).fill(3949), 12)).toEqual({ kind: "monthly", amountCents: 3900 });
    expect(propose(euros(-20, -20, -20, -20, -20, -20, -20, -20, -20, -20, -20))).toEqual({ kind: "monthly", amountCents: -2000 });
  });

  it("proposes a quarterly amount for three or four close amounts a quarter apart", () => {
    const waste = propose(at({ 4: 502, 7: 502, 10: 502 }));
    expect(waste).toEqual({ kind: "quarterly", amountCents: 50200, month: 1 });
    expect(sum(spread(waste!, null))).toBe(200800);
    expect(propose(at({ 3: 4, 6: 4, 9: 4 }))).toEqual({ kind: "quarterly", amountCents: 400, month: 3 });
    // Four within a fifth of their median (102,50, rounded away from zero).
    expect(propose(at({ 2: 100, 5: 110, 8: 95, 11: 105 }))).toEqual({ kind: "quarterly", amountCents: 10300, month: 2 });
  });

  it("proposes one amount in its month when only one month has something", () => {
    expect(propose(at({ 10: 582 }))).toEqual({ kind: "yearly", amountCents: 58200, month: 10 });
    expect(propose([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -25050, 0])).toEqual({ kind: "yearly", amountCents: -25100, month: 11 });
  });

  it("proposes 'like the base' for everything else, with the year's total in whole euros", () => {
    // Rent: five months, not a quarter apart.
    expect(propose(at({ 1: 1153, 2: 208, 4: 1153, 7: 1182, 10: 1182 }))).toEqual({ kind: "pattern", amountCents: 487800 });
    // Entree: every month, but with the seasons.
    const entree = euros(75, 120, 480, 950, 1520, 2661, 2410, 1890, 870, 310, 95);
    expect(propose(entree)).toEqual({ kind: "pattern", amountCents: sum(entree) });
    // A subsidy in April, July and September: not the same position in the quarter.
    expect(propose(at({ 4: 1500, 7: 1500, 9: 1500 }))).toEqual({ kind: "pattern", amountCents: 450000 });
    // A refund month with the other sign.
    expect(propose(at({ 3: 150, 6: 150, 9: -80 }))).toEqual({ kind: "pattern", amountCents: 22000 });
    // Three amounts a quarter apart that differ too much.
    expect(propose(at({ 1: 100, 4: 200, 7: 100 }))).toEqual({ kind: "pattern", amountCents: 40000 });
    // Too few months covered to call it monthly.
    expect(propose(euros(30, 30, 30, 30), 4)).toEqual({ kind: "pattern", amountCents: 12000 });
    // Rounded months first: spread gives exactly the base months back.
    const base = [3049, 0, 115351, 0, 0, 0, 0, 0, 20849, 0, 0, 0];
    const rule = propose(base)!;
    expect(rule).toEqual({ kind: "pattern", amountCents: 3000 + 115400 + 20800 });
    expect(spread(rule, base)).toEqual(at({ 1: 30, 3: 1154, 9: 208 }));
  });

  it("proposes nothing when no month has a whole euro", () => {
    expect(propose(Array(12).fill(0))).toBeNull();
    expect(propose([49, -49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });
});

describe("budgetYears", () => {
  it("runs from the first year of the books to the year after this one", () => {
    expect(budgetYears("2026-11-24")).toEqual([2027, 2028]);
    expect(budgetYears("2027-06-01")).toEqual([2027, 2028]);
    expect(budgetYears("2030-01-01")).toEqual([2027, 2028, 2029, 2030, 2031]);
  });
});

describe("readRule", () => {
  const base = euros(10, 20);
  const ok = (raw: unknown, withBase: number[] | null = null) => readRule(raw, withBase);

  it("takes each kind of rule, and nothing more than its own fields", () => {
    const rules: BudgetRule[] = [
      { kind: "monthly", amountCents: -3100 },
      { kind: "quarterly", amountCents: 50200, month: 3 },
      { kind: "yearly", amountCents: 58200, month: 12 },
      { kind: "pattern", amountCents: 100000 },
      { kind: "custom", months: euros(1, 2, 3) },
    ];
    for (const rule of rules) expect(ok(rule, base)).toEqual({ ok: true, rule });
    expect(ok({ kind: "monthly", amountCents: 100, month: 4, extra: true })).toEqual({ ok: true, rule: { kind: "monthly", amountCents: 100 } });
  });

  it("refuses a rule of the wrong shape", () => {
    for (const raw of [
      null,
      "monthly",
      { kind: "weekly", amountCents: 100 },
      { kind: "monthly" },
      { kind: "monthly", amountCents: "100" },
      { kind: "monthly", amountCents: 1.5 },
      { kind: "monthly", amountCents: 1_000_000_100 },
      { kind: "quarterly", amountCents: 100, month: 4 },
      { kind: "quarterly", amountCents: 100 },
      { kind: "yearly", amountCents: 100, month: 0 },
      { kind: "yearly", amountCents: 100, month: 13 },
      { kind: "custom", months: euros(1).slice(0, 11) },
      { kind: "custom", months: [...euros(1).slice(0, 11), -1_000_000_100] },
    ]) {
      expect(ok(raw, base), JSON.stringify(raw)).toEqual({ ok: false, error: "invalid_rule" });
    }
    expect(ok({ kind: "monthly", amountCents: -1_000_000_000 })).toMatchObject({ ok: true });
  });

  it("wants whole euros", () => {
    expect(ok({ kind: "monthly", amountCents: 3150 })).toEqual({ ok: false, error: "not_whole_euros" });
    expect(ok({ kind: "custom", months: [...euros(1).slice(0, 11), 1] })).toEqual({ ok: false, error: "not_whole_euros" });
  });

  it("spreads like the base only with a base that adds up to something", () => {
    expect(ok({ kind: "pattern", amountCents: 100 })).toEqual({ ok: false, error: "no_pattern" });
    expect(ok({ kind: "pattern", amountCents: 100 }, euros(5, -5))).toEqual({ ok: false, error: "no_pattern" });
  });
});

describe("whole euros", () => {
  it("reads whole euros as typed, with or without thousands dots", () => {
    expect(readWholeEuros("1.153")).toBe(115300);
    expect(readWholeEuros("1153")).toBe(115300);
    expect(readWholeEuros(" -293 ")).toBe(-29300);
    expect(readWholeEuros("−293")).toBe(-29300);
    expect(readWholeEuros("€ 1.234.567")).toBe(123456700);
    expect(readWholeEuros("10.000.000")).toBe(1_000_000_000);
    expect(readWholeEuros("1153,00")).toBe(115300);
    expect(readWholeEuros("1153,-")).toBe(115300);
    expect(readWholeEuros("0")).toBe(0);
  });

  it("says when a text is empty, has cents, or cannot be read", () => {
    expect(readWholeEuros("  ")).toBe("empty");
    expect(readWholeEuros("1153,50")).toBe("cents");
    expect(readWholeEuros("1.153,5")).toBe("cents");
    expect(readWholeEuros("12.5")).toBe("cents");
    expect(readWholeEuros("12,05")).toBe("cents");
    expect(readWholeEuros("twaalf")).toBe("unreadable");
    expect(readWholeEuros("1.15.3")).toBe("unreadable");
    expect(readWholeEuros("10.000.001")).toBe("unreadable");
    expect(readWholeEuros("--3")).toBe("unreadable");
  });

  it("writes whole euros with thousands dots and a minus", () => {
    expect(formatWholeEuros(115300)).toBe("1.153");
    expect(formatWholeEuros(-29300)).toBe("-293");
    expect(formatWholeEuros(0)).toBe("0");
    expect(formatWholeEuros(123456700)).toBe("1.234.567");
    expect(formatWholeEuros(-50)).toBe("-1");
    expect(formatWholeEuros(-49)).toBe("0");
  });
});
