import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { Catalog, PinSettings } from "../shared/types";
import { chosenTerminal } from "../worker/db/pin-settings";
import { getCatalog } from "../worker/db/products";
import type { Env } from "../worker/env";
import { api, asAdmin, asDevice, chooseTestTerminal, meteredDb, resetData, useFakeMollie } from "./helpers";

const mollie = useFakeMollie();
let cookie: string;
let token: string;

beforeEach(async () => {
  await resetData();
  ({ cookie } = await asAdmin());
  ({ token } = await asDevice());
});

const noKey: Partial<Env> = { MOLLIE_API_KEY: undefined };
const settings = async (over?: Partial<Env>) => (await api("/api/admin/pin", { cookie, env: over })).json<PinSettings>();
const choose = (terminalId: unknown, over?: Partial<Env>) => api("/api/admin/pin/terminal", { method: "POST", cookie, json: { terminalId }, env: over });
const catalogPin = async (over?: Partial<Env>) => (await (await api("/api/kassa/catalog", { token, env: over })).json<Catalog>()).pin;
const stored = async () => (await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'mollie_%' ORDER BY key").all()).results;

it("shows Mollie's terminals and stores the one that is chosen", async () => {
  mollie.current.terminals.push({ id: "term_kiosk", description: "Kiosk", status: "active", brand: "PAX", model: "A920", serialNumber: "123" });
  expect(await settings()).toEqual({ mode: "test", terminalId: null, terminals: mollie.current.terminals, problem: null });
  expect(await catalogPin()).toEqual({ mode: "test", ready: false });

  const answer = await choose("term_kiosk");
  expect(answer.status).toBe(200);
  expect(await answer.json()).toEqual({ ok: true });
  expect((await settings()).terminalId).toBe("term_kiosk");
  expect(await catalogPin()).toEqual({ mode: "test", ready: true });

  expect((await choose(null)).status).toBe(200);
  expect((await settings()).terminalId).toBeNull();
  expect(await catalogPin()).toEqual({ mode: "test", ready: false });
});

it("refuses a terminal Mollie does not list and one that is not active", async () => {
  mollie.current.terminals.push({ id: "term_nieuw", description: "Nog niet aangesloten", status: "pending", brand: "PAX", model: "A35", serialNumber: null });
  const unknown = await choose("term_nope");
  expect(unknown.status).toBe(409);
  expect(await unknown.json()).toEqual({ error: "unknown_terminal" });
  const pending = await choose("term_nieuw");
  expect(pending.status).toBe(409);
  expect(await pending.json()).toEqual({ error: "terminal_not_active" });
  const invalid = await choose(5);
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({ error: "invalid" });
  expect(await stored()).toEqual([]);
});

it("says what is wrong when Mollie cannot be asked", async () => {
  expect(await settings(noKey)).toEqual({ mode: null, terminalId: null, terminals: [], problem: "no_key" });
  const refused = await choose("term_test", noKey);
  expect(refused.status).toBe(503);
  expect(await refused.json()).toEqual({ error: "no_key" });
  expect(await catalogPin(noKey)).toEqual({ mode: null, ready: false });

  await chooseTestTerminal();
  mollie.current.failNext(401);
  expect(await settings()).toEqual({ mode: "test", terminalId: "term_test", terminals: [], problem: "unauthorized" });
  mollie.current.failNext(500);
  expect(await settings()).toEqual({ mode: "test", terminalId: "term_test", terminals: [], problem: "unreachable" });

  mollie.current.failNext(401);
  const badKey = await choose("term_test");
  expect(badKey.status).toBe(503);
  expect(await badKey.json()).toEqual({ error: "unauthorized" });
  mollie.current.failNext("timeout");
  const silent = await choose("term_test");
  expect(silent.status).toBe(503);
  expect(await silent.json()).toEqual({ error: "unreachable" });
});

it("does not use a test terminal for real payments (Review Focus 5)", async () => {
  await chooseTestTerminal();
  expect(await catalogPin()).toEqual({ mode: "test", ready: true });
  expect(await catalogPin({ MOLLIE_API_KEY: "live_fake" })).toEqual({ mode: "live", ready: false });
  expect(await chosenTerminal(env.DB, "live")).toBeNull();
  expect(await chosenTerminal(env.DB, "test")).toBe("term_test");
  expect((await settings({ MOLLIE_API_KEY: "live_fake" })).terminalId).toBeNull();

  // Chosen again with the live key, the terminal counts for real payments and no longer for test ones.
  expect((await choose("term_test", { MOLLIE_API_KEY: "live_fake" })).status).toBe(200);
  expect(await catalogPin({ MOLLIE_API_KEY: "live_fake" })).toEqual({ mode: "live", ready: true });
  expect(await catalogPin()).toEqual({ mode: "test", ready: false });
});

it("keeps the chosen terminal when the trial data is wiped", async () => {
  await chooseTestTerminal();
  const wiped = await api("/api/admin/wipe-trial", { method: "POST", cookie, json: { confirm: "WISSEN" } });
  expect(wiped.status).toBe(200);
  expect(await catalogPin()).toEqual({ mode: "test", ready: true });
});

it("keeps the terminal choice behind the beheer login", async () => {
  expect((await api("/api/admin/pin")).status).toBe(401);
  expect((await api("/api/admin/pin", { token })).status).toBe(401);
  expect((await api("/api/admin/pin/terminal", { method: "POST", json: { terminalId: "term_test" } })).status).toBe(401);
  expect((await api("/api/admin/pin/terminal", { method: "POST", token, json: { terminalId: "term_test" } })).status).toBe(401);
  expect(await stored()).toEqual([]);
});

it("fetches the catalog in one database round trip, pin included", async () => {
  await chooseTestTerminal();
  const metered = meteredDb(env.DB);
  const catalog = await getCatalog(metered.db, new Date(), "test");
  expect(catalog.pin).toEqual({ mode: "test", ready: true });
  expect(metered.calls()).toBe(1);
});
