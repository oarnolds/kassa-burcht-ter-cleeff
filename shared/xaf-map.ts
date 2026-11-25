// Lays e-Boekhouden's auditfile of 2026 onto the app's accounts (spec §7, §9): the opening of 1 January, the
// bookings up to the overstap, and what does not fit. Nothing is saved here; the page shows it before "Overnemen".

import { type LedgerAccount, OVERSTAP, PAYOUT_REFERENCE } from "./ledger-types";
import type { XafFile, XafTransaction } from "./xaf";

export type ImportedEntry = { ref: string; date: string; description: string; lines: { accountCode: string; amountCents: number; note: string | null }[] };
export type XafPlan = {
  year: number;
  createdOn: string;
  /** Debit +, credit −; no 1400, no zero lines, merged per new account. */
  opening: { accountCode: string; amountCents: number }[];
  /** e-Boekhouden's 1400 as the balance shows it (credit → positive). */
  ebEquityCents: number;
  /** Dated before OVERSTAP, in date order, then journal, then nr. */
  entries: ImportedEntry[];
  /** Transactions dated on or after OVERSTAP. */
  skippedFromOverstap: number;
  /** Nothing left after merging (e.g. 0800 → 0135). */
  fallenAway: { ref: string; date: string; description: string }[];
  /** Every old account that occurs, with where it goes. */
  mapping: { from: string; name: string; to: string | null }[];
  /** Needs a choice before "Overnemen". */
  unplaced: { code: string; name: string }[];
  /** A line left on 0130, 0135 or 4601: blocks "Overnemen". */
  assetLines: { ref: string; date: string; description: string }[];
  /** 8011/8012 on or after kassaSince: a warning. */
  kassaLines: { ref: string; date: string; description: string }[];
  /** PAYOUT_REFERENCE matches in transactions with a 1010 line. */
  payouts: string[];
  /** 1000, 1010, 1011, 1020, 1021, 1080, 1300, 1700 at the end of 24-11 (opening + entries). */
  atSwitch: { accountCode: string; cents: number }[];
};

/** Old accounts with a fixed place: the reserve for new toestellen joins their depreciation, Revolut runs through Kruisposten. */
const FIXED: Record<string, string> = { "0800": "0135", "1012": "1080" };
/** Old accounts without a place, allowed only while all their amounts are 0. */
const ONLY_ZERO = new Set(["0801", "9998"]);
/** Not taken from the file's opening: 1400 is computed, 0130 and 0135 come from the toestellen list, Mollie starts at 0. */
const NOT_IN_OPENING = new Set(["1400", "0130", "0135", "1030"]);
const EQUITY = "1400";
const ASSET_ACCOUNTS = new Set(["0130", "0135", "4601"]);
const KASSA_ACCOUNTS = new Set(["8011", "8012"]);
const BANK = "1010";
const AT_SWITCH = ["1000", "1010", "1011", "1020", "1021", "1080", "1300", "1700"];

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const compareNr = (a: string, b: string) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : compareText(a, b));
const byDateJournalNr = (a: XafTransaction, b: XafTransaction) =>
  compareText(a.date, b.date) || compareText(a.journal, b.journal) || compareNr(a.nr, b.nr);

function payoutReferences(t: XafTransaction): string[] {
  const all = new RegExp(PAYOUT_REFERENCE.source, "g");
  return [t.description, ...t.lines.map((l) => l.description)].flatMap((text) => [...text.matchAll(all)].map((m) => m[0]));
}

