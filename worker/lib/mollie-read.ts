// Mollie, read only, for the boekhouding: payments of every method, refunds, chargebacks, payouts (settlements) and the
// balance. The organisation's own access token (`MOLLIE_ORG_TOKEN`, scopes payments.read, refunds.read, settlements.read,
// balances.read, profiles.read), not the kassa's profile key in worker/lib/mollie.ts. Plain `fetch` against the Payments API
// v2, as documented on docs.mollie.com (read 23 November 2026). Nothing here writes at Mollie. The token never goes into a
// log line, an error message or a response.

import { getLedgerSetting, setLedgerSetting } from "../db/ledger-settings";
import { isLocalHost } from "../../shared/local-host";
import type { Env } from "../env";
import { MOLLIE_API, type MollieFailure, type MollieResult } from "./mollie";

// Same patience as the kassa's client: a slow answer is treated as no answer.
const TIMEOUT_MS = 8000;
// A cron run may make 50 external calls, ING's included: no list takes more than this many calls (pages and a payout's
// own reads alike), the rest waits for the next run. Four lists, the profile and the balance stay within 26.
const MAX_PAGES = 6;
// Items per page: one run reads at most 600 of a list, which it can parse and store within its CPU time.
const PAGE_LIMIT = 100;
const PROFILE_KEY = "mollie_profile_id";

export type MolliePaymentRow = { id: string; method: string; amountCents: number; description: string; status: string; paidAt: string | null; settlementId: string | null };
export type MollieRefundRow = { id: string; paymentId: string; amountCents: number; createdAt: string; description: string; status: string };
export type MollieChargebackRow = { id: string; paymentId: string; amountCents: number; createdAt: string };
export type MollieSettlementRow = { id: string; reference: string; status: string; settledAt: string | null; amountCents: number; costsCents: number };

/**
 * The stretch of payments a read cut short by the page cap left unread: from the payment `from` (Mollie's cursor,
 * the first one not read) back to `untilIso`, where that read began.
 */
export type PaymentGap = { from: string; untilIso: string };

export type MollieRead = {
  /**
   * Every payment created at or after `fromIso`, newest first. With `gap`, that stretch is read first, within the
   * same page cap, and the newest only once it is done. `gap` in the answer is what is still left unread (null: nothing).
   */
  paymentsSince(fromIso: string, gap?: PaymentGap | null): Promise<MollieResult<{ rows: MolliePaymentRow[]; gap: PaymentGap | null }>>;
  /** `cutShort`: the page cap was reached before the list reached back to `fromIso`, so `rows` is not all of it. */
  refundsSince(fromIso: string): Promise<MollieResult<{ rows: MollieRefundRow[]; cutShort: boolean }>>;
  chargebacksSince(fromIso: string): Promise<MollieResult<{ rows: MollieChargebackRow[]; cutShort: boolean }>>;
  /** Payouts that are still open or were settled at or after `fromIso`. `costsCents` is the gross of all costs, as Mollie signs them. */
  settlementsSince(fromIso: string): Promise<MollieResult<MollieSettlementRow[]>>;
  primaryBalance(): Promise<MollieResult<{ availableCents: number; pendingCents: number }>>;
};

type Raw = Record<string, any>;
const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

const UNREADABLE = { ok: false, failure: "unreachable", status: 0 } as const;

/** Thrown while mapping an answer that cannot be read; the call then fails as `unreachable`, it never guesses. */
class Unreadable extends Error {}
/** A read inside a page that failed; its result is the call's result. */
class Failed extends Error {
  constructor(readonly result: { ok: false; failure: MollieFailure; status: number }) {
    super("failed");
  }
}
type Budget = { left: number };
const need = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Unreadable();
  return value;
};

function baseOf(env: Env): string {
  if (!env.MOLLIE_API_BASE) return MOLLIE_API;
  try {
    if (isLocalHost(new URL(env.MOLLIE_API_BASE).hostname)) return env.MOLLIE_API_BASE.replace(/\/+$/, "");
  } catch {
    // not an address at all
  }
  return MOLLIE_API;
}

function failureOf(status: number): MollieFailure {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409 || status === 429 || status >= 500 || status < 400) return "unreachable";
  return "refused";
}

/** A Mollie amount `{ currency, value: "-12.3400" }` in ten-thousandths of a euro; no floating point. */
function units(amount: unknown): number {
  const value = isRecord(amount) ? amount.value : null;
  const match = typeof value === "string" ? /^(-?)(\d{1,12})(?:\.(\d{1,4}))?$/.exec(value) : null;
  if (!match || (isRecord(amount) && amount.currency !== "EUR")) throw new Unreadable();
  const total = Number(match[2]) * 10000 + Number((match[3] ?? "").padEnd(4, "0"));
  return match[1] ? -total : total;
}

/** Whole cents from ten-thousandths, half away from zero. */
function cents(total: number): number {
  const rounded = Math.floor((Math.abs(total) + 50) / 100);
  return total < 0 && rounded !== 0 ? -rounded : rounded;
}

