import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { ENABLE_BANKING_API, enableBankingFor, signJwt } from "../worker/lib/enable-banking";
import { TEST_EB_APP_ID, testRsaKey, useFakeEnableBanking } from "./helpers";

const eb = useFakeEnableBanking();
const client = async (over: Record<string, string> = {}) => {
  const { pem } = await testRsaKey();
  return enableBankingFor({ ...env, ENABLE_BANKING_APP_ID: TEST_EB_APP_ID, ENABLE_BANKING_PRIVATE_KEY: pem, ...over })!;
};

it("signs its requests with the application's key", async () => {
  const result = await (await client()).maxConsentDays();
  expect(result.ok).toBe(true); // the fake verified the signature, or it would have answered 401
  const { header, claims } = eb.current.requests[0]!.jwt!;
  expect(header).toEqual({ typ: "JWT", alg: "RS256", kid: TEST_EB_APP_ID });
  expect(claims.iss).toBe("enablebanking.com");
  expect(claims.aud).toBe("api.enablebanking.com");
  expect(claims.exp - claims.iat).toBe(3600);
});

it("rejects a request signed with another key", async () => {
  const other = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign"])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", other.privateKey)) as ArrayBuffer);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
  const result = await (await client({ ENABLE_BANKING_PRIVATE_KEY: pem })).maxConsentDays();
  expect(result).toEqual({ ok: false, failure: "unauthorized", status: 401 });
});

it("refuses a PKCS#1 key with a clear code", async () => {
  await expect(signJwt("app", "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----", new Date())).rejects.toThrow("key_format");
});

it("reads the longest consent ING allows, in whole days", async () => {
  expect(await (await client()).maxConsentDays()).toEqual({ ok: true, data: 180 }); // 15552000 s + 1 h, floored
  expect(eb.current.requests[0]).toMatchObject({ method: "GET", path: "/aspsps", query: { country: "NL" } });
  eb.current.aspsps = eb.current.aspsps.filter((a) => a.name !== "ING");
  expect(await (await client()).maxConsentDays()).toMatchObject({ ok: false, failure: "refused" });
});

it("asks ING for consent with the longest validity allowed", async () => {
  const result = await (await client()).startAuth({ validUntil: "2027-06-01T12:00:00.000Z", redirectUrl: "https://kassa.example/beheer", state: "st-1" });
  expect(result).toEqual({ ok: true, data: { url: "https://fake.enablebanking.test/auth?state=st-1" } });
  expect(eb.current.requests[0]!.body).toEqual({
    access: { valid_until: "2027-06-01T12:00:00.000Z" },
    aspsp: { name: "ING", country: "NL" },
    psu_type: "business",
    state: "st-1",
    redirect_url: "https://kassa.example/beheer",
  });
});

it("turns the code into a session with its accounts", async () => {
  expect(await (await client()).createSession("code-1")).toEqual({
    ok: true,
    data: { sessionId: "session-1", validUntil: "2027-06-01T12:00:00+00:00", accounts: [{ uid: "acc-1", iban: "NL02INGB0000000001" }, { uid: "acc-2", iban: null }] },
  });
  expect(await (await client()).createSession("bad-code")).toMatchObject({ ok: false, failure: "refused", status: 422 });
});

it("reads every page of transactions as bank lines", async () => {
  const result = await (await client()).transactions("acc-1", "2027-01-01");
  expect(eb.current.requests.map((r) => r.query.continuation_key)).toEqual([undefined, "2", "4"]);
  expect(eb.current.requests[0]!.query.date_from).toBe("2027-01-01");
  expect(result).toEqual({
    ok: true,
    data: [
      { bookingDate: "2027-03-01", amountCents: 1250, description: "Contributie maart", counterpartyName: "Jansen", counterpartyIban: "NL91ABNA0417164300", bankRef: "ref-1" },
      { bookingDate: "2027-03-02", amountCents: -10005, description: "Factuur 12", counterpartyName: "Bakker BV", counterpartyIban: "NL86INGB0002445588", bankRef: "ref-2" },
      { bookingDate: "2027-03-04", amountCents: 50, description: "", counterpartyName: null, counterpartyIban: null, bankRef: "tid-4" },
      { bookingDate: "2027-03-05", amountCents: -2000, description: "Kantoor", counterpartyName: null, counterpartyIban: null, bankRef: "ref-5" },
      { bookingDate: "2027-03-06", amountCents: 700, description: "", counterpartyName: "Pietersen", counterpartyIban: null, bankRef: "ref-6" },
    ],
  });
});

