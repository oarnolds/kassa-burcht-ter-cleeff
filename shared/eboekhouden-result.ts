// Reads the winst-en-verliesrekening e-Boekhouden exports as Excel (.xlsx), from the parts of the unzipped file
// (the caller unzips it; shared/xlsx-read.ts reads the sheet). Only parseEBoekhoudenResult touches DOMParser, so the
// Worker typecheck can include this file. Amounts are integer cents.

import type { LedgerAccount } from "./ledger-types";
import { firstSheet, grid, textOf, type Value } from "./xlsx-read";

/** One row of the export: the old account code and name, the amount under "Verlies" (debit) and under "Winst" (credit). */
export type EbRow = { code: string; name: string; debitCents: number; creditCents: number };
/** `saldo`: e-Boekhouden's own balancing total ("Saldo winst" or "Saldo verlies"), as its cell shows it. */
export type EbResult = { year: number; rows: EbRow[]; saldo: { label: string; cents: number } | null };
/**
 * A row no account of the app takes. `kind` is guessed from the first digit (4 costs, 8 income). `amountCents` is
 * as the report shows such an account: debit − credit for costs; credit − debit otherwise (for an unknown kind:
 * what it adds to the result).
 */
export type EbUnplaced = { code: string; name: string; amountCents: number; kind: "income" | "expense" | null };
export type EbMapped = { figures: { accountCode: string; amountCents: number }[]; unplaced: EbUnplaced[] };

/** The message is "not_eboekhouden_result" or "not_whole_year". */
export class EbResultError extends Error {
  constructor(code: "not_eboekhouden_result" | "not_whole_year") {
    super(code);
    this.name = "EbResultError";
  }
}

const TITLE = /winst\s*&\s*verlies\s+(\d{1,2})-(\d{1,2})-(\d{4})\s+t\/m\s+(\d{1,2})-(\d{1,2})-(\d{4})/i;
const SALDO = /^saldo\s+(winst|verlies)$/i;

function refuse(): never {
  throw new EbResultError("not_eboekhouden_result");
}

/** An amount cell in cents: empty is 0, a number is rounded to whole cents, anything else cannot be read. */
function centsOf(value: Value | undefined): number {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) return refuse();
  return Math.round(value * 100) || 0;
}

/** The winst-en-verliesrekening of one whole year, as e-Boekhouden exports it to Excel. */
export function parseEBoekhoudenResult(files: Record<string, Uint8Array>): EbResult {
  const rows = grid(firstSheet(files) ?? refuse());

  // The period, in the title: "Winst & verlies 01-01-2025 t/m 31-12-2025 (38)".
  const title = rows.flatMap((row) => [...row.values()]).find((value): value is string => typeof value === "string" && TITLE.test(value));
  const period = title === undefined ? refuse() : TITLE.exec(title)!;
  const [, fromDay, fromMonth, fromYear, toDay, toMonth, toYear] = period.map(Number) as number[];
  if (fromDay !== 1 || fromMonth !== 1 || toDay !== 31 || toMonth !== 12 || fromYear !== toYear) throw new EbResultError("not_whole_year");

  // The header "Code | Omschrijving | Verlies | Winst" says which column holds what.
  const headerAt = rows.findIndex((row) => {
    const names = [...row.values()].map((value) => textOf(value).toLowerCase());
    return ["code", "omschrijving", "verlies", "winst"].every((name) => names.includes(name));
  });
  if (headerAt < 0) refuse();
  const columnNamed = (name: string) => [...rows[headerAt]!].find(([, value]) => textOf(value).toLowerCase() === name)![0];
  const [code, name, debit, credit] = ["code", "omschrijving", "verlies", "winst"].map(columnNamed) as [number, number, number, number];

  const result: EbResult = { year: fromYear!, rows: [], saldo: null };
  for (const row of rows.slice(headerAt + 1)) {
    const rowCode = textOf(row.get(code));
    const rowName = textOf(row.get(name));
    const debitCents = centsOf(row.get(debit));
    const creditCents = centsOf(row.get(credit));
    if (rowCode !== "") result.rows.push({ code: rowCode, name: rowName, debitCents, creditCents });
    else if (SALDO.test(rowName)) result.saldo = { label: rowName, cents: debitCents !== 0 ? debitCents : creditCents };
  }
  return result;
}

/**
 * The figures per account of the app, as the result report shows them (costs and income both positive): each old
 * code goes to the income or expense account whose own code or `formerly` holds it, and several old codes on one
 * account are added up. What no account takes (9999 Eindresultaat, a code that was dropped) comes back apart.
 */
export function mapToAccounts(result: EbResult, accounts: LedgerAccount[]): EbMapped {
  const resultAccounts = accounts.filter((account) => account.kind === "income" || account.kind === "expense");
  const owner = new Map<string, LedgerAccount>();
  for (const account of resultAccounts) owner.set(account.code, account);
  for (const account of resultAccounts) for (const old of account.formerly) if (!owner.has(old)) owner.set(old, account);

  const sums = new Map<string, number>();
  const unplaced: EbUnplaced[] = [];
  for (const row of result.rows) {
    const account = owner.get(row.code);
    const kind = account ? account.kind : row.code.startsWith("4") ? "expense" : row.code.startsWith("8") ? "income" : null;
    const cents = kind === "expense" ? row.debitCents - row.creditCents : row.creditCents - row.debitCents;
    if (account) sums.set(account.code, (sums.get(account.code) ?? 0) + cents);
    else unplaced.push({ code: row.code, name: row.name, amountCents: cents, kind: kind as EbUnplaced["kind"] });
  }
  return {
    figures: resultAccounts.filter((account) => sums.has(account.code)).map((account) => ({ accountCode: account.code, amountCents: sums.get(account.code)! })),
    unplaced,
  };
}
