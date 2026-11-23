import { ACCOUNTS } from "../../shared/accounts";
import { LEDGER_START, type EntryLine } from "../../shared/ledger-types";
import { businessDate, localTime } from "../../shared/time";
import { LedgerError, upsertSourced } from "./ledger";
import { deleteLedgerSettingStatement, getLedgerSetting, setLedgerSettingStatement } from "./ledger-settings";

export type Opening = {
  year: number;
  /** As the balance shows them: positive for an asset and for a liability, 1400 not included. */
  lines: { accountCode: string; amountCents: number }[];
  /** The equity as the balance shows it: positive when the assets exceed the liabilities. */
  equityCents: number;
  /** What e-Boekhouden shows, kept only to show the difference. */
  eBoekhoudenEquityCents: number | null;
  /** What the kassa says belonged in the kluisje at the end of the year before. */
  expectedCashCents: number;
  /** 0130 and 0135 are the totals of the toestellen pasted from e-Boekhouden, not typed (spec §9, §12). */
  fromAssetList: boolean;
};

const EQUITY = "1400";
const ASSET_COST = "0130";
const ASSET_WRITTEN_OFF = "0135";
const FROM_LIST = [ASSET_COST, ASSET_WRITTEN_OFF];
const kinds = new Map(ACCOUNTS.map((account) => [account.code, account.kind]));

/** Accounts shown the other way round: their balance is a credit. */
const isCreditSide = (code: string) => kinds.get(code) !== "asset" || code === "0135";

const equityKey = (year: number) => `ledger_opening_eb_equity_${year}`;
const firstYear = () => Number(LEDGER_START.slice(0, 4));

/** The last moment of a `YYYY-MM-DD` day in Amsterdam (23:59:59.999 local time), as a UTC ISO string. */
export function endOfDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  for (const offsetHours of [1, 2]) {
    const iso = new Date(Date.UTC(y!, m! - 1, d!, 23 - offsetHours, 59, 59, 999)).toISOString();
    if (businessDate(iso) === date && localTime(iso) === "23:59") return iso;
  }
  return new Date(Date.UTC(y!, m! - 1, d!, 22, 59, 59, 999)).toISOString();
}

/**
 * What the kassa says belonged in the kluisje at `atIso`: the `left_cents` of the last handover counted up to
 * then, plus the paid cash sales sold up to then that no handover counted up to then has closed. A sale that
 * arrived after a handover but was sold before it is not closed (handover_id is empty) and so counts after it.
 * Reversals are sales with a negative amount and count the same way.
 */
export async function expectedCashAt(db: D1Database, atIso: string): Promise<number> {
  return (await expectedCashStatement(db, atIso).first<{ cents: number }>())!.cents;
}

