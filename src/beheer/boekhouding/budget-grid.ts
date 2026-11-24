// What the Begroting page, its editor and its Excel file share: the names of the months, how a rule and a source are
// said, and the grid of a year's budget with the totals of each group and the result.

import type { BudgetLine, BudgetRule, BudgetSource } from "../../../shared/budget";
import type { LedgerAccount } from "../../../shared/ledger-types";
import { formatEuroShort } from "../../../shared/money";
import { formatDateNl } from "../../../shared/time";

export const MONTH_NAMES = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
export const MONTH_SHORT = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
/** The months of a quarterly rule, by its first month (1, 2 or 3). */
export const QUARTER_MONTHS = ["jan, apr, jul, okt", "feb, mei, aug, nov", "mrt, jun, sep, dec"];

/** The heads of the month columns: like the house `head`, but as narrow as the numbers under them, and right-aligned. */
export const monthHead = "px-1 py-2 text-right text-sm font-semibold text-ink/70";

export const sumOf = (months: number[]): number => months.reduce((sum, cents) => sum + cents, 0);

/** How a rule lays the year over its months, in a few words. */
export function ruleText(rule: BudgetRule, baseYear: number | null): string {
  switch (rule.kind) {
    case "monthly":
      return `elke maand ${formatEuroShort(rule.amountCents)}`;
    case "quarterly":
      return `per kwartaal ${formatEuroShort(rule.amountCents)} (${QUARTER_MONTHS[rule.month - 1]})`;
    case "yearly":
      return `één keer, in ${MONTH_NAMES[rule.month - 1]}`;
    case "pattern":
      return baseYear === null ? "zoals het basisjaar" : `zoals ${baseYear}`;
    case "custom":
      return "eigen bedrag per maand";
  }
}

/** Where a year's proposal came from, in a sentence; null when it was not made from a proposal. */
export function sourceText(source: BudgetSource | null): string | null {
  if (source?.kind === "mutations" && source.from && source.to) {
    return `Voorstel uit de mutaties van e-Boekhouden, ${formatDateNl(source.from)} t/m ${formatDateNl(source.to)}.`;
  }
  if (source?.kind === "ledger" && source.baseYear !== null) {
    return `Voorstel uit de boekingen van ${source.baseYear}${source.to ? `, t/m ${formatDateNl(source.to)}` : ""}.`;
  }
  return null;
}

/**
 * Says which months a source left out, when it stops before December: what a rule per month or per quarter fills
 * in, and what one "like the base year" leaves empty.
 */
export function missingMonthsText(lastMonth: number, baseYear: number): string | null {
  if (lastMonth >= 12) return null;
  const like = `bij 'zoals ${baseYear}'`;
  if (lastMonth === 11) return `December zit er nog niet in. Regels per maand of per kwartaal vullen dat aan; ${like} blijft december leeg.`;
  const first = MONTH_NAMES[lastMonth]!;
  return `${first[0]!.toUpperCase()}${first.slice(1)} tot en met december zitten er nog niet in. Regels per maand of per kwartaal vullen dat aan; ${like} blijven die maanden leeg.`;
}

export type GridRow = { account: LedgerAccount; months: number[] };
/** `months` has the twelve months and then the year. */
export type Grid = { income: GridRow[]; costs: GridRow[]; incomeTotal: number[]; costsTotal: number[]; result: number[] };

const withYear = (months: number[]): number[] => [...months, sumOf(months)];
const add = (rows: GridRow[]): number[] => Array.from({ length: 13 }, (_, i) => rows.reduce((sum, row) => sum + row.months[i]!, 0));

/** The budget's lines on their accounts, grouped into income and costs, with the totals and the result (income − costs). */
export function budgetGrid(lines: BudgetLine[], accounts: LedgerAccount[]): Grid {
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const rows = lines.flatMap((line) => {
    const account = byCode.get(line.accountCode);
    return account ? [{ account, months: withYear(line.months) }] : [];
  });
  const income = rows.filter((row) => row.account.kind === "income");
  const costs = rows.filter((row) => row.account.kind === "expense");
  const incomeTotal = add(income);
  const costsTotal = add(costs);
  return { income, costs, incomeTotal, costsTotal, result: incomeTotal.map((cents, i) => cents - costsTotal[i]!) };
}
