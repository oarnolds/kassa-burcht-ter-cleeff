// The consent for ING betaal (1010) through Enable Banking, and the nightly fetch that relies on it.
// The state that goes to the bank is used once; the session id is a secret kept only here, never sent to the
// browser, never logged, never in a copy. A failure is named by a fixed code, never by what the bank said.

import { type ConsentState, LEDGER_START } from "../../shared/ledger-types";
import type { CamtLine } from "../../shared/camt";
import { businessDate, shiftDate } from "../../shared/time";
import { enableBankingFor, type EbFailure, MAX_TRANSACTION_CALLS } from "../lib/enable-banking";
import type { Env } from "../env";
import { autoBook, importLines, recordBalance } from "./bank";
import { LedgerError } from "./ledger";

export type { ConsentState };

const ACCOUNT = "1010";
const DAY_MS = 86_400_000;
/** The page at the bank must be finished within this long after it was asked for. */
const STATE_LIFETIME_MS = 30 * 60_000;
/** A new fetch looks this many days before the newest line it has, to catch lines the bank booked late. */
const LOOK_BACK_DAYS = 7;
/** ING is asked for this many days at a time (R36). */
const WINDOW_DAYS = 14;

const normal = (value: string) => value.replace(/\s+/g, "").toUpperCase();
const refusal = (failure: EbFailure) => new LedgerError(`enable_banking_${failure}`, 502);

async function identifierOf(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT identifier FROM money_accounts WHERE account_code = ?").bind(ACCOUNT).first<{ identifier: string | null }>();
  const identifier = row?.identifier?.trim();
  if (!identifier) throw new LedgerError("identifier_missing", 409);
  return identifier;
}

/** Asks ING for a consent that ends just before the bank's longest, and gives the page where it is granted. */
export async function startConsent(env: Env, origin: string, now: Date): Promise<{ url: string }> {
  const client = enableBankingFor(env);
  if (!client) throw new LedgerError("enable_banking_off", 503);
  await identifierOf(env.DB);
  const days = await client.maxConsentDays();
  if (!days.ok) throw refusal(days.failure);
  const validUntil = new Date(now.getTime() + days.data * DAY_MS - 3_600_000).toISOString();
  const state = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO bank_consents (id, state, status, created_at) VALUES (?1, ?2, 'pending', ?3)")
    .bind(crypto.randomUUID(), state, now.toISOString())
    .run();
  const auth = await client.startAuth({ validUntil, redirectUrl: `${origin}/beheer/bank`, state });
  if (!auth.ok) {
    await env.DB.prepare("DELETE FROM bank_consents WHERE state = ?").bind(state).run();
    throw refusal(auth.failure);
  }
  return { url: auth.data.url };
}

/**
 * The bank sent the browser back with a code. The state is spent first, in one conditional update: a state that
 * is unknown, already used, older than 30 minutes or not pending changes nothing and asks the bank nothing.
 * Only then is the session made, and only the account of 1010 is kept.
 */
export async function finishConsent(env: Env, input: { code: string; state: string }, now: Date): Promise<ConsentState> {
  const client = enableBankingFor(env);
  if (!client) throw new LedgerError("enable_banking_off", 503);
  const spent = await env.DB.prepare(
    `UPDATE bank_consents SET used_at = ?1 WHERE state = ?2 AND status = 'pending' AND used_at IS NULL AND created_at > ?3 RETURNING id`,
  )
    .bind(now.toISOString(), input.state, new Date(now.getTime() - STATE_LIFETIME_MS).toISOString())
    .first<{ id: string }>();
  if (!spent) throw new LedgerError("state_invalid", 409);

  const identifier = normal(await identifierOf(env.DB));
  const session = await client.createSession(input.code);
  if (!session.ok) throw refusal(session.failure);
  const account = session.data.accounts.find((one) => one.iban !== null && normal(one.iban) === identifier);
  if (!account) throw new LedgerError("account_not_in_consent", 409);
  const validUntil = new Date(session.data.validUntil);
  if (Number.isNaN(validUntil.getTime())) throw refusal("unreadable");

  await env.DB.batch([
    env.DB.prepare("UPDATE bank_consents SET status = 'replaced' WHERE status = 'active' AND id <> ?1").bind(spent.id),
    env.DB.prepare("UPDATE bank_consents SET status = 'active', session_id = ?2, account_uid = ?3, valid_until = ?4 WHERE id = ?1")
      .bind(spent.id, session.data.sessionId, account.uid, validUntil.toISOString()),
    env.DB.prepare("UPDATE money_accounts SET source = 'enable_banking' WHERE account_code = ?1").bind(ACCOUNT),
  ]);
  return consentState(env.DB, now);
}

