// The only code that talks to Enable Banking (the PSD2 gateway to ING): consent, session, bank lines, balance.
// Plain `fetch` against api.enablebanking.com, as documented on enablebanking.com/docs (read 23 November 2026).
// Every request carries a JWT signed with the application's private key. The key, the token and what the bank
// answers about people never go into a log line or an error message here.

import type { CamtLine } from "../../shared/camt";
import { isLocalHost } from "../../shared/local-host";
import type { Env } from "../env";

export const ENABLE_BANKING_API = "https://api.enablebanking.com";

// Same patience as the Mollie client: a slow answer is treated as no answer.
const TIMEOUT_MS = 8000;
// The free plan allows 50 external calls per run, Mollie's included; more pages than this wait for the next run.
const MAX_PAGES = 10;

/**
 * Why a call gave nothing to work with. `unauthorized`: the key is wrong or the consent is gone (expired,
 * revoked, closed). `refused`: Enable Banking said no. `not_found`: no such thing. `unreachable`: no usable answer.
 * `unreadable`: an answer with a booked line this client cannot read, so nothing is returned rather than less.
 */
export type EbFailure = "unauthorized" | "refused" | "not_found" | "unreachable" | "unreadable";
export type EbResult<T> = { ok: true; data: T } | { ok: false; failure: EbFailure; status: number };

export type EbClient = {
  /** ING's longest consent in whole days. */
  maxConsentDays(): Promise<EbResult<number>>;
  /** The page at the bank where the penningmeester gives consent. `validUntil` is an ISO date-time. */
  startAuth(input: { validUntil: string; redirectUrl: string; state: string }): Promise<EbResult<{ url: string }>>;
  createSession(code: string): Promise<EbResult<{ sessionId: string; validUntil: string; accounts: { uid: string; iban: string | null }[] }>>;
  /** Booked lines from `dateFrom` (YYYY-MM-DD), every page, each bank reference at most once. */
  transactions(accountUid: string, dateFrom: string): Promise<EbResult<CamtLine[]>>;
  /** Closing booked, else interim booked; null when the bank gives neither. */
  balance(accountUid: string): Promise<EbResult<{ date: string; cents: number } | null>>;
};

type Raw = Record<string, any>;
const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null;
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

// ---- the JWT ----

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const encodeJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