function moment(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  if (Number.isNaN(parsed)) throw new Unreadable();
  return parsed;
}

/** The client for the organisation token in this environment, or null when there is none. */
export function mollieReadFor(env: Env): MollieRead | null {
  const token = env.MOLLIE_ORG_TOKEN;
  if (!token) return null;
  const base = baseOf(env);

  async function call(path: string): Promise<MollieResult<unknown>> {
    try {
      const response = await fetch(`${base}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/hal+json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return { ok: false, failure: failureOf(response.status), status: response.status };
      }
      return { ok: true, data: await response.json() };
    } catch {
      // No connection, no answer in time, or an answer that is not JSON.
      return { ok: false, failure: "unreachable", status: 0 };
    }
  }

  /**
   * Where the next page lives, as a path under the base: only the path and query of `_links.next.href` are used,
   * so the token goes to the same host as before whatever the link says.
   */
  function nextPath(raw: Raw, profile: string | null): string | null {
    const href = isRecord(raw._links) && isRecord(raw._links.next) ? text(raw._links.next.href) : null;
    if (!href) return null;
    try {
      const url = new URL(href);
      // Mollie's own link may leave `profileId` out; the lists that need it get it back.
      if (profile && !url.searchParams.has("profileId")) url.searchParams.set("profileId", profile);
      return `${url.pathname.replace(/^\/v2(?=\/)/, "")}${url.search}`;
    } catch {
      throw new Unreadable();
    }
  }

  /**
   * Reads pages of `_embedded[key]` from `first`; `budget` is the calls this list may still make (pages and the
   * extra reads of `onPage` alike). `onPage` takes a page's items and says whether to go on. Answers the path of the
   * page left unread because the calls ran out, or null when the list was read to its end or `onPage` stopped it.
   */
  async function pages(first: string, key: string, onPage: (items: Raw[]) => boolean | Promise<boolean>, budget: Budget = { left: MAX_PAGES }, profile: string | null = null): Promise<MollieResult<string | null>> {
    let path: string | null = first;
    try {
      while (path) {
        if (budget.left <= 0) return { ok: true, data: path };
        budget.left--;
        const result = await call(path);
        if (!result.ok) return result;
        const raw = result.data;
        const list = isRecord(raw) && isRecord(raw._embedded) && Array.isArray(raw._embedded[key]) ? raw._embedded[key] : null;
        if (!list || !list.every(isRecord)) return UNREADABLE;
        if (!(await onPage(list))) break;
        path = isRecord(raw) ? nextPath(raw, profile) : null;
      }
      return { ok: true, data: null };
    } catch (error) {
      if (error instanceof Unreadable) return UNREADABLE;
      if (error instanceof Failed) return error.result;
      throw error;
    }
  }

  /** The profile an organisation token must name on the payments, refunds and chargebacks lists: read once, then kept. */
  let knownProfile: string | null = null;
  async function profileId(): Promise<MollieResult<string>> {
    if (knownProfile) return { ok: true, data: knownProfile };
    const kept = await getLedgerSetting(env.DB, PROFILE_KEY);
    if (kept) {
      knownProfile = kept;
      return { ok: true, data: kept };
    }
    let found: string | null = null;
    const result = await pages("/profiles?limit=1", "profiles", (items) => {
      found = text(items[0]?.id);
      return false;
    });
    if (!result.ok) return result;
    if (!found) return { ok: false, failure: "not_found", status: 0 };
    await setLedgerSetting(env.DB, PROFILE_KEY, found, new Date());
    knownProfile = found;
    return { ok: true, data: found };
  }

  /**
   * A list newest first that needs the profile: items from `fromIso` on, stopping at the first older one, from the
   * top or from the item `startAt`. `cursor` is the first item left unread when `budget` ran out, else null.
   */
  async function newestFirst<T>(
    resource: string,
    key: string,
    fromIso: string,
    toRow: (item: Raw) => T,
    budget: Budget = { left: MAX_PAGES },
    startAt: string | null = null,
  ): Promise<MollieResult<{ rows: T[]; cursor: string | null }>> {
    const from = Date.parse(fromIso);
    if (Number.isNaN(from)) return UNREADABLE;
    const profile = await profileId();
    if (!profile.ok) return profile;
    const rows: T[] = [];
    const result = await pages(
      `/${resource}?limit=${PAGE_LIMIT}&profileId=${encodeURIComponent(profile.data)}${startAt === null ? "" : `&from=${encodeURIComponent(startAt)}`}`,
      key,
      (items) => {
        for (const item of items) {
          if (moment(item.createdAt) < from) return false;
          rows.push(toRow(item));
        }
        return true;
      },
      budget,
      profile.data,
    );
    if (!result.ok) return result;
    if (result.data === null) return { ok: true, data: { rows, cursor: null } };
    // The page left unread always carries Mollie's cursor (only a first page has none, and a list gets at least one call).
    const cursor = new URL(result.data, "https://mollie.invalid").searchParams.get("from");
    return cursor ? { ok: true, data: { rows, cursor } } : UNREADABLE;
  }

  const paymentRow = (item: Raw): MolliePaymentRow => ({
    id: need(text(item.id)),
    method: text(item.method) ?? "",
    amountCents: cents(units(item.amount)),
    description: text(item.description) ?? "",
    status: need(text(item.status)),
    paidAt: text(item.paidAt),
    settlementId: text(item.settlementId),
  });
  const complete = <T>(result: MollieResult<{ rows: T[]; cursor: string | null }>): MollieResult<{ rows: T[]; cutShort: boolean }> =>
    result.ok ? { ok: true, data: { rows: result.data.rows, cutShort: result.data.cursor !== null } } : result;

  return {
    async paymentsSince(fromIso, gap = null) {
      const budget: Budget = { left: MAX_PAGES };
      const rows: MolliePaymentRow[] = [];
      if (gap) {
        const stretch = await newestFirst("payments", "payments", gap.untilIso, paymentRow, budget, gap.from);
        if (!stretch.ok) return stretch;
        rows.push(...stretch.data.rows);
        // Not done yet: the newest wait until the stretch is read.
        if (stretch.data.cursor !== null) return { ok: true, data: { rows, gap: { from: stretch.data.cursor, untilIso: gap.untilIso } } };
        // Done, with no call left: the newest are read the next time, from what is kept by then.
        if (budget.left <= 0) return { ok: true, data: { rows, gap: null } };
      }
      const newest = await newestFirst("payments", "payments", fromIso, paymentRow, budget);
      if (!newest.ok) return newest;
      rows.push(...newest.data.rows);
      return { ok: true, data: { rows, gap: newest.data.cursor === null ? null : { from: newest.data.cursor, untilIso: fromIso } } };
    },

    refundsSince: async (fromIso) =>
      complete(await newestFirst("refunds", "refunds", fromIso, (item) => ({
        id: need(text(item.id)),
        paymentId: need(text(item.paymentId)),
        amountCents: cents(units(item.amount)),
        createdAt: need(text(item.createdAt)),
        description: text(item.description) ?? "",
        status: need(text(item.status)),
      }))),

    chargebacksSince: async (fromIso) =>
      complete(await newestFirst("chargebacks", "chargebacks", fromIso, (item) => ({
        id: need(text(item.id)),
        paymentId: need(text(item.paymentId)),
        amountCents: cents(units(item.amount)),
        createdAt: need(text(item.createdAt)),
      }))),

    async settlementsSince(fromIso) {
      const from = Date.parse(fromIso);
      if (Number.isNaN(from)) return UNREADABLE;
      const rows: MollieSettlementRow[] = [];
      // No order is documented: go on while a page holds an open payout or one settled since `fromIso`.
      const budget: Budget = { left: MAX_PAGES };
      const result = await pages(`/settlements?limit=${PAGE_LIMIT}`, "settlements", async (items) => {
        let relevant = false;
        for (const item of items) {
          const settledAt = text(item.settledAt);
          if (settledAt !== null && moment(settledAt) < from) continue;
          relevant = true;
          // The list may leave `periods` out (the docs do not say): then the payout is read on its own, never costed as 0.
          let periods = item.periods;
          if (!isRecord(periods)) {
            if (budget.left <= 0) return false; // out of calls: this and the rest wait for the next run
            budget.left--;
            const one = await call(`/settlements/${encodeURIComponent(need(text(item.id)))}`);
            if (!one.ok) throw new Failed(one);
            periods = need(isRecord(one.data) && isRecord(one.data.periods) ? one.data.periods : null);
          }
          rows.push({
            id: need(text(item.id)),
            reference: text(item.reference) ?? "",
            status: need(text(item.status)),
            settledAt,
            amountCents: cents(units(item.amount)),
            costsCents: cents(costsOf(periods)),
          });
        }
        return relevant;
      }, budget);
      return result.ok ? { ok: true, data: rows } : result;
    },

    async primaryBalance() {
      const result = await call("/balances/primary");
      if (!result.ok) return result;
      try {
        const raw = need(isRecord(result.data) ? result.data : null);
        return { ok: true, data: { availableCents: cents(units(raw.availableAmount)), pendingCents: cents(units(raw.pendingAmount)) } };
      } catch (error) {
        if (error instanceof Unreadable) return UNREADABLE;
        throw error;
      }
    },
  };
}

/** The exact sum (ten-thousandths) of `amountGross` of every `periods.<year>.<month>.costs[]`. */
function costsOf(periods: unknown): number {
  if (periods === undefined || periods === null) return 0;
  if (!isRecord(periods)) throw new Unreadable();
  let total = 0;
  for (const months of Object.values(periods)) {
    if (!isRecord(months)) throw new Unreadable();
    for (const month of Object.values(months)) {
      if (!isRecord(month)) throw new Unreadable();
      if (month.costs === undefined || month.costs === null) continue;
      if (!Array.isArray(month.costs)) throw new Unreadable();
      for (const cost of month.costs) {
        if (!isRecord(cost)) throw new Unreadable();
        total += units(cost.amountGross);
      }
    }
  }
  return total;
}
