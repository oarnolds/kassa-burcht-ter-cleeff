// The begroting: per year and per income or expense account a rule for its twelve months, in whole euros. Shared by
// the Worker (which stores the months a rule gives) and beheer (which proposes rules and shows them). Amounts are
// integer cents, as the result report shows them: income and costs both positive.

import { LEDGER_START } from "./ledger-types";

/**
 * How a line's year is laid over its months. `quarterly.month` is the first month of the quarter it falls in (1 for
 * January, April, July and October; 2 for February …; 3 for March …). `pattern` spreads a year's amount like the
 * line's base; `custom` gives every month itself. Every amount is a whole number of euros, and may be negative.
 */
export type BudgetRule =
  | { kind: "monthly"; amountCents: number }
  | { kind: "quarterly"; amountCents: number; month: 1 | 2 | 3 }
  | { kind: "yearly"; amountCents: number; month: number }
  | { kind: "pattern"; amountCents: number }
  | { kind: "custom"; months: number[] };

/** Where a year's proposal came from: the mutations of e-Boekhouden, the books of the year before, or nothing. */
export type BudgetSource = { kind: "mutations" | "ledger" | "empty"; baseYear: number | null; from: string | null; to: string | null };
/** `base`: the twelve months of the source the line was proposed from (null without one); `months` what the rule gives. */
export type BudgetLine = { accountCode: string; rule: BudgetRule; base: number[] | null; months: number[] };
export type Budget = { year: number; source: BudgetSource | null; lines: BudgetLine[] };
/** A year of the books per income and expense account and month, as the report shows it; `lastDate` its last booking. */
export type BudgetActuals = { year: number; lastDate: string | null; accounts: { accountCode: string; cents: number[] }[] };

export type RuleError = "invalid_rule" | "not_whole_euros" | "no_pattern";

/** The largest amount a rule or a month may hold: ten million euros. */
export const MAX_BUDGET_CENTS = 1_000_000_000;

const FIRST_YEAR = Number(LEDGER_START.slice(0, 4));
const MONTHS = 12;
const zeros = (): number[] => Array<number>(MONTHS).fill(0);
const total = (months: number[]): number => months.reduce((sum, cents) => sum + cents, 0);

/** Rounded to whole euros, a half away from zero, in euros; never -0. */
const roundEuros = (euros: number): number => Math.sign(euros) * Math.round(Math.abs(euros)) || 0;
/** Cents rounded to whole euros, still in cents. */
const toWhole = (cents: number): number => roundEuros(cents / 100) * 100;

/** The months as whole euros, still in cents: how a base is kept. */
export const wholeMonths = (months: number[]): number[] => months.map(toWhole);