/** The error message is a code: "key_format" for a key that is not PKCS#8 PEM. It never holds any of the key. */
async function importKey(pem: string): Promise<CryptoKey> {
  if (pem.includes("BEGIN RSA PRIVATE KEY")) throw new Error("key_format"); // PKCS#1: not converted here
  const body = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(pem)?.[1];
  if (!body) throw new Error("key_format");
  let der: Uint8Array;
  try {
    der = Uint8Array.from(atob(body.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("key_format");
  }
  try {
    return await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  } catch {
    throw new Error("key_format");
  }
}

/** An RS256 JWT for Enable Banking: header kid = the application id, valid for one hour from `now`. */
export async function signJwt(appId: string, pem: string, now: Date): Promise<string> {
  const key = await importKey(pem);
  const iat = Math.floor(now.getTime() / 1000);
  const head = encodeJson({ typ: "JWT", alg: "RS256", kid: appId });
  const claims = encodeJson({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp: iat + 3600 });
  const signature = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${base64url(new Uint8Array(signature))}`;
}

// ---- the client ----

/** Where Enable Banking lives. Another address is honoured only when it is this computer itself (the tests). */
function baseOf(env: Env): string {
  if (!env.ENABLE_BANKING_API_BASE) return ENABLE_BANKING_API;
  try {
    if (isLocalHost(new URL(env.ENABLE_BANKING_API_BASE).hostname)) return env.ENABLE_BANKING_API_BASE.replace(/\/+$/, "");
  } catch {
    // not an address at all
  }
  return ENABLE_BANKING_API;
}

function failureOf(status: number): EbFailure {
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status >= 500 || status < 400) return "unreachable";
  return "refused"; // other 4xx, including 429: nothing was done, asking again later may work
}

// The consent is gone, whatever HTTP status says so.
const GONE = new Set(["EXPIRED_SESSION", "REVOKED_SESSION", "CLOSED_SESSION"]);

/** Whole cents from a decimal string such as "12.50", "-3", "0.5". No floating point. */
function centsOf(raw: unknown): number | null {
  const m = typeof raw === "string" ? /^(-)?(\d+)(?:\.(\d{1,2})0*)?$/.exec(raw.trim()) : null;
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] ? -cents : cents;
}

const datePart = (value: unknown): string | null => (typeof value === "string" ? (/^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? null) : null);

/** A booked line as a bank line; "skip" for a line that is not booked; null for a booked line that cannot be read. */
function lineOf(raw: Raw): CamtLine | null | "skip" {
  if (raw.status !== "BOOK") return "skip"; // a pending line can still change or vanish
  const amount = isRecord(raw.transaction_amount) ? centsOf(raw.transaction_amount.amount) : null;
  const bookingDate = datePart(raw.booking_date) ?? datePart(raw.value_date) ?? datePart(raw.transaction_date);
  const indicator = raw.credit_debit_indicator;
  if (amount === null || !bookingDate || (indicator !== "CRDT" && indicator !== "DBIT")) return null;
  const credit = indicator === "CRDT";
  const party = isRecord(credit ? raw.debtor : raw.creditor) ? (credit ? raw.debtor : raw.creditor) : null;
  const account = isRecord(credit ? raw.debtor_account : raw.creditor_account) ? (credit ? raw.debtor_account : raw.creditor_account) : null;
  const iban = text(account?.iban)?.replace(/\s+/g, "").toUpperCase() ?? null;
  const remittance = Array.isArray(raw.remittance_information) ? raw.remittance_information.filter((part: unknown) => typeof part === "string") : [];
  return {
    bookingDate,
    amountCents: credit ? Math.abs(amount) : -Math.abs(amount),
    description: remittance.join(" ").replace(/\s+/g, " ").trim(),
    counterpartyName: text(party?.name),
    counterpartyIban: iban,
    bankRef: text(raw.entry_reference) ?? text(raw.transaction_id),
  };
}

/** The client for the key in this environment, or null when there is no application id or no key. */
export function enableBankingFor(env: Env): EbClient | null {
  const appId = env.ENABLE_BANKING_APP_ID;
  const pem = env.ENABLE_BANKING_PRIVATE_KEY;
  if (!appId || !pem) return null;
  const base = baseOf(env);

  // A token lives an hour; one client reuses it for half of that.
  let token: { jwt: string; at: number } | null = null;
  async function bearer(): Promise<string> {
    const now = Date.now();
    if (!token || now - token.at > 1800_000) token = { jwt: await signJwt(appId!, pem!, new Date(now)), at: now };
    return token.jwt;
  }

  async function call(method: string, path: string, json?: unknown): Promise<EbResult<unknown>> {
    let jwt: string;
    try {
      jwt = await bearer();
    } catch {
      return { ok: false, failure: "refused", status: 0 }; // the key cannot be used; nothing was sent
    }
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json", ...(json === undefined ? {} : { "Content-Type": "application/json" }) },
        body: json === undefined ? undefined : JSON.stringify(json),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        let gone = false;
        try {
          const body: unknown = await response.json();
          gone = isRecord(body) && typeof body.error === "string" && GONE.has(body.error);
        } catch {
          // no readable body: the status alone decides
        }
        if (gone) return { ok: false, failure: "unauthorized", status: response.status };
        return { ok: false, failure: failureOf(response.status), status: response.status };
      }
      return { ok: true, data: await response.json() };
    } catch {
      return { ok: false, failure: "unreachable", status: 0 };
    }
  }

  const unreadable = { ok: false, failure: "unreachable", status: 0 } as const;

  return {
    async maxConsentDays() {
      const result = await call("GET", "/aspsps?country=NL");
      if (!result.ok) return result;
      const list = isRecord(result.data) && Array.isArray(result.data.aspsps) ? result.data.aspsps : null;
      if (!list) return unreadable;
      const ing = list.find((a: unknown) => isRecord(a) && a.name === "ING" && a.country === "NL");
      if (!isRecord(ing) || typeof ing.maximum_consent_validity !== "number") return { ok: false, failure: "refused", status: 0 };
      return { ok: true, data: Math.floor(ing.maximum_consent_validity / 86400) };
    },
    async startAuth({ validUntil, redirectUrl, state }) {
      const result = await call("POST", "/auth", {
        access: { valid_until: validUntil },
        aspsp: { name: "ING", country: "NL" },
        state,
        redirect_url: redirectUrl,
        psu_type: "business",
      });
      if (!result.ok) return result;
      const url = isRecord(result.data) ? text(result.data.url) : null;
      return url ? { ok: true, data: { url } } : unreadable;
    },
    async createSession(code) {
      const result = await call("POST", "/sessions", { code });
      if (!result.ok) return result;
      const raw = result.data;
      const sessionId = isRecord(raw) ? text(raw.session_id) : null;
      const validUntil = isRecord(raw) && isRecord(raw.access) ? text(raw.access.valid_until) : null;
      if (!isRecord(raw) || !sessionId || !validUntil || !Array.isArray(raw.accounts)) return unreadable;
      const accounts = raw.accounts.filter(isRecord).flatMap((account) => {
        const uid = text(account.uid);
        return uid ? [{ uid, iban: isRecord(account.account_id) ? (text(account.account_id.iban)?.replace(/\s+/g, "").toUpperCase() ?? null) : null }] : [];
      });
      return { ok: true, data: { sessionId, validUntil, accounts } };
    },
    async transactions(accountUid, dateFrom) {
      const lines: CamtLine[] = [];
      const seen = new Set<string>();
      let key: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query: string = `date_from=${encodeURIComponent(dateFrom)}${key === null ? "" : `&continuation_key=${encodeURIComponent(key)}`}`;
        const result = await call("GET", `/accounts/${encodeURIComponent(accountUid)}/transactions?${query}`);
        if (!result.ok) return result; // a page that fails fails the call: a half-read list must not look complete
        const raw = result.data;
        if (!isRecord(raw) || !Array.isArray(raw.transactions)) return unreadable;
        for (const item of raw.transactions) {
          const line = isRecord(item) ? lineOf(item) : null;
          if (line === "skip") continue;
          if (line === null) return { ok: false, failure: "unreadable", status: 0 }; // never lose a booked line silently
          if (line.bankRef !== null) {
            if (seen.has(line.bankRef)) continue; // the doubles rule relies on one line per reference
            seen.add(line.bankRef);
          }
          lines.push(line);
        }
        key = text(raw.continuation_key);
        if (key === null) break;
      }
      return { ok: true, data: lines };
    },
    async balance(accountUid) {
      const result = await call("GET", `/accounts/${encodeURIComponent(accountUid)}/balances`);
      if (!result.ok) return result;
      const list = isRecord(result.data) && Array.isArray(result.data.balances) ? result.data.balances.filter(isRecord) : null;
      if (!list) return unreadable;
      for (const type of ["CLBD", "ITBD"]) {
        const found = list.find((b) => b.balance_type === type);
        if (!found) continue;
        const cents = isRecord(found.balance_amount) ? centsOf(found.balance_amount.amount) : null;
        const date = datePart(found.reference_date) ?? datePart(found.last_change_date_time);
        if (cents === null || !date) return unreadable;
        return { ok: true, data: { date, cents } };
      }
      return { ok: true, data: null };
    },
  };
}