/** Where the newest consent that still counts stands. A state that was spent or has gone stale counts for nothing. */
export async function consentState(db: D1Database, now: Date): Promise<ConsentState> {
  const row = await db
    .prepare(
      `SELECT status, valid_until FROM bank_consents
       WHERE status <> 'replaced' AND NOT (status = 'pending' AND (used_at IS NOT NULL OR created_at <= ?1))
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .bind(new Date(now.getTime() - STATE_LIFETIME_MS).toISOString())
    .first<{ status: "pending" | "active" | "expired"; valid_until: string | null }>();
  if (!row) return { status: "none", validUntil: null, daysLeft: null };
  if (row.status === "pending" || !row.valid_until) return { status: "pending", validUntil: null, daysLeft: null };
  const left = Date.parse(row.valid_until) - now.getTime();
  const status = row.status === "active" && left > 0 ? "active" : "expired";
  // Whole days to go; any consent that has ended is below 0, so 0 only ever means the last day.
  const days = Math.floor(left / DAY_MS);
  return { status, validUntil: row.valid_until, daysLeft: status === "expired" ? Math.min(days, -1) : days };
}

/**
 * Nightly: new lines and the balance of 1010, when its source is Enable Banking and the consent is active (R36).
 * ING is asked in windows of two weeks (`date_from`/`date_to`), oldest first, from a week before the newest line of
 * 1010 that came from ING or a bank file (a typed line does not count; never before LEDGER_START) up to today, in
 * at most MAX_TRANSACTION_CALLS calls. A window is kept whole or not at all: one the bank cuts short (a page left
 * after the calls ran out) keeps nothing, the run stops there and says `ing_cut_short`; the windows before it are
 * kept. When the calls run out between windows, the later ones wait for the next night, which starts again a week
 * before the newest line. The balance is asked only once the lines are read up to today, so that a backlog does not
 * show as a difference. A failure keeps the windows read before it.
 */
export async function fetchIng(env: Env, now: Date): Promise<"ok" | "skipped" | string> {
  const db = env.DB;
  const account = await db.prepare("SELECT source FROM money_accounts WHERE account_code = ?").bind(ACCOUNT).first<{ source: string }>();
  if (account?.source !== "enable_banking") return "skipped";
  const consent = await db
    .prepare("SELECT id, account_uid, valid_until FROM bank_consents WHERE status = 'active' ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .first<{ id: string; account_uid: string; valid_until: string }>();
  if (!consent || Date.parse(consent.valid_until) <= now.getTime()) return "skipped";
  const client = enableBankingFor(env);
  if (!client) return "enable_banking_off";

  const gone = async (failure: EbFailure) => {
    console.error("ing step failed", failure);
    if (failure !== "unauthorized") return failure;
    // The consent ended now, whatever date it was given: that is the day to show, and the warning counts from it.
    await db.prepare("UPDATE bank_consents SET status = 'expired', valid_until = ?2 WHERE id = ?1").bind(consent.id, now.toISOString()).run();
    return "consent_expired";
  };

  const newest = await db
    .prepare("SELECT MAX(booking_date) AS date FROM bank_lines WHERE account_code = ? AND origin IN ('enable_banking', 'file')")
    .bind(ACCOUNT)
    .first<{ date: string | null }>();
  const back = newest?.date ? shiftDate(newest.date, -LOOK_BACK_DAYS) : LEDGER_START;
  const today = businessDate(now.toISOString());

  const lines: CamtLine[] = [];
  const seen = new Set<string>();
  let outcome = "ok";
  let calls = 0;
  let from = back < LEDGER_START ? LEDGER_START : back;
  while (from <= today && calls < MAX_TRANSACTION_CALLS) {
    const last = shiftDate(from, WINDOW_DAYS - 1);
    const to = last < today ? last : today;
    const window = await client.transactions(consent.account_uid, { from, to }, MAX_TRANSACTION_CALLS - calls);
    if (!window.ok) {
      outcome = await gone(window.failure);
      break;
    }
    calls += window.data.pages;
    if (!window.data.complete) {
      outcome = "ing_cut_short";
      break;
    }
    for (const line of window.data.lines) {
      // A line the bank lists in two windows (by another of its dates) counts once.
      if (line.bankRef !== null && seen.has(line.bankRef)) continue;
      if (line.bankRef !== null) seen.add(line.bankRef);
      lines.push(line);
    }
    from = shiftDate(to, 1);
  }

  await importLines(db, ACCOUNT, lines, "enable_banking", now);
  await autoBook(db, now);
  if (outcome !== "ok" || from <= today) return outcome;
  const balance = await client.balance(consent.account_uid);
  if (!balance.ok) return gone(balance.failure);
  if (balance.data) await recordBalance(db, ACCOUNT, balance.data, "enable_banking");
  return "ok";
}
