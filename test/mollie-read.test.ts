import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import { getLedgerSetting } from "../worker/db/ledger-settings";
import { mollieFor } from "../worker/lib/mollie";
import { mollieReadFor } from "../worker/lib/mollie-read";
import { resetData, useFakeMollie } from "./helpers";

const mollie = useFakeMollie();
beforeEach(resetData);
const read = (over: Record<string, string | undefined> = {}) => mollieReadFor({ ...env, MOLLIE_ORG_TOKEN: "org_fake", ...over })!;
const lists = () => mollie.current.requests.filter((r) => r.path !== "/v2/profiles");

it("reads payments of every method since a moment", async () => {
  const fake = mollie.current;
  fake.addPayment({ id: "tr_old", method: "ideal", amount: "5.00", createdAt: "2027-01-01T10:00:00+00:00" });
  fake.addPayment({ id: "tr_ideal", method: "ideal", amount: "12.50", description: "Lidgeld", status: "paid", createdAt: "2027-02-02T10:00:00+00:00", paidAt: "2027-02-02T10:01:00+00:00", settlementId: "stl_1" });
  fake.addPayment({ id: "tr_pin", method: "pointofsale", amount: "3.00", status: "open", createdAt: "2027-02-03T10:00:00+00:00" });
  const result = await read().paymentsSince("2027-02-01T00:00:00.000Z");
  expect(result).toEqual({
    ok: true,
    data: [
      { id: "tr_pin", method: "pointofsale", amountCents: 300, description: "Test", status: "open", paidAt: null, settlementId: null },
      { id: "tr_ideal", method: "ideal", amountCents: 1250, description: "Lidgeld", status: "paid", paidAt: "2027-02-02T10:01:00+00:00", settlementId: "stl_1" },
    ],
  });
  const request = lists()[0]!;
  expect(request).toMatchObject({ method: "GET", path: "/v2/payments", authorization: "Bearer org_fake" });
  expect(request.query).toMatchObject({ limit: "250", profileId: "pfl_fake" });
});

it("adds up a payout's costs from its periods", async () => {
  mollie.current.addSettlement({
    id: "stl_1",
    reference: "1234567.2702.01",
    status: "paidout",
    settledAt: "2027-02-10T00:00:00+00:00",
    amount: "97.83",
    costs: { "2027": { "01": ["1.88"], "02": ["0.29"] } },
  });
  const result = await read().settlementsSince("2027-02-01T00:00:00.000Z");
  expect(result).toEqual({
    ok: true,
    data: [{ id: "stl_1", reference: "1234567.2702.01", status: "paidout", settledAt: "2027-02-10T00:00:00+00:00", amountCents: 9783, costsCents: 217 }],
  });
});

it("sums costs of four decimals exactly and rounds once, away from zero", async () => {
  // 0.0049 + 0.0049 = 0.0098 -> 1 cent; rounding each first would give 0
  mollie.current.addSettlement({ id: "stl_a", amount: "-12.34", settledAt: null, status: "open", costs: { "2027": { "01": ["0.0049", "0.0049"] } } });
  mollie.current.addSettlement({ id: "stl_b", amount: "10.00", settledAt: null, status: "open", costs: { "2027": { "01": ["-43.2000", "-0.0050"] } } });
  const result = await read().settlementsSince("2027-01-01T00:00:00.000Z");
  expect(result.ok && result.data.map((s) => [s.id, s.amountCents, s.costsCents])).toEqual([
    ["stl_a", -1234, 1],
    ["stl_b", 1000, -4321], // -43.2050 -> -4321 (half away from zero)
  ]);
});

