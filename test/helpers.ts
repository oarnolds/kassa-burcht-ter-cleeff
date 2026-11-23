import { env } from "cloudflare:workers";
import { afterEach, beforeEach, vi } from "vitest";
import type { CashSaleInput, PinSaleInput } from "../shared/schemas";
import type { ItemResult, PinStatus } from "../shared/types";
import { app } from "../worker/app";
import type { Env } from "../worker/env";
import { createFakeEnableBanking, type FakeEnableBanking } from "./fake-enable-banking";
import { createFakeMollie, type FakeMollie } from "./fake-mollie";

export const TEST_PASSWORD = "test-wachtwoord-123";
export const TEST_SETUP_TOKEN = "test-setup-token";

type ApiInit = {
  method?: string;
  json?: unknown;
  /** A form-encoded body, as Mollie's webhook sends it. */
  form?: Record<string, string>;
  cookie?: string;
  token?: string;
  headers?: Record<string, string>;
  /** Laid over the test environment for this one call, to try another Mollie key or none. */
  env?: Partial<Env>;
};

/** Calls the Worker the way the app does: the csrf header on writes, a cookie for beheer, a bearer token for the kassa. */
export async function api(path: string, init: ApiInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["X-Requested-With"] = "kassa";
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.form !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (init.cookie) headers["Cookie"] = init.cookie;
  if (init.token) headers["Authorization"] = `Bearer ${init.token}`;
  Object.assign(headers, init.headers);
  const body = init.form !== undefined ? new URLSearchParams(init.form).toString() : init.json === undefined ? undefined : JSON.stringify(init.json);
  return app.request(path, { method, headers, body }, init.env ? { ...env, ...init.env } : env);
}

/**
 * Sends every `fetch` in this test file to a fresh fake Mollie, so no test can reach the real one.
 * Call it at the top of a test file; `current` is the fake of the running test.
 */
