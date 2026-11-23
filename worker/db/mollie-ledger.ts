// Mollie's payments on 1030. A payment of a kassa pin sale is in its kassa day already and is only ticked off here.
// The payments of the website and the QR code are booked per day by the penningmeester's rules, in one entry
// "Mollie overig {datum}"; one that fits no rule, and every refund or chargeback of such a payment, waits on 1030 in
// Te boeken. A day in a closed year stays as it is: what arrives for it later is booked on 1 January of the first
// open year. Mollie is read only through worker/lib/mollie-read.ts; nothing it says goes into a log line.

import type { CamtLine } from "../../shared/camt";
import { type AccountKind, LEDGER_START, type MollieRule } from "../../shared/ledger-types";
import { businessDate, shiftDate } from "../../shared/time";
import type { Env } from "../env";
import { type MollieChargebackRow, type MolliePaymentRow, mollieReadFor, type MollieRefundRow } from "../lib/mollie-read";
import { autoBook, importLines, recordBalance } from "./bank";
import { add, type Amounts, dayMonthYear, minus, sameAmounts, toLines } from "./kassa-ledger";
import { firstOpenYear, LedgerError, type NewEntry, upsertSourcedStatements } from "./ledger";
import { endOfDay } from "./opening";

export type { MollieRule };

const MOLLIE = "1030";
const SOURCE = "mollie_other";
/** A run reads from this many days before the newest payment it has, to catch one Mollie lists late. */
const LOOK_BACK_DAYS = 3;
/** Day entries written per database call. */
const PER_BATCH = 20;

type Kind = "kassa" | "rule" | "line";
type Paid = MolliePaymentRow & { paidAt: string; paidDate: string };
type Booked = { id: string; year: number; amounts: Amounts };
/** A day entry to write: its date, the entry already there, and its content once the first open year is known. */
type Work = { date: string; existing: { id: string } | null; entry: (openYear: number) => NewEntry & { sourceRef: string } };

const yearOf = (date: string) => Number(date.slice(0, 4));
/** The first moment of an Amsterdam day, as a UTC ISO string. */
const startOfDay = (date: string) => new Date(Date.parse(endOfDay(shiftDate(date, -1))) + 1).toISOString();
const byMoment = (a: { at: string; id: string }, b: { at: string; id: string }) =>
  Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const kassaPayments = (db: D1Database, ids: string) =>
  db.prepare("SELECT mollie_payment_id AS id FROM sales WHERE mollie_payment_id IN (SELECT value FROM json_each(?1))").bind(ids);

/**
 * Nightly: Mollie's paid payments, refunds and chargebacks since a few days before the newest payment kept (or since
 * LEDGER_START), then Mollie's balance as that of 1030 at the end of yesterday. A failure of Mollie gives its name
 * ("unauthorized", "refused", "not_found", "unreachable"), a refusal of the ledger its code.
 */
export async function syncMolliePayments(env: Env, now: Date): Promise<"ok" | "skipped" | string> {
  const client = mollieReadFor(env);
  if (!client) return "skipped";
  const failed = (code: string) => {
    console.error("mollie step failed", code);
    return code;
  };
  const db = env.DB;
  try {
    const newest = await db.prepare("SELECT MAX(paid_date) AS date FROM mollie_payments").first<{ date: string | null }>();
    const back = newest?.date ? shiftDate(newest.date, -LOOK_BACK_DAYS) : LEDGER_START;
    const from = startOfDay(back < LEDGER_START ? LEDGER_START : back);

    const payments = await client.paymentsSince(from);
    if (!payments.ok) return failed(payments.failure);
    // A paid payment without a moment that can be read is not guessed at: the run fails as the reader does.
    if (payments.data.some((row) => row.status === "paid" && row.paidAt !== null && Number.isNaN(Date.parse(row.paidAt)))) return failed("unreachable");
    await storePayments(db, payments.data, now);

    const refunds = await client.refundsSince(from);
    if (!refunds.ok) return failed(refunds.failure);
    const chargebacks = await client.chargebacksSince(from);
    if (!chargebacks.ok) return failed(chargebacks.failure);
    await storeReversals(db, refunds.data, chargebacks.data, now);

    const balance = await client.primaryBalance();
    if (!balance.ok) return failed(balance.failure);
    const yesterday = shiftDate(businessDate(now.toISOString()), -1);
    await recordBalance(db, MOLLIE, { date: yesterday, cents: balance.data.availableCents + balance.data.pendingCents }, "mollie");
    await autoBook(db, now);
    return "ok";
  } catch (error) {
    if (error instanceof LedgerError) return failed(error.code);
    throw error;
  }
}