it("ignores a pending transaction", async () => {
  const result = await (await client()).transactions("acc-1", "2027-01-01");
  expect(result.ok && result.data.some((line) => line.description === "wacht")).toBe(false);
});

it("never returns the same bank reference twice in one call", async () => {
  eb.current.transactions.push({ ...eb.current.transactions[0]!, transaction_amount: { currency: "EUR", amount: "99.00" } });
  const result = await (await client()).transactions("acc-1", "2027-01-01");
  expect(result.ok && result.data.filter((line) => line.bankRef === "ref-1")).toEqual([expect.objectContaining({ amountCents: 1250 })]);
});

it("stops at 20 pages", async () => {
  eb.current.transactions = Array.from({ length: 60 }, (_, i) => ({
    entry_reference: `r${i}`,
    status: "BOOK",
    booking_date: "2027-03-01",
    transaction_amount: { currency: "EUR", amount: "1.00" },
    credit_debit_indicator: "CRDT",
  }));
  const result = await (await client()).transactions("acc-1", "2027-01-01");
  expect(eb.current.requests).toHaveLength(20);
  expect(result.ok && result.data).toHaveLength(40);
});

it("reads the closing booked balance, else the interim booked one", async () => {
  expect(await (await client()).balance("acc-1")).toEqual({ ok: true, data: { date: "2027-03-04", cents: 100000 } });
  eb.current.balances = eb.current.balances.filter((b) => b.balance_type !== "CLBD");
  expect(await (await client()).balance("acc-1")).toEqual({ ok: true, data: { date: "2027-03-05", cents: 123456 } });
  eb.current.balances = [];
  expect(await (await client()).balance("acc-1")).toEqual({ ok: true, data: null });
});

it("tells a refusal from no answer", async () => {
  const c = await client();
  eb.current.failNext(401);
  expect(await c.maxConsentDays()).toEqual({ ok: false, failure: "unauthorized", status: 401 });
  eb.current.failNext(422);
  expect(await c.maxConsentDays()).toEqual({ ok: false, failure: "refused", status: 422 });
  expect(await c.balance("nope")).toEqual({ ok: false, failure: "not_found", status: 404 });
  eb.current.failNext(500);
  expect(await c.maxConsentDays()).toEqual({ ok: false, failure: "unreachable", status: 500 });
  eb.current.failNext("timeout");
  expect(await c.maxConsentDays()).toEqual({ ok: false, failure: "unreachable", status: 0 });
});

it("treats an expired session as unauthorized, whatever the status", async () => {
  eb.current.expireSession();
  expect(await (await client()).transactions("acc-1", "2027-01-01")).toEqual({ ok: false, failure: "unauthorized", status: 401 });
});

it("has no client without the key", async () => {
  const { pem } = await testRsaKey();
  expect(enableBankingFor({ ...env, ENABLE_BANKING_APP_ID: undefined, ENABLE_BANKING_PRIVATE_KEY: pem })).toBeNull();
  expect(enableBankingFor({ ...env, ENABLE_BANKING_APP_ID: "x", ENABLE_BANKING_PRIVATE_KEY: undefined })).toBeNull();
});

it("only honours another address when it is this computer", async () => {
  const urls: string[] = [];
  const inner = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(new Request(input, init).url);
    return inner(input, init);
  });
  await (await client({ ENABLE_BANKING_API_BASE: "https://evil.example" })).maxConsentDays();
  await (await client({ ENABLE_BANKING_API_BASE: "http://localhost:9999/" })).maxConsentDays();
  expect(urls).toEqual(["https://api.enablebanking.com/aspsps?country=NL", "http://localhost:9999/aspsps?country=NL"]);
});

it("fails the whole call when a later page fails", async () => {
  const c = await client();
  const inner = globalThis.fetch;
  let calls = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => (++calls === 2 ? Promise.reject(new Error("down")) : inner(input, init)));
  expect(await c.transactions("acc-1", "2027-01-01")).toEqual({ ok: false, failure: "unreachable", status: 0 });
});