export function useFakeMollie(): { current: FakeMollie } {
  const holder = {} as { current: FakeMollie };
  beforeEach(() => {
    holder.current = createFakeMollie({ key: "*", origin: "https://fake.mollie.test" });
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => holder.current.handle(new Request(input, init)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  return holder;
}

/** A throwaway RSA key for the tests, made at runtime, once per test file, and never written anywhere. */
let keyPromise: Promise<{ pem: string; publicKey: CryptoKey }> | undefined;
export function testRsaKey(): Promise<{ pem: string; publicKey: CryptoKey }> {
  keyPromise ??= (async () => {
    const pair = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    let binary = "";
    for (const byte of der) binary += String.fromCharCode(byte);
    const lines = btoa(binary).match(/.{1,64}/g)!.join("\n");
    return { pem: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
  })();
  return keyPromise;
}

export const TEST_EB_APP_ID = "app-id-fake";

/**
 * Sends every `fetch` in this test file to a fresh fake Enable Banking, so no test can reach the real one.
 * `key` is the PEM of the test key (see testRsaKey) the clients under test sign with.
 */
export function useFakeEnableBanking(): { current: FakeEnableBanking } {
  const holder = {} as { current: FakeEnableBanking };
  beforeEach(async () => {
    const { publicKey } = await testRsaKey();
    holder.current = createFakeEnableBanking({ appId: TEST_EB_APP_ID, publicKey, origin: "https://fake.enablebanking.test" });
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => holder.current.handle(new Request(input, init)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  return holder;
}

/**
 * For a test file that needs both fakes: routes each `fetch` by host (api.enablebanking.com to the fake
 * Enable Banking, api.mollie.com to the fake Mollie). Any other host throws, so nothing reaches the network.
 */
export function useFakeBoth(): { eb: { current: FakeEnableBanking }; mollie: { current: FakeMollie } } {
  const eb = {} as { current: FakeEnableBanking };
  const mollie = {} as { current: FakeMollie };
  beforeEach(async () => {
    const { publicKey } = await testRsaKey();
    eb.current = createFakeEnableBanking({ appId: TEST_EB_APP_ID, publicKey, origin: "https://fake.enablebanking.test" });
    mollie.current = createFakeMollie({ key: "*", origin: "https://fake.mollie.test" });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const host = new URL(request.url).hostname;
      if (host === "api.enablebanking.com") return eb.current.handle(request);
      if (host === "api.mollie.com") return mollie.current.handle(request);
      throw new Error(`test fetch to an unexpected host: ${host}`);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  return { eb, mollie };
}

// Children before parents, so no foreign key is left dangling.
const TABLES = [
  "mollie_payments",
  "mollie_settlements",
  "mollie_rules",
  "bank_consents",
  "category_accounts",
  "comparison_figures",
  "bank_lines",
  "bank_balances",
  "money_accounts",
  "ledger_settings",
  "ledger_attachments",
  "ledger_lines",
  "ledger_history",
  "ledger_entries",
  "ledger_year_events",
  "ledger_years",
  "ledger_accounts",
  "sale_lines",
  "stock_movements",
  "stock_order_lines",
  "stock_orders",
  "sales",
  "handovers",
  "devices",
  "products",
  "categories",
  "sessions",
  "pairing_codes",
  "auth_attempts",
  "settings",
  "admin",
];

/** Empties every table and replays every seed migration: the start assortment, the accounts and the first year. */
export async function resetData(): Promise<void> {
  const seeds = env.TEST_MIGRATIONS.filter((migration) => migration.name.endsWith("_seed.sql"));
  if (!seeds.some((migration) => migration.name === "0002_seed.sql")) throw new Error("migration 0002_seed.sql not found");
  await env.DB.batch([
    ...TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
    ...seeds.flatMap((seed) => seed.queries.map((query) => env.DB.prepare(query))),
  ]);
}

/** Sets up the admin if there is none yet and logs in. */
export async function asAdmin(): Promise<{ cookie: string }> {
  const setup = await api("/api/admin/setup", {
    method: "POST",
    json: { setupToken: TEST_SETUP_TOKEN, password: TEST_PASSWORD },
  });
  if (setup.status !== 201 && setup.status !== 409) throw new Error(`setup failed with ${setup.status}`);
  const login = await api("/api/admin/login", { method: "POST", json: { password: TEST_PASSWORD } });
  const header = login.headers.get("Set-Cookie");
  if (login.status !== 200 || !header) throw new Error(`login failed with ${login.status}`);
  return { cookie: header.split(";")[0]! };
}

/** Pairs a kassa the way an iPad does: a code from beheer, traded for a token. */
export async function asDevice(name = "iPad"): Promise<{ token: string; deviceId: string }> {
  const { cookie } = await asAdmin();
  const created = await api("/api/admin/pairing-codes", { method: "POST", cookie });
  const { code } = await created.json<{ code: string }>();
  const paired = await api("/api/pair", { method: "POST", json: { code, name } });
  if (paired.status !== 201) throw new Error(`pairing failed with ${paired.status}`);
  return paired.json();
}

/** A cash sale as the kassa sends it: one Aardbeitje, sold now, unless overridden. */
export function cashSale(overrides: Partial<CashSaleInput> = {}): CashSaleInput {
  return {
    id: crypto.randomUUID(),
    kind: "sale",
    soldAt: new Date().toISOString(),
    totalCents: 110,
    cashGivenCents: null,
    lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 1 }],
    ...overrides,
  };
}

export async function postSales(token: string, items: unknown[]): Promise<ItemResult[]> {
  const res = await api("/api/kassa/sales", { method: "POST", token, json: { items } });
  if (res.status !== 200) throw new Error(`sales answered ${res.status}`);
  return (await res.json<{ results: ItemResult[] }>()).results;
}

/**
 * A database that keeps count of its round trips and of the rows it reads, to hold the daily work against
 * the free plan's limits (50 calls per request, 5 million rows read a day).
 */
export function meteredDb(db: D1Database): { db: D1Database; calls: () => number; rowsRead: () => number } {
  let calls = 0;
  let rowsRead = 0;
  const originals = new WeakMap<object, D1PreparedStatement>();
  const note = <T extends { meta: { rows_read?: number } }>(result: T): T => {
    rowsRead += result.meta.rows_read ?? 0;
    return result;
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(statement, {
      get(target, prop) {
        if (prop === "bind") return (...values: unknown[]) => wrap(target.bind(...values));
        if (prop === "all" || prop === "run") {
          return async () => {
            calls++;
            return note(await target[prop]());
          };
        }
        // `first` gives no figures: ask for all rows and hand back the first, which is what it does itself.
        if (prop === "first") {
          return async (column?: string) => {
            calls++;
            const row = note(await target.all<Record<string, unknown>>()).results[0] ?? null;
            return row !== null && column !== undefined ? row[column] : row;
          };
        }
        if (prop === "raw") {
          return (...args: unknown[]) => {
            calls++;
            return (target.raw as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop);
      },
    });
    originals.set(proxy, statement);
    return proxy;
  };
  const metered = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrap(target.prepare(sql));
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          calls++;
          const results = await target.batch(statements.map((statement) => originals.get(statement) ?? statement));
          results.forEach(note);
          return results;
        };
      }
      return Reflect.get(target, prop);
    },
  });
  return { db: metered, calls: () => calls, rowsRead: () => rowsRead };
}

/** Chooses the fake Mollie's test terminal in beheer, so that pin is ready. Needs `useFakeMollie` in the test file. */
export async function chooseTestTerminal(): Promise<void> {
  const { cookie } = await asAdmin();
  const answer = await api("/api/admin/pin/terminal", { method: "POST", cookie, json: { terminalId: "term_test" } });
  if (answer.status !== 200) throw new Error(`choosing the terminal answered ${answer.status}`);
}

/** A receipt as the kassa sends it to pay by pin: one Aardbeitje, rung up now, unless overridden. */
export function pinSale(overrides: Partial<PinSaleInput> = {}): PinSaleInput {
  return {
    id: crypto.randomUUID(),
    soldAt: new Date().toISOString(),
    totalCents: 110,
    lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 1 }],
    ...overrides,
  };
}

/** Starts a pin payment the way the kassa does. */
export async function startPinSale(token: string, sale: PinSaleInput): Promise<PinStatus> {
  const res = await api("/api/kassa/pin", { method: "POST", token, json: sale });
  if (res.status !== 200) throw new Error(`pin start answered ${res.status}`);
  return res.json();
}

/** Asks where a pin payment stands, the way the kassa does every second. */
export async function pinStatusOf(token: string, id: string): Promise<PinStatus> {
  const res = await api(`/api/kassa/pin/${id}`, { token });
  if (res.status !== 200) throw new Error(`pin status answered ${res.status}`);
  return res.json();
}

/** Calls the webhook the way Mollie does: a form with only the payment's id. */
export function webhook(paymentId: string): Promise<Response> {
  return api("/api/mollie/webhook", { method: "POST", form: { id: paymentId } });
}