it("reads refunds and chargebacks", async () => {
  const fake = mollie.current;
  fake.addRefund({ id: "re_old", paymentId: "tr_1", amount: "1.00", createdAt: "2027-01-01T00:00:00+00:00" });
  fake.addRefund({ id: "re_1", paymentId: "tr_2", amount: "4.50", description: "Dubbel betaald", createdAt: "2027-03-01T08:00:00+00:00" });
  fake.addChargeback({ id: "chb_old", paymentId: "tr_1", amount: "9.00", createdAt: "2027-01-01T00:00:00+00:00" });
  fake.addChargeback({ id: "chb_1", paymentId: "tr_3", amount: "20.00", createdAt: "2027-03-02T08:00:00+00:00" });
  expect(await read().refundsSince("2027-02-01T00:00:00.000Z")).toEqual({
    ok: true,
    data: [{ id: "re_1", paymentId: "tr_2", amountCents: 450, createdAt: "2027-03-01T08:00:00+00:00", description: "Dubbel betaald" }],
  });
  expect(await read().chargebacksSince("2027-02-01T00:00:00.000Z")).toEqual({
    ok: true,
    data: [{ id: "chb_1", paymentId: "tr_3", amountCents: 2000, createdAt: "2027-03-02T08:00:00+00:00" }],
  });
  const paths = lists().map((r) => r.path);
  expect(paths).toEqual(["/v2/refunds", "/v2/chargebacks"]);
  expect(lists().every((r) => r.query.profileId === "pfl_fake")).toBe(true);
});

it("reads the balance", async () => {
  mollie.current.balance = { available: "1234.56", pending: "7.80" };
  expect(await read().primaryBalance()).toEqual({ ok: true, data: { availableCents: 123456, pendingCents: 780 } });
  expect(mollie.current.requests[0]).toMatchObject({ path: "/v2/balances/primary", authorization: "Bearer org_fake" });
});

it("tells a refusal from no answer, as the kassa's client does", async () => {
  const fake = mollie.current;
  fake.failNext(422);
  expect(await read().primaryBalance()).toMatchObject({ ok: false, failure: "refused", status: 422 });
  fake.failNext(500);
  expect(await read().primaryBalance()).toMatchObject({ ok: false, failure: "unreachable", status: 500 });
  fake.failNext(429);
  expect(await read().primaryBalance()).toMatchObject({ ok: false, failure: "unreachable" });
  fake.failNext("timeout");
  expect(await read().primaryBalance()).toEqual({ ok: false, failure: "unreachable", status: 0 });
  fake.failNext(404);
  expect(await read().primaryBalance()).toMatchObject({ ok: false, failure: "not_found" });
  expect(await read({ MOLLIE_ORG_TOKEN: "org_wrong" }).primaryBalance()).toMatchObject({ ok: false, failure: "unauthorized", status: 401 });
  // an amount that cannot be read fails the call, it does not guess
  fake.balance = { available: "twelve", pending: "0.00" };
  expect(await read().primaryBalance()).toMatchObject({ ok: false, failure: "unreachable" });
});

it("has no client without the organisation token", () => {
  expect(mollieReadFor({ ...env, MOLLIE_ORG_TOKEN: undefined })).toBeNull();
  expect(mollieReadFor({ ...env, MOLLIE_ORG_TOKEN: "" })).toBeNull();
});

it("answers the organisation's routes only to the organisation token", async () => {
  // the kassa's own key is refused by the fake, as Mollie would
  await mollieFor({ ...env, MOLLIE_API_KEY: "test_fake" })!.listTerminals();
  const response = await fetch("https://api.mollie.com/v2/balances/primary", { headers: { Authorization: "Bearer test_fake" } });
  expect(response.status).toBe(401);
  // and the organisation token does not open the kassa's routes
  const terminals = await fetch("https://api.mollie.com/v2/terminals", { headers: { Authorization: "Bearer org_fake" } });
  expect(terminals.status).toBe(401);
});

it("reads the profile once, keeps it in ledger_settings, and sends it on the three lists", async () => {
  mollie.current.profileId = "pfl_xyz";
  await read().paymentsSince("2027-01-01T00:00:00.000Z");
  await read().refundsSince("2027-01-01T00:00:00.000Z");
  await read().chargebacksSince("2027-01-01T00:00:00.000Z");
  expect(mollie.current.requests.filter((r) => r.path === "/v2/profiles")).toHaveLength(1);
  expect(await getLedgerSetting(env.DB, "mollie_profile_id")).toBe("pfl_xyz");
  expect(lists().map((r) => r.query.profileId)).toEqual(["pfl_xyz", "pfl_xyz", "pfl_xyz"]);
});

it("answers not_found when the organisation has no profile", async () => {
  mollie.current.profileId = null;
  expect(await read().paymentsSince("2027-01-01T00:00:00.000Z")).toEqual({ ok: false, failure: "not_found", status: 0 });
  expect(await getLedgerSetting(env.DB, "mollie_profile_id")).toBeNull();
});

