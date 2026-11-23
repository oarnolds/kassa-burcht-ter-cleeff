import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { ConsentState } from "../worker/db/bank-consent";
import { consentState, fetchIng, finishConsent, startConsent } from "../worker/db/bank-consent";
import { overview } from "../worker/db/ledger-reports";
import { exportAll } from "../worker/db/maintenance";
import type { Env } from "../worker/env";
import { runNightly } from "../worker/nightly";
import { api, asAdmin, resetData, TEST_EB_APP_ID, testRsaKey, useFakeEnableBanking } from "./helpers";

const eb = useFakeEnableBanking();
const base = "/api/admin/boekhouding";
const NOW = new Date("2027-03-01T12:00:00.000Z");
const ORIGIN = "https://beheer.example";
const IBAN = "NL02INGB0000000001";

let ebEnv: Env;
let cookie: string;
let pem: string;

beforeEach(async () => {
  await resetData();
  cookie = (await asAdmin()).cookie;
  pem = (await testRsaKey()).pem;
  ebEnv = { ...env, ENABLE_BANKING_APP_ID: TEST_EB_APP_ID, ENABLE_BANKING_PRIVATE_KEY: pem };
  await env.DB.prepare("UPDATE money_accounts SET identifier = ? WHERE account_code = '1010'").bind("nl02 ingb 0000 0000 01").run();
});

const stateOf = async () => (await env.DB.prepare("SELECT state FROM bank_consents ORDER BY created_at DESC, rowid DESC").first<{ state: string }>())!.state;
const consents = () => env.DB.prepare("SELECT status, session_id, account_uid, valid_until, used_at FROM bank_consents ORDER BY rowid").all<Record<string, string | null>>();
const sessionCalls = () => eb.current.requests.filter((r) => r.path === "/sessions").length;
const source = async () => (await env.DB.prepare("SELECT source FROM money_accounts WHERE account_code = '1010'").first<{ source: string }>())!.source;

async function connect(at = NOW): Promise<ConsentState> {
  await startConsent(ebEnv, ORIGIN, at);
  return finishConsent(ebEnv, { code: "code-1", state: await stateOf() }, at);
}

it("sends the penningmeester to ING and back to /beheer/bank", async () => {
  const { url } = await startConsent(ebEnv, ORIGIN, NOW);
  expect(url).toContain("https://fake.enablebanking.test/auth");
  const auth = eb.current.requests.find((r) => r.path === "/auth")!;
  expect(auth.body.redirect_url).toBe(`${ORIGIN}/beheer/bank`);
  expect(auth.body.state).toBe(await stateOf());
  // 180 days (the bank's longest), less an hour, so it never goes over.
  expect(auth.body.access.valid_until).toBe("2027-08-28T11:00:00.000Z");
  expect((await consents()).results).toEqual([{ status: "pending", session_id: null, account_uid: null, valid_until: null, used_at: null }]);
  expect(await consentState(env.DB, NOW)).toEqual({ status: "pending", validUntil: null, daysLeft: null });
});

it("asks for the key and the identifier before it sends anyone to ING", async () => {
  await expect(startConsent({ ...env, ENABLE_BANKING_PRIVATE_KEY: undefined }, ORIGIN, NOW)).rejects.toMatchObject({ code: "enable_banking_off", status: 503 });
  await env.DB.prepare("UPDATE money_accounts SET identifier = NULL WHERE account_code = '1010'").run();
  await expect(startConsent(ebEnv, ORIGIN, NOW)).rejects.toMatchObject({ code: "identifier_missing", status: 409 });
  expect(eb.current.requests).toHaveLength(0);
  const off = await api(`${base}/bank/ing/connect`, { method: "POST", cookie, env: { ENABLE_BANKING_PRIVATE_KEY: undefined } });
  expect(off.status).toBe(503);
  expect(await off.json()).toEqual({ error: "enable_banking_off" });
});

it("connects ING betaal when the bank sends him back", async () => {
  const state = await connect();
  expect(state).toEqual({ status: "active", validUntil: "2027-06-01T12:00:00.000Z", daysLeft: 92 });
  const [row] = (await consents()).results;
  expect(row).toMatchObject({ status: "active", session_id: "session-1", account_uid: "acc-1" });
  expect(await source()).toBe("enable_banking");
  expect(await consentState(env.DB, NOW)).toEqual(state);
});

