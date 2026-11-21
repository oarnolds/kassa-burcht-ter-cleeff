// The only code that talks to Mollie: payments on a terminal (method `pointofsale`) and the list of terminals.
// Plain `fetch` against the Payments API v2, as documented on docs.mollie.com (read 21 November 2026).

import { isLocalHost } from "../../shared/local-host";
import type { PinMode, PinOutcome, PinTerminal } from "../../shared/types";
import type { Env } from "../env";

export const MOLLIE_API = "https://api.mollie.com/v2";

// The Worker may wait for Mollie; the iPad asks again every second, so a slow answer costs one round.
const TIMEOUT_MS = 8000;

/**
 * Why a call gave nothing to work with. `refused`, `unauthorized` and `not_found`: Mollie said no, nothing
 * happened. `unreachable`: no usable answer, so anything may have happened at Mollie.
 */
export type MollieFailure = "unauthorized" | "refused" | "not_found" | "unreachable";
export type MollieResult<T> = { ok: true; data: T } | { ok: false; failure: MollieFailure; status: number };

/** What the kassa needs of a Mollie payment. `saleId` is the sale the kassa named when it asked for the payment. */
export type MolliePayment = { id: string; status: string; reason: string | null; saleId: string | null; testUrl: string | null };

export type NewPayment = { saleId: string; amountCents: number; terminalId: string; origin: string };

export type Mollie = {
  mode: PinMode;
  createPayment(input: NewPayment): Promise<MollieResult<MolliePayment>>;
  getPayment(id: string): Promise<MollieResult<MolliePayment>>;
  cancelPayment(id: string): Promise<MollieResult<MolliePayment>>;
  listTerminals(): Promise<MollieResult<PinTerminal[]>>;
};

/** What a Mollie payment status means for the sale; null while the payment is still running. */
export function pinOutcome(mollieStatus: string): PinOutcome | null {
  switch (mollieStatus) {
    case "paid":
      return "paid";
    case "failed":
      return "declined";
    case "canceled":
      return "canceled";
    case "expired":
      return "expired";
    default:
      return null; // open, pending, authorized, and anything Mollie adds later: not final
  }
}

/** Mollie wants an amount as a string of euros with two decimals. */
function euros(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** Whether Mollie can call this address back: only a public https address. */
function reachableByMollie(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && !isLocalHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Where Mollie lives. Another address is honoured only when it is this computer itself: the end-to-end tests
 * run against a stand-in there, and a setting can never send production's payments anywhere else.
 */
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
  // 409: the same Idempotency-Key is still being worked on. 429: rate limited. 5xx: Mollie's own trouble.
  // In all of these the request may have been carried out, or may be later.
  if (status === 409 || status === 429 || status >= 500 || status < 400) return "unreachable";
  return "refused";
}

type Raw = Record<string, any>;
const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null;
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** The client for the key in this environment, or null when there is no key. */
export function mollieFor(env: Env): Mollie | null {
  const key = env.MOLLIE_API_KEY;
  if (!key) return null;
  const mode: PinMode = key.startsWith("test_") ? "test" : "live";
  const base = baseOf(env);

  async function call(method: string, path: string, more: { json?: unknown; idempotencyKey?: string } = {}): Promise<MollieResult<unknown>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: "application/hal+json" };
    if (more.json !== undefined) headers["Content-Type"] = "application/json";
    if (more.idempotencyKey) headers["Idempotency-Key"] = more.idempotencyKey;
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: more.json === undefined ? undefined : JSON.stringify(more.json),
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

  function toPayment(result: MollieResult<unknown>): MollieResult<MolliePayment> {
    if (!result.ok) return result;
    const raw = result.data;
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.status !== "string") return { ok: false, failure: "unreachable", status: 0 };
    return {
      ok: true,
      data: {
        id: raw.id,
        status: raw.status,
        reason: isRecord(raw.statusReason) ? text(raw.statusReason.code) : null,
        saleId: isRecord(raw.metadata) ? text(raw.metadata.saleId) : null,
        // Mollie's page to choose how a test payment ends. A live payment has none, and is never given one.
        testUrl: mode === "test" && isRecord(raw._links) && isRecord(raw._links.changePaymentState) ? text(raw._links.changePaymentState.href) : null,
      },
    };
  }

  return {
    mode,
    async createPayment({ saleId, amountCents, terminalId, origin }) {
      const json = {
        amount: { currency: "EUR", value: euros(amountCents) },
        description: `Kassa bon ${saleId.slice(0, 8)}`,
        method: "pointofsale",
        terminalId,
        // Mollie's only example of a terminal payment sends a redirectUrl; nobody is ever sent there.
        redirectUrl: `${origin}/`,
        ...(reachableByMollie(origin) ? { webhookUrl: `${origin}/api/mollie/webhook` } : {}),
        metadata: { saleId },
      };
      // The sale id is the Idempotency-Key: asking twice for the same sale gives the same payment, not a second one.
      return toPayment(await call("POST", "/payments", { json, idempotencyKey: saleId }));
    },
    async getPayment(id) {
      return toPayment(await call("GET", `/payments/${encodeURIComponent(id)}`));
    },
    async cancelPayment(id) {
      return toPayment(await call("DELETE", `/payments/${encodeURIComponent(id)}`));
    },
    async listTerminals() {
      const result = await call("GET", "/terminals?limit=250");
      if (!result.ok) return result;
      const raw = result.data;
      const list = isRecord(raw) && isRecord(raw._embedded) && Array.isArray(raw._embedded.terminals) ? raw._embedded.terminals : null;
      if (!list) return { ok: false, failure: "unreachable", status: 0 };
      const terminals: PinTerminal[] = list.filter(isRecord).flatMap((terminal) =>
        typeof terminal.id === "string"
          ? [
              {
                id: terminal.id,
                description: text(terminal.description) ?? "",
                status: text(terminal.status) ?? "",
                brand: text(terminal.brand),
                model: text(terminal.model),
                serialNumber: text(terminal.serialNumber),
              },
            ]
          : [],
      );
      return { ok: true, data: terminals };
    },
  };
}