it("follows the next link page by page and stops at the first old item", async () => {
  const fake = mollie.current;
  fake.pageSize = 2;
  for (let day = 1; day <= 7; day++) fake.addPayment({ id: `tr_${day}`, method: "ideal", amount: "1.00", createdAt: `2027-03-0${day}T10:00:00+00:00` });
  const result = await read().paymentsSince("2027-03-04T00:00:00.000Z");
  expect(result.ok && result.data.map((p) => p.id)).toEqual(["tr_7", "tr_6", "tr_5", "tr_4"]);
  // newest first: 7 6 | 5 4 | 3 (old: stop). Three pages, not four.
  expect(lists()).toHaveLength(3);
  expect(lists()[1]!.query.from).toBe("tr_5");
  expect(lists().every((r) => r.authorization === "Bearer org_fake")).toBe(true);
});

it("reads at most ten pages of a list", async () => {
  const fake = mollie.current;
  fake.pageSize = 1;
  for (let i = 1; i <= 15; i++) fake.addPayment({ id: `tr_${i}`, method: "ideal", amount: "1.00", createdAt: `2027-03-${String(i).padStart(2, "0")}T10:00:00+00:00` });
  const result = await read().paymentsSince("2027-01-01T00:00:00.000Z");
  expect(result.ok && result.data).toHaveLength(10);
  expect(lists()).toHaveLength(10);
});

it("reads settlement pages until one holds nothing open or recent", async () => {
  const fake = mollie.current;
  fake.pageSize = 2; // the fake serves them in the order they were added; Mollie documents no order
  fake.addSettlement({ id: "stl_4", status: "open", settledAt: null, amount: "4.00" });
  fake.addSettlement({ id: "stl_3", status: "paidout", settledAt: "2027-02-05T00:00:00+00:00", amount: "3.00" });
  fake.addSettlement({ id: "stl_1", status: "paidout", settledAt: "2026-12-01T00:00:00+00:00", amount: "1.00" });
  fake.addSettlement({ id: "stl_2", status: "paidout", settledAt: "2026-12-05T00:00:00+00:00", amount: "1.00" });
  fake.addSettlement({ id: "stl_5", status: "paidout", settledAt: "2026-11-01T00:00:00+00:00", amount: "1.00" });
  const result = await read().settlementsSince("2027-01-01T00:00:00.000Z");
  expect(result.ok && result.data.map((s) => s.id)).toEqual(["stl_4", "stl_3"]);
  expect(lists()).toHaveLength(2); // [4 3] has recent ones, [1 2] has none: stop
});

it("never puts the token into a request URL, an error or the repository's copy of a failure", async () => {
  mollie.current.failNext(500);
  const result = await read().primaryBalance();
  expect(JSON.stringify(result)).not.toContain("org_fake");
  expect(mollie.current.requests.every((r) => !r.path.includes("org_fake"))).toBe(true);
});

// ---- fix round 1 ----

/** Wraps the fake's fetch so every call's URL and Authorization header can be inspected. */
function spyOnFetch() {
  const seen: { url: string; authorization: string | null }[] = [];
  const inner = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push({ url: request.url, authorization: request.headers.get("Authorization") });
    return inner(request);
  });
  return seen;
}

it("keeps the token out of results, thrown errors and console output, even when Mollie echoes it", async () => {
  const console_ = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")];
  const fake = mollie.current;
  const outcomes: unknown[] = [];
  try {
    fake.failNext(422); // a refusal whose title and detail repeat the token
    outcomes.push(await read().primaryBalance());
    fake.failNext("garbled"); // a 200 that cannot be read, repeating the token
    outcomes.push(await read().primaryBalance());
    fake.failNext("garbled");
    outcomes.push(await read().paymentsSince("2027-01-01T00:00:00.000Z"));
    fake.failNext(422);
    outcomes.push(await read().settlementsSince("2027-01-01T00:00:00.000Z"));
  } catch (error) {
    outcomes.push(String(error));
  }
  expect(outcomes).toHaveLength(4);
  expect(outcomes[0]).toMatchObject({ ok: false, failure: "refused" });
  expect(outcomes[1]).toMatchObject({ ok: false, failure: "unreachable" });
  expect(outcomes[2]).toMatchObject({ ok: false, failure: "unreachable" });
  expect(JSON.stringify(outcomes)).not.toContain("org_fake");
  for (const spy of console_) expect(JSON.stringify(spy.mock.calls)).not.toContain("org_fake");
  vi.restoreAllMocks();
});