it("lets a new consent replace the old one", async () => {
  await connect();
  await connect(new Date("2027-03-02T12:00:00.000Z"));
  expect((await consents()).results.map((r) => r.status)).toEqual(["replaced", "active"]);
});

it("refuses the return page a second time, and keeps the connection", async () => {
  await startConsent(ebEnv, ORIGIN, NOW);
  const state = await stateOf();
  await finishConsent(ebEnv, { code: "code-1", state }, NOW);
  await expect(finishConsent(ebEnv, { code: "code-1", state }, NOW)).rejects.toMatchObject({ code: "state_invalid", status: 409 });
  expect(sessionCalls()).toBe(1);
  expect((await consents()).results.map((r) => r.status)).toEqual(["active"]);
  expect((await consentState(env.DB, NOW)).status).toBe("active");

  // The same through the route, with the address of the page.
  const { url } = await (await api(`${base}/bank/ing/connect`, { method: "POST", cookie, env: { ENABLE_BANKING_PRIVATE_KEY: pem, ENABLE_BANKING_APP_ID: TEST_EB_APP_ID } })).json<{ url: string }>();
  expect(url).toContain("https://fake.enablebanking.test/auth");
  const fresh = new URL(url).searchParams.get("state")!;
  const envOver = { ENABLE_BANKING_PRIVATE_KEY: pem, ENABLE_BANKING_APP_ID: TEST_EB_APP_ID };
  const first = await api(`${base}/bank/ing/callback`, { method: "POST", cookie, json: { code: "code-2", state: fresh }, env: envOver });
  expect(first.status).toBe(200);
  const second = await api(`${base}/bank/ing/callback`, { method: "POST", cookie, json: { code: "code-2", state: fresh }, env: envOver });
  expect(second.status).toBe(409);
  expect(await second.json()).toEqual({ error: "state_invalid" });
  expect(sessionCalls()).toBe(2);
});

it("refuses a state it did not make, or an old one", async () => {
  await expect(finishConsent(ebEnv, { code: "code-1", state: "made-up" }, NOW)).rejects.toMatchObject({ code: "state_invalid", status: 409 });
  await startConsent(ebEnv, ORIGIN, NOW);
  const state = await stateOf();
  await expect(finishConsent(ebEnv, { code: "code-1", state }, new Date(NOW.getTime() + 31 * 60_000))).rejects.toMatchObject({ code: "state_invalid", status: 409 });
  expect(sessionCalls()).toBe(0);
  expect(await consentState(env.DB, new Date(NOW.getTime() + 31 * 60_000))).toEqual({ status: "none", validUntil: null, daysLeft: null });
  const bad = await api(`${base}/bank/ing/callback`, { method: "POST", cookie, json: { code: "", state: "" }, env: { ENABLE_BANKING_PRIVATE_KEY: pem, ENABLE_BANKING_APP_ID: TEST_EB_APP_ID } });
  expect(bad.status).toBe(400);
});

it("refuses a consent without the ING betaal account", async () => {
  await env.DB.prepare("UPDATE money_accounts SET identifier = 'NL99INGB0000000099' WHERE account_code = '1010'").run();
  await startConsent(ebEnv, ORIGIN, NOW);
  await expect(finishConsent(ebEnv, { code: "code-1", state: await stateOf() }, NOW)).rejects.toMatchObject({ code: "account_not_in_consent", status: 409 });
  expect(await source()).toBe("file");
  expect((await consentState(env.DB, NOW)).status).toBe("none");
});

it("fetches new lines at night and books kasstortings", async () => {
  await connect();
  eb.current.transactions = [
    { entry_reference: "ref-k", transaction_id: null, status: "BOOK", booking_date: "2027-03-05", transaction_amount: { currency: "EUR", amount: "250.00" }, credit_debit_indicator: "CRDT", remittance_information: ["Kasstorting maart"] },
    { entry_reference: "ref-x", transaction_id: null, status: "BOOK", booking_date: "2027-03-04", transaction_amount: { currency: "EUR", amount: "20.00" }, credit_debit_indicator: "DBIT", creditor: { name: "Bakker" }, remittance_information: ["Factuur"] },
  ];
  expect(await fetchIng(ebEnv, NOW)).toBe("ok");
  const lines = await env.DB.prepare("SELECT origin, status, amount_cents FROM bank_lines WHERE account_code = '1010' ORDER BY amount_cents").all();
  expect(lines.results).toEqual([
    { origin: "enable_banking", status: "open", amount_cents: -2000 },
    { origin: "enable_banking", status: "booked", amount_cents: 25000 },
  ]);
  expect(eb.current.requests.find((r) => r.path === "/accounts/acc-1/transactions")!.query.date_from).toBe("2027-01-01");
  expect(await env.DB.prepare("SELECT date, balance_cents, origin FROM bank_balances WHERE account_code = '1010'").all()).toMatchObject({
    results: [{ date: "2027-03-04", balance_cents: 100000, origin: "enable_banking" }],
  });
  // The next night looks back a week from the newest line.
  eb.current.requests = [];
  expect(await fetchIng(ebEnv, new Date("2027-03-06T02:00:00.000Z"))).toBe("ok");
  expect(eb.current.requests.find((r) => r.path === "/accounts/acc-1/transactions")!.query.date_from).toBe("2027-02-26");
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM bank_lines").first<{ n: number }>())!.n).toBe(2);
});

