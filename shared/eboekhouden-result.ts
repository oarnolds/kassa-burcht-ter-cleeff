// Reads the winst-en-verliesrekening e-Boekhouden exports as Excel (.xlsx), from the parts of the unzipped file
// (the caller unzips it). Only parseEBoekhoudenResult touches DOMParser, so the Worker typecheck can include this
// file. Amounts are integer cents.

import type { LedgerAccount } from "./ledger-types";

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

// The Worker typecheck has no DOM library, so the few DOM members used here are described by hand.
type El = {
  localName: string;
  textContent: string | null;
  parentElement: El | null;
  children: ArrayLike<El>;
  getAttribute(name: string): string | null;
  getAttributeNS(ns: string, name: string): string | null;
  getElementsByTagNameNS(ns: string, name: string): ArrayLike<El>;
};
type XmlDoc = { documentElement: El | null; getElementsByTagName(name: string): ArrayLike<unknown> };

const RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const TITLE = /winst\s*&\s*verlies\s+(\d{1,2})-(\d{1,2})-(\d{4})\s+t\/m\s+(\d{1,2})-(\d{1,2})-(\d{4})/i;
const SALDO = /^saldo\s+(winst|verlies)$/i;

function refuse(): never {
  throw new EbResultError("not_eboekhouden_result");
}

/** The root element of an XML part, or null when the part is missing or not XML. */
function part(files: Record<string, Uint8Array>, path: string): El | null {
  const bytes = files[path];
  if (!bytes) return null;
  const Parser = (globalThis as unknown as { DOMParser: new () => { parseFromString(s: string, type: string): XmlDoc } }).DOMParser;
  const doc = new Parser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  return doc.documentElement;
}

const all = (el: El, name: string): El[] => Array.from(el.getElementsByTagNameNS("*", name));
const childrenNamed = (el: El, name: string): El[] => Array.from(el.children).filter((child) => child.localName === name);

/** The text of a string item (`si` or `is`): its runs joined, the phonetic hints (`rPh`) left out. */
const runsOf = (el: El): string =>
  all(el, "t")
    .filter((t) => t.parentElement?.localName !== "rPh")
    .map((t) => t.textContent ?? "")
    .join("");

/** `worksheets/sheet1.xml` from `xl/workbook.xml` lies at `xl/worksheets/sheet1.xml`; `/xl/…` is from the root. */
const resolve = (target: string): string => (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);

/** Column A is 0, B is 1, …; null without letters. */
function columnOf(ref: string | null): number | null {
  const letters = ref === null ? null : /^([A-Z]+)/i.exec(ref);
  if (!letters) return null;
  let index = 0;
  for (const letter of letters[1]!.toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

type Value = string | number;

/** What a cell holds: text, or the number it stores. Formulas, errors and booleans are left out. */
function valueOf(cell: El, strings: string[]): Value | null {
  if (childrenNamed(cell, "f").length > 0) return null;
  const v = childrenNamed(cell, "v")[0]?.textContent ?? null;
  switch (cell.getAttribute("t")) {
    case "s":
      return v === null ? null : (strings[Number(v)] ?? null);
    case "inlineStr": {
      const is = childrenNamed(cell, "is")[0];
      return is ? runsOf(is) : null;
    }
    case "str":
      return v;
    case "b":
    case "e":
      return null;
    default:
      return v === null || v.trim() === "" ? null : Number(v);
  }
}

/** The sheet as rows of cells by column, in the order of the sheet. */
function grid(sheet: El, strings: string[]): Map<number, Value>[] {
  const rows: Map<number, Value>[] = [];
  for (const row of all(sheet, "row")) {
    const cells = new Map<number, Value>();
    let column = -1;
    for (const cell of childrenNamed(row, "c")) {
      column = columnOf(cell.getAttribute("r")) ?? column + 1;
      const value = valueOf(cell, strings);
      if (value !== null) cells.set(column, value);
    }
    rows.push(cells);
  }
  return rows;
}

const textOf = (value: Value | undefined): string => (value === undefined ? "" : String(value).trim());

/** An amount cell in cents: empty is 0, a number is rounded to whole cents, anything else cannot be read. */
function centsOf(value: Value | undefined): number {
  if (value === undefined || (typeof value === "string" && value.trim() === "")) return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) return refuse();
  return Math.round(value * 100) || 0;
}

/** The first sheet of the workbook, through the workbook's relationships. */
function firstSheet(files: Record<string, Uint8Array>): { sheet: El; strings: string[] } {
  const workbook = part(files, "xl/workbook.xml") ?? refuse();
  const rels = part(files, "xl/_rels/workbook.xml.rels") ?? refuse();
  const first = all(workbook, "sheet")[0] ?? refuse();
  const id = first.getAttributeNS(RELATIONSHIPS, "id") ?? first.getAttribute("r:id");
  const relations = all(rels, "Relationship");
  const target = relations.find((relation) => relation.getAttribute("Id") === id)?.getAttribute("Target") ?? refuse();
  const sheet = part(files, resolve(target)) ?? refuse();
  const sharedTarget = relations.find((relation) => (relation.getAttribute("Type") ?? "").endsWith("/sharedStrings"))?.getAttribute("Target");
  const shared = part(files, sharedTarget ? resolve(sharedTarget) : "xl/sharedStrings.xml");
  return { sheet, strings: shared ? all(shared, "si").map(runsOf) : [] };
}

/** The winst-en-verliesrekening of one whole year, as e-Boekhouden exports it to Excel. */
export function parseEBoekhoudenResult(files: Record<string, Uint8Array>): EbResult {
  const { sheet, strings } = firstSheet(files);
  const rows = grid(sheet, strings);

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