export function mapXaf(file: XafFile, accounts: LedgerAccount[], options: { kassaSince: string | null; choices: Record<string, string> }): XafPlan {
  const known = new Set(accounts.map((a) => a.code));
  const order = new Map(accounts.map((a, i) => [a.code, i]));
  const formerly = new Map<string, string>();
  for (const account of accounts) for (const old of account.formerly) if (!formerly.has(old)) formerly.set(old, account.code);
  const choice = (old: string) => {
    const to = options.choices[old];
    return to !== undefined && known.has(to) ? to : null;
  };
  const place = (old: string): string | null => FIXED[old] ?? formerly.get(old) ?? choice(old);

  // The opening per new account; an old account without a place stays out (it is unplaced).
  const opening = new Map<string, number>();
  for (const line of file.opening) {
    const to = place(line.accountId);
    if (to !== null) opening.set(to, (opening.get(to) ?? 0) + line.amountCents);
  }

  const imported = file.transactions.filter((t) => t.date < OVERSTAP).sort(byDateJournalNr);
  const entries: ImportedEntry[] = [];
  const fallenAway: XafPlan["fallenAway"] = [];
  const assetLines: XafPlan["assetLines"] = [];
  const kassaLines: XafPlan["kassaLines"] = [];
  const payouts = new Set<string>();
  const balances = new Map(AT_SWITCH.map((code) => [code, opening.get(code) ?? 0]));

  for (const t of imported) {
    // A line on an unplaced account keeps its old code: "Overnemen" waits until every account has a place.
    const merged = new Map<string, { cents: number; notes: string[] }>();
    for (const line of t.lines) {
      const code = place(line.accountId) ?? line.accountId;
      const sum = merged.get(code) ?? { cents: 0, notes: [] };
      sum.cents += line.amountCents;
      if (line.description && line.description !== t.description && !sum.notes.includes(line.description)) sum.notes.push(line.description);
      merged.set(code, sum);
    }
    const lines = [...merged]
      .filter(([, sum]) => sum.cents !== 0)
      .map(([accountCode, sum]) => ({ accountCode, amountCents: sum.cents, note: sum.notes.length > 0 ? sum.notes.join("; ") : null }));
    const summary = { ref: `${t.journal}:${t.nr}`, date: t.date, description: t.description };
    if (lines.length === 0) {
      fallenAway.push(summary);
      continue;
    }

    entries.push({ ...summary, lines });
    if (lines.some((l) => ASSET_ACCOUNTS.has(l.accountCode))) assetLines.push(summary);
    if (options.kassaSince !== null && t.date >= options.kassaSince && lines.some((l) => KASSA_ACCOUNTS.has(l.accountCode))) kassaLines.push(summary);
    if (lines.some((l) => l.accountCode === BANK)) for (const ref of payoutReferences(t)) payouts.add(ref);
    for (const l of lines) if (balances.has(l.accountCode)) balances.set(l.accountCode, balances.get(l.accountCode)! + l.amountCents);
  }

  // Every old account that needs a place: a non-zero opening, or a line in a booking that comes in. 0801 and 9998
  // need one only when they carry an amount.
  const names = new Map(file.accounts.map((a) => [a.id, a.name]));
  const used = new Set<string>();
  for (const line of file.opening) if (line.amountCents !== 0) used.add(line.accountId);
  for (const t of imported) for (const line of t.lines) if (line.amountCents !== 0 || !ONLY_ZERO.has(line.accountId)) used.add(line.accountId);
  const mapping = [...used].sort(compareText).map((from) => ({ from, name: names.get(from) ?? "", to: place(from) }));

  return {
    year: file.year,
    createdOn: file.createdOn,
    opening: [...opening]
      .filter(([code, cents]) => cents !== 0 && !NOT_IN_OPENING.has(code))
      .sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity) || compareText(a, b))
      .map(([accountCode, amountCents]) => ({ accountCode, amountCents })),
    ebEquityCents: 0 - (opening.get(EQUITY) ?? 0),
    entries,
    skippedFromOverstap: file.transactions.length - imported.length,
    fallenAway,
    mapping,
    unplaced: mapping.filter((m) => m.to === null).map((m) => ({ code: m.from, name: m.name })),
    assetLines,
    kassaLines,
    payouts: [...payouts],
    atSwitch: AT_SWITCH.map((accountCode) => ({ accountCode, cents: balances.get(accountCode)! })),
  };
}