it("fetches nothing when 1010 is set to files, or there is no consent", async () => {
  expect(await fetchIng(ebEnv, NOW)).toBe("skipped");
  await connect();
  await env.DB.prepare("UPDATE money_accounts SET source = 'file' WHERE account_code = '1010'").run();
  eb.current.requests = [];
  expect(await fetchIng(ebEnv, NOW)).toBe("skipped");
  expect(eb.current.requests).toHaveLength(0);
  // Source on, but the consent is past its end.
  await env.DB.prepare("UPDATE money_accounts SET source = 'enable_banking' WHERE account_code = '1010'").run();
  expect(await fetchIng(ebEnv, new Date("2027-06-02T02:00:00.000Z"))).toBe("skipped");
  expect(eb.current.requests).toHaveLength(0);
  // No key while the source says Enable Banking.
  expect(await fetchIng({ ...env, ENABLE_BANKING_PRIVATE_KEY: undefined }, NOW)).toBe("enable_banking_off");
});

it("notices that the consent ran out", async () => {
  await connect();
  eb.current.expireSession();
  expect(await runNightly(ebEnv, new Date("2027-03-02T02:00:00.000Z"))).toMatchObject({ steps: { ing: "consent_expired" } });
  expect((await consents()).results.map((r) => r.status)).toEqual(["expired"]);
  expect(await consentState(env.DB, NOW)).toEqual({ status: "expired", validUntil: "2027-06-01T12:00:00.000Z", daysLeft: 92 });
  // Next night nothing is asked any more.
  eb.current.requests = [];
  expect(await fetchIng(ebEnv, new Date("2027-03-03T02:00:00.000Z"))).toBe("skipped");
  expect(eb.current.requests).toHaveLength(0);
});

it("gives other failures by name, without a message", async () => {
  await connect();
  eb.current.failNext(500);
  expect(await fetchIng(ebEnv, NOW)).toBe("unreachable");
  expect((await consents()).results.map((r) => r.status)).toEqual(["active"]);
});

it("warns two weeks before the consent ends", async () => {
  await connect();
  expect((await overview(env.DB, new Date("2027-05-18T12:00:00.000Z"))).consent).toEqual({ validUntil: "2027-06-01T12:00:00.000Z", daysLeft: 14 });
  expect((await overview(env.DB, new Date("2027-06-02T12:00:00.000Z"))).consent).toMatchObject({ daysLeft: -1 });
});

it("shows no consent in the overview when there is none", async () => {
  expect((await overview(env.DB, NOW)).consent).toBeNull();
  await startConsent(ebEnv, ORIGIN, NOW);
  expect((await overview(env.DB, NOW)).consent).toBeNull();
});

it("keeps the session id out of the copy and out of the answers", async () => {
  await connect();
  const file = await exportAll(env.DB, NOW);
  const rows = file.ledger.bank_consents as Record<string, unknown>[];
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ status: "active", account_uid: "acc-1" });
  expect(Object.keys(rows[0]!)).not.toContain("session_id");
  expect(JSON.stringify(file)).not.toContain("session-1");
  const answer = await api(`${base}/bank/ing`, { cookie });
  expect(answer.status).toBe(200);
  expect(JSON.stringify(await answer.json())).not.toContain("session-1");
});

it("is for the penningmeester only", async () => {
  for (const [method, path] of [["GET", "/bank/ing"], ["POST", "/bank/ing/connect"], ["POST", "/bank/ing/callback"]] as const) {
    expect((await api(`${base}${path}`, { method })).status, path).toBe(401);
  }
});