/** `expectedCashAt` as a statement, for a caller's batch; its one row has `cents`. */
export function expectedCashStatement(db: D1Database, atIso: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT COALESCE((SELECT left_cents FROM handovers WHERE counted_at <= ?1 ORDER BY counted_at DESC LIMIT 1), 0)
        + COALESCE((SELECT SUM(total_cents) FROM sales
            WHERE method = 'cash' AND status = 'paid' AND sold_at <= ?1
              AND (handover_id IS NULL OR handover_id NOT IN (SELECT id FROM handovers WHERE counted_at <= ?1))), 0) AS cents`,
    )
    .bind(atIso);
}

/**
 * 0130 and 0135 of the first year's opening as the balance shows them, from the toestellen pasted from
 * e-Boekhouden: their cost and what was written off up to 2026. Null while none were pasted.
 */
async function assetListTotals(db: D1Database, year: number): Promise<{ accountCode: string; amountCents: number }[] | null> {
  if (year !== firstYear()) return null;
  const row = await db
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cost_cents), 0) AS cost, COALESCE(SUM(opening_written_off_cents), 0) AS written_off FROM assets WHERE cost_cents IS NOT NULL")
    .first<{ n: number; cost: number; written_off: number }>();
  if (!row || row.n === 0) return null;
  return [
    { accountCode: ASSET_COST, amountCents: row.cost },
    { accountCode: ASSET_WRITTEN_OFF, amountCents: row.written_off },
  ].filter((line) => line.amountCents !== 0);
}

/** Equity as the balance shows it: the assets less 0135, the liabilities and any other equity. */
const equityOf = (lines: Opening["lines"]) => lines.reduce((sum, line) => sum + (isCreditSide(line.accountCode) ? -line.amountCents : line.amountCents), 0);

/** The opening entry of `year` (source "opening", ref = year, dated `${year}-01-01`), with 1400 worked out. */
export async function getOpening(db: D1Database, year: number, _now: Date): Promise<Opening> {
  const [entry, stored, expectedCashCents, fromList] = await Promise.all([
    db
      .prepare(
        `SELECT l.account_code, l.amount_cents FROM ledger_entries e JOIN ledger_lines l ON l.entry_id = e.id
         WHERE e.source = 'opening' AND e.source_ref = ?1 ORDER BY l.id`,
      )
      .bind(String(year))
      .all<{ account_code: string; amount_cents: number }>(),
    getLedgerSetting(db, equityKey(year)),
    expectedCashAt(db, endOfDay(`${year - 1}-12-31`)),
    assetListTotals(db, year),
  ]);
  let lines: Opening["lines"] = [];
  let equityCents = 0;
  for (const row of entry.results) {
    if (row.account_code === EQUITY) equityCents = -row.amount_cents;
    else lines.push({ accountCode: row.account_code, amountCents: isCreditSide(row.account_code) ? -row.amount_cents : row.amount_cents });
  }
  if (fromList) {
    // Pasting saves the entry again, so this is what it holds; taken from the list all the same, so the two never differ.
    lines = [...fromList, ...lines.filter((line) => !FROM_LIST.includes(line.accountCode))];
    equityCents = equityOf(lines);
  }
  const eBoekhoudenEquityCents = stored === null ? null : Number(stored);
  return { year, lines, equityCents, eBoekhoudenEquityCents, expectedCashCents, fromAssetList: fromList !== null };
}

/**
 * Types the opening balance of the first year (again): one entry, replaced each time, with 1400 as the balancing line.
 * Once toestellen are pasted from e-Boekhouden, 0130 and 0135 come from that list and what is typed for them is left out.
 */
export async function setOpening(
  db: D1Database,
  year: number,
  input: { lines: { accountCode: string; amountCents: number }[]; eBoekhoudenEquityCents: number | null },
  now: Date,
): Promise<Opening> {
  if (year !== firstYear()) throw new LedgerError("not_first_year", 409);
  const fromList = await assetListTotals(db, year);
  const typed = new Map<string, number>();
  for (const line of input.lines) {
    if (line.accountCode === EQUITY) throw new LedgerError("equity_computed", 400);
    const kind = kinds.get(line.accountCode);
    if (!kind) throw new LedgerError("account_unknown", 400);
    if (kind === "income" || kind === "expense") throw new LedgerError("not_balance_account", 400);
    if (!Number.isSafeInteger(line.amountCents)) throw new LedgerError("amount_invalid", 400);
    if (fromList && FROM_LIST.includes(line.accountCode)) continue;
    typed.set(line.accountCode, (typed.get(line.accountCode) ?? 0) + line.amountCents);
  }
  const lines: EntryLine[] = [];
  for (const [accountCode, cents] of [...(fromList ?? []).map((line) => [line.accountCode, line.amountCents] as const), ...typed]) {
    if (cents !== 0) lines.push({ accountCode, amountCents: isCreditSide(accountCode) ? -cents : cents, note: null, assetId: null });
  }
  const sum = lines.reduce((total, line) => total + line.amountCents, 0);
  if (sum !== 0) lines.push({ accountCode: EQUITY, amountCents: -sum, note: null, assetId: null });

  await upsertSourced(
    db,
    { date: `${year}-01-01`, description: `Beginbalans ${year}`, source: "opening", sourceRef: String(year), lines },
    now,
  );
  await (input.eBoekhoudenEquityCents === null
    ? deleteLedgerSettingStatement(db, equityKey(year))
    : setLedgerSettingStatement(db, equityKey(year), String(input.eBoekhoudenEquityCents), now)
  ).run();
  return getOpening(db, year, now);
}