it("fetches the next page from the pinned base even when the link names another host", async () => {
  const fake = mollie.current;
  fake.pageSize = 1;
  fake.nextOrigin = "https://evil.example";
  fake.addPayment({ id: "tr_1", method: "ideal", amount: "1.00", createdAt: "2027-03-01T10:00:00+00:00" });
  fake.addPayment({ id: "tr_2", method: "ideal", amount: "1.00", createdAt: "2027-03-02T10:00:00+00:00" });
  const seen = spyOnFetch();
  const result = await read().paymentsSince("2027-01-01T00:00:00.000Z");
  expect(result.ok && result.data.map((p) => p.id)).toEqual(["tr_2", "tr_1"]);
  expect(seen.length).toBeGreaterThan(2);
  expect(seen.every((call) => new URL(call.url).hostname === "api.mollie.com")).toBe(true);
  expect(seen.every((call) => call.authorization === "Bearer org_fake")).toBe(true);
  vi.restoreAllMocks();
});

it("puts profileId back on a next link that dropped it", async () => {
  const fake = mollie.current;
  fake.pageSize = 1;
  fake.dropProfileOnNext = true;
  for (const kind of ["addPayment", "addRefund", "addChargeback"] as const) {
    for (const day of [1, 2]) (fake[kind] as any)({ id: `${kind}_${day}`, method: "ideal", paymentId: "tr_1", amount: "1.00", createdAt: `2027-03-0${day}T10:00:00+00:00` });
  }
  const r = read();
  expect(await r.paymentsSince("2027-01-01T00:00:00.000Z")).toMatchObject({ ok: true });
  expect(await r.refundsSince("2027-01-01T00:00:00.000Z")).toMatchObject({ ok: true });
  expect(await r.chargebacksSince("2027-01-01T00:00:00.000Z")).toMatchObject({ ok: true });
  const withFrom = lists().filter((request) => request.query.from);
  expect(withFrom).toHaveLength(3);
  expect(withFrom.every((request) => request.query.profileId === "pfl_fake")).toBe(true);
});

it("reads no extra call when the settlements list carries the periods", async () => {
  mollie.current.addSettlement({ id: "stl_1", amount: "10.00", costs: { "2027": { "01": ["1.88"] } } });
  const result = await read().settlementsSince("2027-01-01T00:00:00.000Z");
  expect(result.ok && result.data[0]!.costsCents).toBe(188);
  expect(mollie.current.requests.map((request) => request.path)).toEqual(["/v2/settlements"]);
});

it("reads a settlement's periods one by one when the list omits them, and fails if that read fails", async () => {
  const fake = mollie.current;
  fake.periodsInList = false;
  fake.addSettlement({ id: "stl_1", amount: "10.00", costs: { "2027": { "01": ["1.88"], "02": ["0.29"] } } });
  fake.addSettlement({ id: "stl_2", amount: "20.00", costs: { "2027": { "01": ["0.50"] } } });
  const result = await read().settlementsSince("2027-01-01T00:00:00.000Z");
  expect(result.ok && result.data.map((s) => [s.id, s.costsCents])).toEqual([["stl_1", 217], ["stl_2", 50]]);
  expect(fake.requests.map((request) => request.path)).toEqual(["/v2/settlements", "/v2/settlements/stl_1", "/v2/settlements/stl_2"]);

  fake.requests = [];
  fake.failNext("pass"); // the list answers, then the first detail read fails
  fake.failNext(500);
  expect(await read().settlementsSince("2027-01-01T00:00:00.000Z")).toMatchObject({ ok: false, failure: "unreachable", status: 500 });
});

it("counts the settlement detail reads within the ten calls of the list", async () => {
  const fake = mollie.current;
  fake.periodsInList = false;
  for (let i = 1; i <= 15; i++) fake.addSettlement({ id: `stl_${i}`, amount: "1.00", costs: { "2027": { "01": ["0.10"] } } });
  const result = await read().settlementsSince("2027-01-01T00:00:00.000Z");
  expect(result.ok).toBe(true);
  expect(fake.requests).toHaveLength(10); // 1 list + 9 detail reads, the rest waits for the next run
  expect(result.ok && result.data).toHaveLength(9);
});