/**
 * Keeps each paid payment once, classified when it is first stored: `kassa` when a sale of the kassa has it, else
 * `rule` by the first rule whose keyword is in its description, else `line`. Then, for every day the payments read
 * fall on, the day entry is made equal to the rule payments of that day, and the `line` payments of those days are
 * read onto 1030. In a few database calls, however many payments.
 */
async function storePayments(db: D1Database, rows: MolliePaymentRow[], now: Date): Promise<void> {
  const paid: Paid[] = rows
    .flatMap((row) => (row.status === "paid" && row.paidAt !== null ? [{ ...row, paidAt: row.paidAt, paidDate: businessDate(row.paidAt) }] : []))
    .filter((row) => row.paidDate >= LEDGER_START)
    .sort((a, b) => byMoment({ at: a.paidAt, id: a.id }, { at: b.paidAt, id: b.id }));
  if (paid.length === 0) return;
  const ids = JSON.stringify(paid.map((row) => row.id));
  const dateList = [...new Set(paid.map((row) => row.paidDate))].sort();
  const dates = JSON.stringify(dateList);

  const [ruleRows, kassaRows] = await db.batch([db.prepare("SELECT keyword, account_code FROM mollie_rules ORDER BY sort, id"), kassaPayments(db, ids)]);
  const rules = (ruleRows!.results as { keyword: string; account_code: string }[]).map((rule) => ({ word: rule.keyword.toLowerCase(), code: rule.account_code }));
  const kassa = new Set((kassaRows!.results as { id: string }[]).map((row) => row.id));
  const classified = paid.map((row) => {
    let kind: Kind = "line";
    let account: string | null = null;
    if (kassa.has(row.id)) kind = "kassa";
    else {
      const text = row.description.toLowerCase();
      account = rules.find((rule) => text.includes(rule.word))?.code ?? null;
      if (account !== null) kind = "rule";
    }
    return { id: row.id, method: row.method, amount: row.amountCents, description: row.description, date: row.paidDate, settlement: row.settlementId, kind, account };
  });

  // One statement for all of them. A payment already kept keeps what it was classified as; only its payout is noted.
  const [, totalRows, entryRows, lineRows, closedRows] = await db.batch([
    db
      .prepare(
        `INSERT INTO mollie_payments (id, method, amount_cents, description, paid_date, settlement_id, kind, account_code)
         SELECT json_extract(value, '$.id'), json_extract(value, '$.method'), json_extract(value, '$.amount'), json_extract(value, '$.description'),
           json_extract(value, '$.date'), json_extract(value, '$.settlement'), json_extract(value, '$.kind'), json_extract(value, '$.account')
         FROM json_each(?1) WHERE true
         ON CONFLICT (id) DO UPDATE SET settlement_id = COALESCE(excluded.settlement_id, mollie_payments.settlement_id)`,
      )
      .bind(JSON.stringify(classified)),
    db
      .prepare(
        `SELECT paid_date AS date, account_code AS code, SUM(amount_cents) AS cents FROM mollie_payments
         WHERE kind = 'rule' AND paid_date IN (SELECT value FROM json_each(?1)) GROUP BY paid_date, account_code`,
      )
      .bind(dates),
    db
      .prepare(
        `SELECT e.id, e.source_ref AS ref, e.year, l.account_code AS code, l.amount_cents AS cents
         FROM ledger_entries e LEFT JOIN ledger_lines l ON l.entry_id = e.id
         WHERE e.source = '${SOURCE}' AND e.source_ref IN (SELECT value FROM json_each(?1) UNION ALL SELECT 'late:' || value FROM json_each(?1))`,
      )
      .bind(dates),
    // Every `line` payment of those days, the ones read before first: a new line of a day is told from an equal
    // one already there by how many came before it (worker/db/bank.ts), so they go in together.
    db
      .prepare(
        `SELECT id, amount_cents, description, paid_date FROM mollie_payments
         WHERE kind = 'line' AND paid_date IN (SELECT value FROM json_each(?1)) ORDER BY paid_date, rowid`,
      )
      .bind(dates),
    db.prepare("SELECT year FROM ledger_years WHERE status = 'closed'"),
  ]);

  // What the rules say per day: debit 1030 the total, credit each account its part.
  const totals = new Map<string, Amounts>();
  for (const row of totalRows!.results as { date: string; code: string; cents: number }[]) {
    const day = totals.get(row.date) ?? totals.set(row.date, new Map()).get(row.date)!;
    add(day, MOLLIE, row.cents);
    add(day, row.code, -row.cents);
  }
  const booked = new Map<string, Booked>();
  for (const row of entryRows!.results as { id: string; ref: string; year: number; code: string | null; cents: number | null }[]) {
    const entry = booked.get(row.ref) ?? booked.set(row.ref, { id: row.id, year: row.year, amounts: new Map() }).get(row.ref)!;
    if (row.code !== null) add(entry.amounts, row.code, row.cents!);
  }
  const closed = new Set((closedRows!.results as { year: number }[]).map((row) => row.year));
  const work = dayWork(dateList, totals, booked, closed);

  const lines: CamtLine[] = (lineRows!.results as { id: string; amount_cents: number; description: string; paid_date: string }[]).map((row) => ({
    bookingDate: row.paid_date,
    amountCents: row.amount_cents,
    description: row.description,
    counterpartyName: null,
    counterpartyIban: null,
    bankRef: row.id,
  }));
  await importLines(db, MOLLIE, lines, "mollie", now);

  // Each `line` payment remembers its line; it rides along with the first day entries.
  const batches: D1PreparedStatement[][] = [];
  if (lines.length > 0) {
    batches.push([
      db
        .prepare(
          `UPDATE mollie_payments SET bank_line_id = (SELECT b.id FROM bank_lines b WHERE b.account_code = '${MOLLIE}' AND b.bank_ref = mollie_payments.id)
           WHERE kind = 'line' AND bank_line_id IS NULL AND paid_date IN (SELECT value FROM json_each(?1))`,
        )
        .bind(dates),
    ]);
  }
  const openYear = work.some((item) => closed.has(yearOf(item.date))) ? await firstOpenYear(db) : 0;
  for (let i = 0; i < work.length; i += PER_BATCH) {
    const statements = work.slice(i, i + PER_BATCH).flatMap((item) => upsertSourcedStatements(db, item.entry(openYear), item.existing, now));
    if (i === 0 && batches.length > 0) batches[0]!.push(...statements);
    else batches.push(statements);
  }
  for (const statements of batches) await db.batch(statements);
}

