import { env } from "cloudflare:workers";
import type { CashSaleInput } from "../shared/schemas";
import type { ItemResult } from "../shared/types";
import { app } from "../worker/app";

export const TEST_PASSWORD = "test-wachtwoord-123";
export const TEST_SETUP_TOKEN = "test-setup-token";

type ApiInit = {
  method?: string;
  json?: unknown;
  cookie?: string;
  token?: string;
  headers?: Record<string, string>;
};

/** Calls the Worker the way the app does: the csrf header on writes, a cookie for beheer, a bearer token for the kassa. */
export async function api(path: string, init: ApiInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["X-Requested-With"] = "kassa";
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.cookie) headers["Cookie"] = init.cookie;
  if (init.token) headers["Authorization"] = `Bearer ${init.token}`;
  Object.assign(headers, init.headers);
  const body = init.json === undefined ? undefined : JSON.stringify(init.json);
  return app.request(path, { method, headers, body }, env);
}

// Children before parents, so no foreign key is left dangling.
const TABLES = [
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

/** Empties every table and puts the start assortment back. */
export async function resetData(): Promise<void> {
  const seed = env.TEST_MIGRATIONS.find((migration) => migration.name === "0002_seed.sql");
  if (!seed) throw new Error("migration 0002_seed.sql not found");
  await env.DB.batch([
    ...TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
    ...seed.queries.map((query) => env.DB.prepare(query)),
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
