// What a year of e-Boekhouden's mutations comes to per account of the app and per month: the base the budget's
// proposal is made from. Pure, so the page can work it out again whenever a choice changes; the reader of the file
// itself (shared/eboekhouden-mutations.ts) only comes along when a file is chosen. Amounts are integer cents, as the
// result report shows them: income credit positive, costs debit positive.

import type { EbMutation, EbMutations } from "./eboekhouden-mutations";
import type { AccountKind, LedgerAccount } from "./ledger-types";

/**
 * The penningmeester's choices. `combined`: per group (by its key) the account it goes on. `unplaced`: per code no
 * account has, the account it goes on, or null for "Niet meenemen".
 */
export type MutationChoices = { combined: Record<string, string>; unplaced: Record<string, string | null> };

/** Mutations whose lines were on several accounts: e-Boekhouden gives only their total, so they stay together. */
export type CombinedGroup = { key: string; accounts: string[]; count: number; amountCents: number; chosen: string };
/** A code no account has. `kind` is guessed from its first digit (4 costs, 8 income); `chosen` null: not counted. */
export type UnplacedCode = { code: string; count: number; amountCents: number; kind: "income" | "expense" | null; chosen: string | null };
/** A mutation with a result code that is not counted: a Memoriaal, or a Soort the app does not know. */
export type SkippedMutation = { nr: number; date: string; kind: string; amountCents: number; account: string; contra: string[] };

export type MutationBase = {
  year: number;
  from: string;
  to: string;
  /** How many mutations were read. */
  count: number;
  /** Per account (in the order of the chart) what it comes to in each month, January first. */
  months: { accountCode: string; cents: number[] }[];
  combined: CombinedGroup[];
  unplaced: UnplacedCode[];
  skipped: SkippedMutation[];
};

/** The Soorts that credit the Tegenrekening (money or an invoice in), and those that debit it. */
const CREDIT = new Set(["geld ontv", "fact verst", "factbet ontv"]);
const DEBIT = new Set(["geld uit", "fact ontv", "factbet verst"]);

type ResultAccount = LedgerAccount & { kind: "income" | "expense" };
const isResult = (account: LedgerAccount | undefined): account is ResultAccount => account?.kind === "income" || account?.kind === "expense";

/** As the report shows an account: income credit positive, costs debit positive. `effect` is credit positive. */
const shown = (kind: AccountKind | null, effect: number) => (kind === "expense" ? 0 - effect : effect);

/**
 * The year's mutations per account and month. Only lines on result codes count: a code of an income or expense
 * account (its own or one it took over), or an unknown code from 4 to 9. A mutation with only balance codes against
 * it is a transfer between own accounts or a balance booking, and is left out without a word.
 */
export function mutationBase(mutations: EbMutations, accounts: LedgerAccount[], choices: MutationChoices): MutationBase {
  const order = new Map(accounts.map((account, i) => [account.code, i]));
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const owner = new Map<string, ResultAccount>();
  for (const account of accounts) if (isResult(account)) owner.set(account.code, account);
  for (const account of accounts) if (isResult(account)) for (const old of account.formerly) if (!owner.has(old)) owner.set(old, account);
  const isResultCode = (code: string) => owner.has(code) || /^[4-9]/.test(code);

  const months = new Map<string, number[]>();
  const add = (account: LedgerAccount, date: string, effect: number) => {
    const cents = months.get(account.code) ?? Array<number>(12).fill(0);
    cents[Number(date.slice(5, 7)) - 1]! += shown(account.kind, effect);
    months.set(account.code, cents);
  };

  const groups = new Map<string, { accounts: ResultAccount[]; rows: { date: string; effect: number }[] }>();
  const unknown = new Map<string, { date: string; effect: number }[]>();
  const skipped: SkippedMutation[] = [];

  for (const row of mutations.rows) {
    const kind = row.kind.trim().toLowerCase();
    const known = CREDIT.has(kind) || DEBIT.has(kind);
    // Without a known Soort the money side may be a result code as well (a Memoriaal from 4601 to 0135).
    const codes = known ? row.contra : [row.account, ...row.contra];
    const resultCodes = codes.filter(isResultCode);
    if (resultCodes.length === 0) continue;
    if (!known) {
      skipped.push(skippedOf(row));
      continue;
    }
    const effect = CREDIT.has(kind) ? row.amountCents : 0 - row.amountCents;
    const onAccounts = [...new Set(resultCodes.map((code) => owner.get(code)).filter(isResult))].sort((a, b) => order.get(a.code)! - order.get(b.code)!);
    if (onAccounts.length === 1) add(onAccounts[0]!, row.date, effect);
    else if (onAccounts.length > 1) {
      const key = onAccounts
        .map((account) => account.code)
        .sort()
        .join("+");
      const group = groups.get(key) ?? { accounts: onAccounts, rows: [] };
      group.rows.push({ date: row.date, effect });
      groups.set(key, group);
    } else {
      const code = [...new Set(resultCodes)].sort().join(",");
      unknown.set(code, [...(unknown.get(code) ?? []), { date: row.date, effect }]);
    }
  }

  const combined: CombinedGroup[] = [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => {
      const net = group.rows.reduce((sum, row) => sum + row.effect, 0);
      const fits = group.accounts.find((account) => account.kind === (net >= 0 ? "income" : "expense"));
      const chosen = group.accounts.find((account) => account.code === choices.combined[key]) ?? fits ?? group.accounts[0]!;
      for (const row of group.rows) add(chosen, row.date, row.effect);
      return { key, accounts: group.accounts.map((account) => account.code), count: group.rows.length, amountCents: shown(chosen.kind, net), chosen: chosen.code };
    });

  const unplaced: UnplacedCode[] = [...unknown]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, rows]) => {
      const net = rows.reduce((sum, row) => sum + row.effect, 0);
      const kind = code.startsWith("4") ? "expense" : code.startsWith("8") ? "income" : null;
      const target = byCode.get(choices.unplaced[code] ?? "");
      const chosen = isResult(target) ? target : null;
      if (chosen) for (const row of rows) add(chosen, row.date, row.effect);
      return { code, count: rows.length, amountCents: shown(kind, net), kind, chosen: chosen?.code ?? null };
    });

  return {
    year: mutations.year,
    from: mutations.from,
    to: mutations.to,
    count: mutations.rows.length,
    months: accounts.filter((account) => months.has(account.code)).map((account) => ({ accountCode: account.code, cents: months.get(account.code)! })),
    combined,
    unplaced,
    skipped,
  };
}

function skippedOf(row: EbMutation): SkippedMutation {
  return { nr: row.nr, date: row.date, kind: row.kind, amountCents: row.amountCents, account: row.account, contra: row.contra };
}