/**
 * The day entries among `dates` that differ from the rules' totals. A day in an open year follows its payments
 * (less a late entry made while its year was closed); a day in a closed year keeps its entry, and what the payments
 * have more goes to its late entry, dated 1 January of the first open year.
 */
function dayWork(dates: string[], totals: Map<string, Amounts>, booked: Map<string, Booked>, closed: Set<number>): Work[] {
  const work: Work[] = [];
  for (const date of dates) {
    const want = totals.get(date) ?? new Map<string, number>();
    const day = booked.get(date);
    const late = booked.get(`late:${date}`);
    if (!closed.has(yearOf(date))) {
      const lines = minus(want, late?.amounts);
      if (day ? sameAmounts(day.amounts, lines) : lines.size === 0) continue;
      work.push({
        date,
        existing: day ? { id: day.id } : null,
        entry: () => ({ date, description: `Mollie overig ${dayMonthYear(date)}`, source: SOURCE, sourceRef: date, lines: toLines(lines) }),
      });
      continue;
    }
    const more = minus(want, day?.amounts);
    // A late entry that is itself in a closed year cannot change any more, and a date has only one.
    if ((late ? sameAmounts(late.amounts, more) : more.size === 0) || (late && closed.has(late.year))) continue;
    work.push({
      date,
      existing: late ? { id: late.id } : null,
      entry: (openYear) => ({
        date: `${openYear}-01-01`,
        description: `Nagekomen Mollie overig ${dayMonthYear(date)}`,
        source: SOURCE,
        sourceRef: `late:${date}`,
        lines: toLines(more),
      }),
    });
  }
  return work;
}

