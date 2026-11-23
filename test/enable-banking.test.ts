import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { ENABLE_BANKING_API, enableBankingFor, signJwt } from "../worker/lib/enable-banking";
import { TEST_EB_APP_ID, testRsaKey, useFakeEnableBanking } from "./helpers";

const eb = useFakeEnableBanking();
/** A window over all of 2027: every line of the fake. */
const YEAR = { from: "2027-01-01", to: "2027-12-31" };
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

it("reads every page of transactions in a window as bank lines", async () => {
  const result = await (await client()).transactions("acc-1", YEAR, 10);
  expect(eb.current.requests.map((r) => r.query.continuation_key)).toEqual([undefined, "2", "4"]);
  expect(eb.current.requests.map((r) => [r.query.date_from, r.query.date_to])).toEqual([
    ["2027-01-01", "2027-12-31"],
    ["2027-01-01", "2027-12-31"],
    ["2027-01-01", "2027-12-31"],
  ]);
  expect(result).toEqual({
    ok: true,
    data: {
      lines: [
        { bookingDate: "2027-03-01", amountCents: 1250, description: "Contributie maart", counterpartyName: "Jansen", counterpartyIban: "NL91ABNA0417164300", bankRef: "ref-1" },
        { bookingDate: "2027-03-02", amountCents: -10005, description: "Factuur 12", counterpartyName: "Bakker BV", counterpartyIban: "NL86INGB0002445588", bankRef: "ref-2" },
        { bookingDate: "2027-03-04", amountCents: 50, description: "", counterpartyName: null, counterpartyIban: null, bankRef: "tid-4" },
        { bookingDate: "2027-03-05", amountCents: -2000, description: "Kantoor", counterpartyName: null, counterpartyIban: null, bankRef: "ref-5" },
        { bookingDate: "2027-03-06", amountCents: 700, description: "", counterpartyName: "Pietersen", counterpartyIban: null, bankRef: "ref-6" },
      ],
      complete: true,
      pages: 3,
    },
  });
  // Only the days asked for.
  eb.current.requests = [];
  const window = await (await client()).transactions("acc-1", { from: "2027-03-02", to: "2027-03-04" }, 10);
  expect(window.ok && window.data.lines.map((line) => line.bankRef)).toEqual(["ref-2", "tid-4"]);
  expect(eb.current.requests[0]!.query).toMatchObject({ date_from: "2027-03-02", date_to: "2027-03-04" });
});

it("ignores a pending transaction", async () => {
  const result = await (await client()).transactions("acc-1", YEAR, 10);
  expect(result.ok && result.data.lines.some((line) => line.description === "wacht")).toBe(false);
});

it("never returns the same bank reference twice in one call", async () => {
  eb.current.transactions.push({ ...eb.current.transactions[0]!, transaction_amount: { currency: "EUR", amount: "99.00" } });
  const result = await (await client()).transactions("acc-1", YEAR, 10);
  expect(result.ok && result.data.lines.filter((line) => line.bankRef === "ref-1")).toEqual([expect.objectContaining({ amountCents: 1250 })]);
});

it("stops at the pages it may ask for, and says the window was cut short", async () => {
  eb.current.transactions = Array.from({ length: 60 }, (_, i) => ({
    entry_reference: `r${i}`,
    status: "BOOK",
    booking_date: "2027-03-01",
    transaction_amount: { currency: "EUR", amount: "1.00" },
    credit_debit_indicator: "CRDT",
  }));
  const result = await (await client()).transactions("acc-1", YEAR, 10);
  expect(eb.current.requests).toHaveLength(10);
  expect(result.ok && [result.data.lines.length, result.data.complete, result.data.pages]).toEqual([20, false, 10]);
  eb.current.requests = [];
  const fewer = await (await client()).transactions("acc-1", YEAR, 3);
  expect(eb.current.requests).toHaveLength(3);
  expect(fewer.ok && [fewer.data.complete, fewer.data.pages]).toEqual([false, 3]);
  // Exactly as many pages as there are: complete.
  eb.current.transactions = eb.current.transactions.slice(0, 6);
  const all = await (await client()).transactions("acc-1", YEAR, 3);
  expect(all.ok && [all.data.lines.length, all.data.complete, all.data.pages]).toEqual([6, true, 3]);
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
  expect(await (await client()).transactions("acc-1", YEAR, 10)).toEqual({ ok: false, failure: "unauthorized", status: 401 });
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
  expect(await c.transactions("acc-1", YEAR, 10)).toEqual({ ok: false, failure: "unreachable", status: 0 });
});

it("treats a gone consent as unauthorized, whatever the status", async () => {
  const c = await client();
  eb.current.failNext(403, "REVOKED_SESSION");
  expect(await c.transactions("acc-1", YEAR, 10)).toEqual({ ok: false, failure: "unauthorized", status: 403 });
  eb.current.failNext(422, "CLOSED_SESSION");
  expect(await c.balance("acc-1")).toEqual({ ok: false, failure: "unauthorized", status: 422 });
  eb.current.expireSession(408);
  expect(await c.balance("acc-1")).toEqual({ ok: false, failure: "unauthorized", status: 408 });
});

it("keeps another 422 a refusal", async () => {
  eb.current.failNext(422, "WRONG_REQUEST_PARAMETERS");
  expect(await (await client()).balance("acc-1")).toEqual({ ok: false, failure: "refused", status: 422 });
});

const booked = (over: Record<string, unknown>) => ({
  entry_reference: "x1",
  status: "BOOK",
  booking_date: "2027-03-01",
  transaction_amount: { currency: "EUR", amount: "1.00" },
  credit_debit_indicator: "CRDT",
  ...over,
});

it("falls back from booking_date to value_date, then transaction_date", async () => {
  eb.current.transactions = [
    booked({ entry_reference: "a", booking_date: null, value_date: "2027-04-01", transaction_date: "2027-05-01" }),
    booked({ entry_reference: "b", booking_date: null, transaction_date: "2027-05-02" }),
  ];
  const result = await (await client()).transactions("acc-1", YEAR, 10);
  expect(result.ok && result.data.lines.map((line) => line.bookingDate)).toEqual(["2027-04-01", "2027-05-02"]);
});

it("accepts trailing zero decimals but not extra digits", async () => {
  eb.current.transactions = [booked({ transaction_amount: { currency: "EUR", amount: "12.500" } })];
  const ok = await (await client()).transactions("acc-1", YEAR, 10);
  expect(ok.ok && ok.data.lines[0]!.amountCents).toBe(1250);
  eb.current.transactions = [booked({ transaction_amount: { currency: "EUR", amount: "12.505" } })];
  expect(await (await client()).transactions("acc-1", YEAR, 10)).toEqual({ ok: false, failure: "unreadable", status: 0 });
});

it("fails the call on a booked line it cannot read, instead of losing it", async () => {
  for (const bad of [
    booked({ booking_date: null, value_date: null, transaction_date: null }),
    booked({ credit_debit_indicator: undefined }),
    booked({ transaction_amount: undefined }),
  ]) {
    eb.current.transactions = [booked({ entry_reference: "fine" }), bad];
    expect(await (await client()).transactions("acc-1", YEAR, 10)).toEqual({ ok: false, failure: "unreadable", status: 0 });
  }
});
