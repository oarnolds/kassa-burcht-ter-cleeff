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
// A cron run may make 50 external calls; no list takes more than this many pages, the rest waits for the next run.
const MAX_PAGES = 10;
const PROFILE_KEY = "mollie_profile_id";

export type MolliePaymentRow = { id: string; method: string; amountCents: number; description: string; status: string; paidAt: string | null; settlementId: string | null };
export type MollieRefundRow = { id: string; paymentId: string; amountCents: number; createdAt: string; description: string };
export type MollieChargebackRow = { id: string; paymentId: string; amountCents: number; createdAt: string };
export type MollieSettlementRow = { id: string; reference: string; status: string; settledAt: string | null; amountCents: number; costsCents: number };

export type MollieRead = {
  /** Every payment created at or after `fromIso`, newest first. */
  paymentsSince(fromIso: string): Promise<MollieResult<MolliePaymentRow[]>>;
  refundsSince(fromIso: string): Promise<MollieResult<MollieRefundRow[]>>;
  chargebacksSince(fromIso: string): Promise<MollieResult<MollieChargebackRow[]>>;
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
  function nextPath(raw: Raw): string | null {
    const href = isRecord(raw._links) && isRecord(raw._links.next) ? text(raw._links.next.href) : null;
    if (!href) return null;
    try {
      const url = new URL(href);
      return `${url.pathname.replace(/^\/v2(?=\/)/, "")}${url.search}`;
    } catch {
      throw new Unreadable();
    }
  }

  /**
   * Reads pages of `_embedded[key]` from `first`, at most MAX_PAGES. `onPage` takes a page's items and says whether to go on.
   */
  async function pages(first: string, key: string, onPage: (items: Raw[]) => boolean): Promise<MollieResult<null>> {
    let path: string | null = first;
    try {
      for (let page = 0; path && page < MAX_PAGES; page++) {
        const result = await call(path);
        if (!result.ok) return result;
        const raw = result.data;
        const list = isRecord(raw) && isRecord(raw._embedded) && Array.isArray(raw._embedded[key]) ? raw._embedded[key] : null;
        if (!list || !list.every(isRecord)) return UNREADABLE;
        if (!onPage(list)) break;
        path = isRecord(raw) ? nextPath(raw) : null;
      }
      return { ok: true, data: null };
    } catch (error) {
      if (error instanceof Unreadable) return UNREADABLE;
      throw error;
    }
  }

  /** The profile an organisation token must name on the payments, refunds and chargebacks lists: read once, then kept. */
  async function profileId(): Promise<MollieResult<string>> {
    const kept = await getLedgerSetting(env.DB, PROFILE_KEY);
    if (kept) return { ok: true, data: kept };
    let found: string | null = null;
    const result = await pages("/profiles?limit=1", "profiles", (items) => {
      found = text(items[0]?.id);
      return false;
    });
    if (!result.ok) return result;
    if (!found) return { ok: false, failure: "not_found", status: 0 };
    await setLedgerSetting(env.DB, PROFILE_KEY, found, new Date());
    return { ok: true, data: found };
  }

  /** A list newest first that needs the profile: items from `fromIso` on, stopping at the first older one. */
  async function newestFirst<T>(resource: string, key: string, fromIso: string, toRow: (item: Raw) => T): Promise<MollieResult<T[]>> {
    const from = Date.parse(fromIso);
    if (Number.isNaN(from)) return UNREADABLE;
    const profile = await profileId();
    if (!profile.ok) return profile;
    const rows: T[] = [];
    const result = await pages(`/${resource}?limit=250&profileId=${encodeURIComponent(profile.data)}`, key, (items) => {
      for (const item of items) {
        if (moment(item.createdAt) < from) return false;
        rows.push(toRow(item));
      }
      return true;
    });
    return result.ok ? { ok: true, data: rows } : result;
  }

  return {
    paymentsSince: (fromIso) =>
      newestFirst("payments", "payments", fromIso, (item) => ({
        id: need(text(item.id)),
        method: text(item.method) ?? "",
        amountCents: cents(units(item.amount)),
        description: text(item.description) ?? "",
        status: need(text(item.status)),
        paidAt: text(item.paidAt),
        settlementId: text(item.settlementId),
      })),

    refundsSince: (fromIso) =>
      newestFirst("refunds", "refunds", fromIso, (item) => ({
        id: need(text(item.id)),
        paymentId: need(text(item.paymentId)),
        amountCents: cents(units(item.amount)),
        createdAt: need(text(item.createdAt)),
        description: text(item.description) ?? "",
      })),

    chargebacksSince: (fromIso) =>
      newestFirst("chargebacks", "chargebacks", fromIso, (item) => ({
        id: need(text(item.id)),
        paymentId: need(text(item.paymentId)),
        amountCents: cents(units(item.amount)),
        createdAt: need(text(item.createdAt)),
      })),

    async settlementsSince(fromIso) {
      const from = Date.parse(fromIso);
      if (Number.isNaN(from)) return UNREADABLE;
      const rows: MollieSettlementRow[] = [];
      // No order is documented: go on while a page holds an open payout or one settled since `fromIso`.
      const result = await pages("/settlements?limit=250", "settlements", (items) => {
        let relevant = false;
        for (const item of items) {
          const settledAt = text(item.settledAt);
          if (settledAt !== null && moment(settledAt) < from) continue;
          relevant = true;
          rows.push({
            id: need(text(item.id)),
            reference: text(item.reference) ?? "",
            status: need(text(item.status)),
            settledAt,
            amountCents: cents(units(item.amount)),
            costsCents: cents(costsOf(item.periods)),
          });
        }
        return relevant;
      });
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
