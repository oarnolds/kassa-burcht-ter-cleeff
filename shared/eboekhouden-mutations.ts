// Reads the overview "Mutaties" e-Boekhouden exports as Excel (.xlsx), from the parts of the unzipped file (the caller
// unzips it; shared/xlsx-read.ts reads the sheet). Only parseEBoekhoudenMutations touches DOMParser, so the Worker
// typecheck can include this file. Amounts are integer cents. The budget's proposal is made from it
// (shared/mutation-base.ts).

import { firstSheet, grid, textOf, type Value } from "./xlsx-read";

/**
 * One mutation as the export lists it. `amountCents` is the mutation's total (e-Boekhouden writes it positive);
 * `account` is the money side (1010, or 1300 for an invoice); `contra` the code of every line of the mutation.
 */
export type EbMutation = {
  nr: number;
  /** `YYYY-MM-DD`. */
  date: string;
  /** e-Boekhouden's "Soort": Geld uit, Geld ontv, Fact verst, Factbet ontv, Memoriaal, … */
  kind: string;
  amountCents: number;
  account: string;
  contra: string[];
  invoice: string;
  document: string;
};
/** The mutations of one calendar year: `from` and `to` are its first and last date. */
export type EbMutations = { year: number; from: string; to: string; rows: EbMutation[] };

/** The message is "not_eboekhouden_mutations" or "not_one_year". */
export class EbMutationsError extends Error {
  constructor(code: "not_eboekhouden_mutations" | "not_one_year") {
    super(code);
    this.name = "EbMutationsError";
  }
}

const TITLE = /^mutaties\s*\(\d+\)$/i;
const REQUIRED = ["nr", "datum", "soort", "bedrag", "rekening", "tegenrekening"] as const;
const OPTIONAL = ["factuur", "boekstuk"] as const;
type Column = (typeof REQUIRED)[number] | (typeof OPTIONAL)[number];

/** Excel's day 0: day number 1 is 1 January 1900, and 46023 is 1 January 2026. */
const EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

function refuse(): never {
  throw new EbMutationsError("not_eboekhouden_mutations");
}

const empty = (value: Value | undefined) => value === undefined || (typeof value === "string" && value.trim() === "");

/** A real day, or null. */
function day(year: number, month: number, date: number): string | null {
  const moment = new Date(Date.UTC(year, month - 1, date));
  if (moment.getUTCFullYear() !== year || moment.getUTCMonth() !== month - 1 || moment.getUTCDate() !== date) return null;
  return moment.toISOString().slice(0, 10);
}

/** A date cell: Excel's day number (a time of day left out), or text `dd-mm-jjjj`. */
function dateOf(value: Value | undefined): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 1 || value > 2_958_465) return refuse();
    return new Date(EPOCH + Math.floor(value) * DAY_MS).toISOString().slice(0, 10);
  }
  const text = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(textOf(value));
  return (text && day(Number(text[3]), Number(text[2]), Number(text[1]))) ?? refuse();
}

/** An amount cell in whole cents; it must hold a number. */
function centsOf(value: Value | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return refuse();
  return Math.round(value * 100) || 0;
}

/** The number of a mutation: a number, or digits as text. */
function nrOf(value: Value | undefined): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  const text = textOf(value);
  return /^\d{1,15}$/.test(text) ? Number(text) : refuse();
}

/**
 * The mutations of one year, as e-Boekhouden exports the overview "Mutaties" to Excel: the title "Mutaties (n)",
 * the header "Nr | Datum | Soort | Bedrag | Rekening | Tegenrekening | Factuur | Boekstuk", then a row per mutation.
 */
export function parseEBoekhoudenMutations(files: Record<string, Uint8Array>): EbMutations {
  const rows = grid(firstSheet(files) ?? refuse());
  if (!rows.some((row) => [...row.values()].some((value) => typeof value === "string" && TITLE.test(value.trim())))) refuse();

  // The header says which column holds what; Factuur and Boekstuk may be missing.
  const headerAt = rows.findIndex((row) => {
    const names = [...row.values()].map((value) => textOf(value).toLowerCase());
    return REQUIRED.every((name) => names.includes(name));
  });
  if (headerAt < 0) refuse();
  const columns = new Map<Column, number>();
  for (const [column, value] of rows[headerAt]!) {
    const name = textOf(value).toLowerCase() as Column;
    if (([...REQUIRED, ...OPTIONAL] as string[]).includes(name) && !columns.has(name)) columns.set(name, column);
  }
  const cell = (row: Map<number, Value>, name: Column) => {
    const column = columns.get(name);
    return column === undefined ? undefined : row.get(column);
  };

  const mutations: EbMutation[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    // A row without a number, a date and an amount is not a mutation: an empty line, or a note under the list.
    if (empty(cell(row, "nr")) && empty(cell(row, "datum")) && empty(cell(row, "bedrag"))) continue;
    mutations.push({
      nr: nrOf(cell(row, "nr")),
      date: dateOf(cell(row, "datum")),
      kind: textOf(cell(row, "soort")),
      amountCents: centsOf(cell(row, "bedrag")),
      account: textOf(cell(row, "rekening")),
      contra: textOf(cell(row, "tegenrekening"))
        .split(",")
        .map((code) => code.trim())
        .filter((code) => code !== ""),
      invoice: textOf(cell(row, "factuur")),
      document: textOf(cell(row, "boekstuk")),
    });
  }

  const dates = mutations.map((mutation) => mutation.date).sort();
  const from = dates[0];
  const to = dates.at(-1);
  if (from === undefined || to === undefined || from.slice(0, 4) !== to.slice(0, 4)) throw new EbMutationsError("not_one_year");
  return { year: Number(from.slice(0, 4)), from, to, rows: mutations };
}