/**
 * Refunds (not failed or called off) and chargebacks of a payment that is not the kassa's, each a line on 1030 with
 * the amount that left Mollie, on its Amsterdam day. One of a kassa payment is left to the kassa's own reversal.
 */
async function storeReversals(db: D1Database, refunds: MollieRefundRow[], chargebacks: MollieChargebackRow[], now: Date): Promise<void> {
  const items = [
    ...refunds.filter((refund) => refund.status !== "failed" && refund.status !== "canceled").map((refund) => ({ ...refund, word: "Terugbetaling" })),
    ...chargebacks.map((chargeback) => ({ ...chargeback, word: "Terugboeking" })),
  ]
    .map((item) => ({ ...item, date: businessDate(item.createdAt) }))
    .filter((item) => item.date >= LEDGER_START)
    .sort((a, b) => byMoment({ at: a.createdAt, id: a.id }, { at: b.createdAt, id: b.id }));
  if (items.length === 0) return;
  const ids = JSON.stringify([...new Set(items.map((item) => item.paymentId))]);
  const [kassaRows, knownRows] = await db.batch([
    kassaPayments(db, ids),
    db.prepare("SELECT id, description FROM mollie_payments WHERE id IN (SELECT value FROM json_each(?1))").bind(ids),
  ]);
  const kassa = new Set((kassaRows!.results as { id: string }[]).map((row) => row.id));
  const about = new Map((knownRows!.results as { id: string; description: string }[]).map((row) => [row.id, row.description.trim()]));
  const lines: CamtLine[] = items
    .filter((item) => !kassa.has(item.paymentId))
    .map((item) => {
      const what = about.get(item.paymentId);
      return {
        bookingDate: item.date,
        amountCents: -Math.abs(item.amountCents),
        description: what ? `${item.word} Mollie: ${what}` : `${item.word} Mollie`,
        counterpartyName: null,
        counterpartyIban: null,
        bankRef: item.id,
      };
    });
  await importLines(db, MOLLIE, lines, "mollie", now);
}

// ---- The rules ----

export async function listRules(db: D1Database): Promise<MollieRule[]> {
  const { results } = await db.prepare("SELECT id, keyword, account_code FROM mollie_rules ORDER BY sort, id").all<{ id: string; keyword: string; account_code: string }>();
  return results.map((row) => ({ id: row.id, keyword: row.keyword, accountCode: row.account_code }));
}

/**
 * Adds a rule at the end, or changes one in place (it keeps its turn). Only an income account; the keyword is
 * trimmed and 2 to 40 characters. Payments already classified stay as they are.
 */
export async function saveRule(db: D1Database, rule: Omit<MollieRule, "id"> & { id?: string }): Promise<MollieRule> {
  const keyword = rule.keyword.trim();
  if (keyword.length < 2 || keyword.length > 40) throw new LedgerError("invalid", 400);
  const account = await db.prepare("SELECT kind FROM ledger_accounts WHERE code = ?").bind(rule.accountCode).first<{ kind: AccountKind }>();
  if (!account) throw new LedgerError("account_unknown", 400);
  if (account.kind !== "income") throw new LedgerError("not_income_account", 400);
  const saved = { keyword, accountCode: rule.accountCode };
  if (rule.id !== undefined) {
    const changed = await db.prepare("UPDATE mollie_rules SET keyword = ?2, account_code = ?3 WHERE id = ?1").bind(rule.id, keyword, rule.accountCode).run();
    if (!changed.meta.changes) throw new LedgerError("not_found", 404);
    return { id: rule.id, ...saved };
  }
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO mollie_rules (id, keyword, account_code, sort) SELECT ?1, ?2, ?3, COALESCE(MAX(sort), 0) + 1 FROM mollie_rules")
    .bind(id, keyword, rule.accountCode)
    .run();
  return { id, ...saved };
}

/** A rule is settings, not bookkeeping: it may go, and what it booked stays booked. Gone already is fine. */
export async function deleteRule(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM mollie_rules WHERE id = ?").bind(id).run();
}