/** The years a budget may be made for: from the first year of the books to the year after this one. */
export function budgetYears(today: string): number[] {
  const last = Math.max(Number(today.slice(0, 4)), FIRST_YEAR) + 1;
  return Array.from({ length: last - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
}

/** The twelve months a rule gives. A pattern needs a base that adds up to something ("no_pattern"). */
export function spread(rule: BudgetRule, base: number[] | null): number[] {
  const months = zeros();
  switch (rule.kind) {
    case "monthly":
      return months.fill(rule.amountCents);
    case "quarterly":
      for (let month = rule.month; month <= MONTHS; month += 3) months[month - 1] = rule.amountCents;
      return months;
    case "yearly":
      months[rule.month - 1] = rule.amountCents;
      return months;
    case "custom":
      return [...rule.months];
    case "pattern": {
      const sum = base ? total(base) : 0;
      if (!base || sum === 0) throw new Error("no_pattern");
      const euros = base.map((cents) => roundEuros((cents * rule.amountCents) / sum / 100));
      // What rounding left over goes on the month with the most in the base, the first of those on a tie.
      const largest = base.reduce((best, cents, i) => (Math.abs(cents) > Math.abs(base[best]!) ? i : best), 0);
      euros[largest]! += rule.amountCents / 100 - total(euros);
      return euros.map((value) => value * 100 || 0);
    }
  }
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
const near = (value: number, to: number, share: number) => Math.sign(value) === Math.sign(to) && Math.abs(value - to) <= share * Math.abs(to);

/**
 * A rule that gives about what a source year had in each month. `covered`: how many months the source covers, from
 * its first to its last (11 for January to November). The months are rounded to whole euros first. One month: once
 * a year. Three or four close amounts a quarter apart: per quarter. Nearly every month about the same: every month,
 * at the pace of the months covered (their total over `covered`, so a month without anything lowers it). Anything
 * else: the year's total spread like the source (or, when that total is nothing, the months themselves).
 * Nothing in any month: null.
 */
export function proposeRule(cents: number[], covered: number): BudgetRule | null {
  const euros = cents.map((value) => roundEuros(value / 100));
  const active = euros.flatMap((value, i) => (value === 0 ? [] : [{ month: i + 1, value }]));
  if (active.length === 0) return null;
  if (active.length === 1) return { kind: "yearly", amountCents: active[0]!.value * 100, month: active[0]!.month };

  const values = active.map((one) => one.value);
  const middle = median(values);
  const position = (month: number) => ((month - 1) % 3) + 1;
  if (
    (active.length === 3 || active.length === 4) &&
    active.every((one) => position(one.month) === position(active[0]!.month)) &&
    values.every((value) => near(value, middle, 0.2))
  ) {
    return { kind: "quarterly", amountCents: roundEuros(middle) * 100, month: position(active[0]!.month) as 1 | 2 | 3 };
  }
  if (covered >= 6 && active.length >= covered - 2 && values.filter((value) => near(value, middle, 0.35)).length >= 0.6 * active.length) {
    return { kind: "monthly", amountCents: roundEuros(total(euros) / covered) * 100 };
  }
  // Months that add up to nothing cannot be spread like themselves: they are given as they are.
  if (total(euros) === 0) return { kind: "custom", months: euros.map((value) => value * 100) };
  return { kind: "pattern", amountCents: total(euros) * 100 };
}

/** Every month within the limit: a rule "like the base" on a base that nearly adds up to nothing can go far beyond it. */
export const withinLimit = (months: number[]): boolean => months.every((cents) => Math.abs(cents) <= MAX_BUDGET_CENTS);

const isAmount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= MAX_BUDGET_CENTS;
const isMonth = (value: unknown, last: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= last;

/**
 * A rule as it came in (from a request), read into its own fields only; or why it cannot be one. `base` is the
 * line's base, which a pattern needs.
 */
export function readRule(raw: unknown, base: number[] | null): { ok: true; rule: BudgetRule } | { ok: false; error: RuleError } {
  const invalid = { ok: false, error: "invalid_rule" } as const;
  if (typeof raw !== "object" || raw === null) return invalid;
  const given = raw as Record<string, unknown>;
  let rule: BudgetRule;
  switch (given.kind) {
    case "monthly":
    case "pattern":
      if (!isAmount(given.amountCents)) return invalid;
      rule = { kind: given.kind, amountCents: given.amountCents };
      break;
    case "quarterly":
      if (!isAmount(given.amountCents) || !isMonth(given.month, 3)) return invalid;
      rule = { kind: "quarterly", amountCents: given.amountCents, month: given.month as 1 | 2 | 3 };
      break;
    case "yearly":
      if (!isAmount(given.amountCents) || !isMonth(given.month, MONTHS)) return invalid;
      rule = { kind: "yearly", amountCents: given.amountCents, month: given.month };
      break;
    case "custom":
      if (!Array.isArray(given.months) || given.months.length !== MONTHS || !given.months.every(isAmount)) return invalid;
      rule = { kind: "custom", months: [...given.months] };
      break;
    default:
      return invalid;
  }
  const amounts = rule.kind === "custom" ? rule.months : [rule.amountCents];
  if (amounts.some((cents) => cents % 100 !== 0)) return { ok: false, error: "not_whole_euros" };
  if (rule.kind === "pattern" && (!base || total(base) === 0)) return { ok: false, error: "no_pattern" };
  return { ok: true, rule };
}

// The thousands apart with dots, or with spaces (the non-breaking ones too), the same all through; or no separator.
const WHOLE = /^([-−])?\s*(?:€\s*)?(\d{1,3}(?:\.\d{3})+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:,-|[.,](\d{1,2}))?$/;

/**
 * What is typed as an amount in whole euros ("1.153", "1 153", "1153", "-293", "1153,-"), in cents; "empty" for
 * nothing, "cents" when it has cents, "too_large" beyond ten million euros, "unreadable" for anything else.
 */
export function readWholeEuros(text: string): number | "empty" | "cents" | "too_large" | "unreadable" {
  const trimmed = text.trim();
  if (trimmed === "") return "empty";
  const match = WHOLE.exec(trimmed);
  if (!match) return "unreadable";
  if (match[3] !== undefined && Number(match[3]) !== 0) return "cents";
  const cents = Number(match[2]!.replace(/\D/g, "")) * 100;
  if (cents > MAX_BUDGET_CENTS) return "too_large";
  return match[1] ? 0 - cents || 0 : cents;
}

/** Whole euros with thousands dots and a minus, no euro sign: "1.153", "-293". */
export function formatWholeEuros(cents: number): string {
  const euros = roundEuros(cents / 100);
  const digits = String(Math.abs(euros)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return euros < 0 ? `-${digits}` : digits;
}
