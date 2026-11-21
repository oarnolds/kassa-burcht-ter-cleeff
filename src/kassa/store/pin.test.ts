import { openDB } from "idb";
import { beforeEach, expect, it, vi } from "vitest";
import { calls, deleteKassaDatabase, mockApi, mockOffline } from "../../test-utils";
import { getDb, setMeta } from "./db";
import { pendingCount } from "./outbox";
import {
  LOST_MS,
  POLL_MS,
  WAIT_LIMIT_MS,
  dismissFailed,
  listParked,
  markCashTaken,
  parkLeftovers,
  resolveParked,
  runPin,
  type Parked,
  type PinReceipt,
} from "./pin";

beforeEach(async () => {
  await deleteKassaDatabase();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await setMeta("deviceToken", "tok");
});

const receipt = (over: Partial<PinReceipt> = {}): PinReceipt => ({
  id: crypto.randomUUID(),
  soldAt: new Date().toISOString(),
  totalCents: 110,
  lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 1 }],
  ...over,
});
const status = (r: PinReceipt, over: object = {}) => ({ id: r.id, outcome: null, reason: null, sent: true, testUrl: null, ...over });
const stored = async () => (await getDb()).getAll("pin");
const statusUrl = (r: PinReceipt) => `/api/kassa/pin/${r.id}`;
const cancelUrl = (r: PinReceipt) => `/api/kassa/pin/${r.id}/cancel`;
const cancels = () => calls("POST").filter((call) => call.url.endsWith("/cancel"));
const starts = () => calls("POST").filter((call) => call.url === "/api/kassa/pin");

// The kassa's clock is a fake one, but its storage does its work in real time. Taken at load, before any
// test has put the fake clock in place.
const realSetTimeout = globalThis.setTimeout;
const settle = () => new Promise<void>((resolve) => realSetTimeout(resolve, 4));

/** Lets `ms` of the kassa's time go by, a step at a time, with room for the storage to do its work in between. */
async function pass(ms: number, step = 250): Promise<void> {
  const until = Date.now() + ms;
  await settle();
  while (Date.now() < until) {
    await vi.advanceTimersByTimeAsync(Math.min(step, until - Date.now()));
    await settle();
  }
}

/** Puts a receipt on the iPad as one whose outcome is not known, at the minute given. */
async function park(minute: number, over: Partial<Parked> = {}): Promise<Parked> {
  const parked: Parked = { ...receipt({ soldAt: `2026-07-30T10:${String(minute).padStart(2, "0")}:00.000Z` }), parked: true, failed: false, cashTaken: false, ...over };
  await (await getDb()).put("pin", parked);
  return parked;
}

it("follows a payment to paid and forgets the receipt", async () => {
  const r = receipt();
  let asked = 0;
  mockApi({ "POST /api/kassa/pin": status(r, { testUrl: "https://mollie.test/kies" }), [statusUrl(r)]: () => (++asked < 3 ? status(r) : status(r, { outcome: "paid" })) });
  const progress = vi.fn();
  const run = runPin(r, progress);
  await pass(POLL_MS / 2);
  // While it runs the receipt is on the iPad, so that a kassa that is closed now can find it again.
  expect(await stored()).toEqual([{ ...r, parked: false, failed: false, cashTaken: false }]);
  expect(progress).toHaveBeenCalledWith({ sent: true, testUrl: "https://mollie.test/kies", cancelFailed: false });
  await pass(3 * POLL_MS);
  expect(await run.done).toEqual({ kind: "paid" });
  expect(progress).toHaveBeenLastCalledWith({ sent: true, testUrl: null, cancelFailed: false });
  expect(calls("POST")).toHaveLength(1);
  expect(calls("POST")[0]).toMatchObject({ url: "/api/kassa/pin", body: r });
  expect(calls("GET").map((call) => call.url)).toEqual([statusUrl(r), statusUrl(r), statusUrl(r)]);
  expect(await stored()).toEqual([]);
});

it("ends with Mollie's reason when the payment did not go through", async () => {
  const r = receipt();
  mockApi({ "POST /api/kassa/pin": status(r, { sent: false }), [statusUrl(r)]: status(r, { outcome: "declined", reason: "insufficient_funds" }) });
  const progress = vi.fn();
  const run = runPin(r, progress);
  await pass(POLL_MS);
  expect(await run.done).toEqual({ kind: "failed", outcome: "declined", reason: "insufficient_funds" });
  expect(progress.mock.calls).toEqual([[{ sent: false, testUrl: null, cancelFailed: false }]]);
  expect(await stored()).toEqual([]);
});

it.each([
  [409, "no_terminal"],
  [422, "total_mismatch"],
  [401, "unauthorized"],
] as const)("ends at once when the server refuses the start (%i)", async (code, error) => {
  const r = receipt();
  mockApi({ "POST /api/kassa/pin": [code, { error }] });
  const run = runPin(r, vi.fn());
  await pass(POLL_MS);
  expect(await run.done).toEqual({ kind: "failed", outcome: "start_failed", reason: error });
  await pass(2 * POLL_MS);
  expect(calls()).toHaveLength(1);
  expect(await stored()).toEqual([]);
});

it("ends at once on a start the server answers with the outcome", async () => {
  const r = receipt();
  mockApi({ "POST /api/kassa/pin": status(r, { outcome: "start_failed", reason: "refused", sent: false }) });
  const run = runPin(r, vi.fn());
  await pass(POLL_MS);
  expect(await run.done).toEqual({ kind: "failed", outcome: "start_failed", reason: "refused" });
  expect(calls()).toHaveLength(1);
});

it("sends the same start again until the server answers", async () => {
  const r = receipt();
  mockOffline();
  const run = runPin(r, vi.fn());
  await pass(2 * POLL_MS + POLL_MS / 2);
  expect(starts().length).toBeGreaterThanOrEqual(2);
  expect(calls("GET")).toHaveLength(0);
  mockApi({ "POST /api/kassa/pin": status(r), [statusUrl(r)]: status(r, { outcome: "paid" }) });
  await pass(2 * POLL_MS);
  expect(await run.done).toEqual({ kind: "paid" });
  expect(starts().every((call) => JSON.stringify(call.body) === JSON.stringify(r))).toBe(true);
  expect(calls("GET")).toHaveLength(1);
  expect(await stored()).toEqual([]);
});

it("parks the receipt after ten seconds without an answer", async () => {
  const r = receipt();
  mockApi({ "POST /api/kassa/pin": status(r), [statusUrl(r)]: status(r) });
  const run = runPin(r, vi.fn());
  await pass(2 * POLL_MS);
  mockOffline();
  await pass(LOST_MS - 2 * POLL_MS);
  expect(await listParked()).toEqual([]); // not yet: the connection may come back
  await pass(3 * POLL_MS);
  expect(await run.done).toEqual({ kind: "unknown" });
  expect(await listParked()).toMatchObject([{ id: r.id, totalCents: 110, parked: true, failed: false, cashTaken: false }]);
});

it("parks a receipt whose start never got an answer", async () => {
  const r = receipt();
  mockOffline();
  const run = runPin(r, vi.fn());
  await pass(LOST_MS + POLL_MS);
  expect(await run.done).toEqual({ kind: "unknown" });
  expect(await listParked()).toMatchObject([{ id: r.id, parked: true }]);
});

it("treats a server in trouble like no answer", async () => {
  const r = receipt();
  mockApi({ "POST /api/kassa/pin": status(r), [statusUrl(r)]: [503, { error: "server" }] });
  const run = runPin(r, vi.fn());
  await pass(LOST_MS + 2 * POLL_MS);
  expect(await run.done).toEqual({ kind: "unknown" });
  expect(await listParked()).toMatchObject([{ id: r.id, parked: true }]);
});

it("parks the receipt when the payment is still running after two minutes", async () => {
  const r = receipt();
  mockApi({ "POST /api/kassa/pin": status(r), [statusUrl(r)]: status(r) });
  const run = runPin(r, vi.fn());
  await pass(WAIT_LIMIT_MS - 2 * POLL_MS, POLL_MS);
  expect(await listParked()).toEqual([]);
  await pass(3 * POLL_MS);
  expect(await run.done).toEqual({ kind: "unknown" });
  expect(await listParked()).toMatchObject([{ id: r.id, parked: true }]);
});

it("asks the server to cancel, and keeps following when that is refused", async () => {
  const r = receipt();
  let paid = false;
  mockApi({ "POST /api/kassa/pin": status(r), [statusUrl(r)]: () => status(r, paid ? { outcome: "paid" } : {}), [`POST ${cancelUrl(r)}`]: status(r) });
  const progress = vi.fn();
  const run = runPin(r, progress);
  await pass(POLL_MS / 2);
  run.cancel();
  await pass(POLL_MS / 2);
  expect(cancels()).toHaveLength(1);
  expect(progress).toHaveBeenLastCalledWith({ sent: true, testUrl: null, cancelFailed: true });
  run.cancel(); // tapped again: the answer was already no
  await pass(2 * POLL_MS);
  expect(cancels()).toHaveLength(1);
  expect(progress).toHaveBeenLastCalledWith({ sent: true, testUrl: null, cancelFailed: true });
  paid = true;
  await pass(2 * POLL_MS);
  expect(await run.done).toEqual({ kind: "paid" });
});

it("ends as cancelled when the server says so", async () => {
  const r = receipt();
  mockApi({ "POST /api/kassa/pin": status(r), [statusUrl(r)]: status(r), [`POST ${cancelUrl(r)}`]: status(r, { outcome: "canceled" }) });
  const run = runPin(r, vi.fn());
  await pass(POLL_MS / 2);
  run.cancel();
  await pass(POLL_MS / 2);
  expect(await run.done).toEqual({ kind: "failed", outcome: "canceled", reason: null });
  expect(cancels()).toHaveLength(1);
  expect(await stored()).toEqual([]);
});

it("keeps asking to cancel until the server has answered that", async () => {
  const r = receipt();
  let tries = 0;
  mockApi({
    "POST /api/kassa/pin": status(r),
    [statusUrl(r)]: status(r),
    [`POST ${cancelUrl(r)}`]: () => (++tries < 3 ? [503, { error: "server" }] : status(r, { outcome: "canceled" })),
  });
  const run = runPin(r, vi.fn());
  await pass(POLL_MS / 2);
  run.cancel();
  await pass(3 * POLL_MS);
  expect(await run.done).toEqual({ kind: "failed", outcome: "canceled", reason: null });
  expect(cancels()).toHaveLength(3);
});

it("does not cancel before the server has answered the start", async () => {
  const r = receipt();
  mockOffline();
  const run = runPin(r, vi.fn());
  await pass(POLL_MS / 2);
  run.cancel();
  await pass(2 * POLL_MS);
  mockApi({ "POST /api/kassa/pin": status(r), [statusUrl(r)]: status(r, { outcome: "paid" }) });
  await pass(2 * POLL_MS);
  expect(await run.done).toEqual({ kind: "paid" });
  expect(cancels()).toHaveLength(0);
});

it("parks what a closed kassa left behind (Review Focus 3)", async () => {
  const r = receipt();
  mockOffline();
  runPin(r, vi.fn()); // the kassa is closed while this runs
  await pass(POLL_MS);
  expect(await listParked()).toEqual([]);
  await parkLeftovers(); // the next start of the kassa
  expect(await listParked()).toMatchObject([{ id: r.id, parked: true, failed: false, cashTaken: false }]);
});

it("settles parked receipts when the server knows their outcome", async () => {
  const [paid, declined, unknown, running] = [await park(1), await park(2), await park(3), await park(4)];
  mockApi({
    [statusUrl(paid)]: status(paid, { outcome: "paid" }),
    [statusUrl(declined)]: status(declined, { outcome: "declined", reason: "card_declined" }),
    // nothing for the third: the server answers 404, it never got that start
    [statusUrl(running)]: status(running),
  });
  expect(await resolveParked()).toEqual({ paid: [paid], failed: [{ ...declined, parked: false, failed: true }, { ...unknown, parked: false, failed: true }] });
  expect(await listParked()).toEqual([{ ...declined, parked: false, failed: true }, { ...unknown, parked: false, failed: true }, running]);
  // Without a connection nothing is learned, and nothing changes.
  mockOffline();
  expect(await resolveParked()).toEqual({ paid: [], failed: [] });
  expect(await listParked()).toHaveLength(3);
});

it("keeps a payment that did not go through until the beheerder has seen it, also over a restart", async () => {
  const [declined, running] = [await park(1), await park(2)];
  mockApi({ [statusUrl(declined)]: status(declined, { outcome: "expired" }), [statusUrl(running)]: status(running) });
  await resolveParked();
  const before = calls("GET").length;
  // The next round asks only about the one that is still running: a failed one is final.
  expect(await resolveParked()).toEqual({ paid: [], failed: [] });
  expect(calls("GET").slice(before).map((call) => call.url)).toEqual([statusUrl(running)]);
  await parkLeftovers(); // the kassa is started again
  expect(await listParked()).toEqual([{ ...declined, parked: false, failed: true }, running]);
  await dismissFailed(declined.id);
  expect(await listParked()).toEqual([running]);
});

it("leaves a receipt parked when the server cannot say, or this iPad is no longer paired", async () => {
  const [unpaired, broken] = [await park(1), await park(2)];
  mockApi({ [statusUrl(unpaired)]: [401, { error: "unauthorized" }], [statusUrl(broken)]: [500, { error: "server" }] });
  expect(await resolveParked()).toEqual({ paid: [], failed: [] });
  expect(await listParked()).toEqual([unpaired, broken]);
});

it("remembers that cash was taken for a parked receipt, and then has nothing to tell when the payment fails", async () => {
  const parked = await park(1);
  await markCashTaken(parked.id);
  expect(await listParked()).toEqual([{ ...parked, cashTaken: true }]);
  mockApi({ [statusUrl(parked)]: status(parked, { outcome: "declined", reason: "card_declined" }) });
  expect(await resolveParked()).toEqual({ paid: [], failed: [] });
  expect(await listParked()).toEqual([]);
});

it("still says so when a receipt for which cash was taken turns out to be paid by pin as well", async () => {
  const parked = await park(1, { cashTaken: true });
  mockApi({ [statusUrl(parked)]: status(parked, { outcome: "paid" }) });
  expect(await resolveParked()).toEqual({ paid: [parked], failed: [] });
  expect(await listParked()).toEqual([]);
});

it("asks about each parked receipt once when two rounds come at the same moment (Review Focus 4)", async () => {
  const parked = await park(1);
  mockApi({ [statusUrl(parked)]: status(parked, { outcome: "paid" }) });
  const [first, second] = await Promise.all([resolveParked(), resolveParked()]);
  expect(first).toEqual({ paid: [parked], failed: [] });
  expect(second).toBe(first);
  expect(calls("GET")).toHaveLength(1);
});

it("adds the pin store to a kassa from fase 1 without losing what waits", async () => {
  // A version 1 database, as fase 1 made it, with one sale that still has to be sent.
  await deleteKassaDatabase();
  const old = await openDB("kassa", 1, {
    upgrade(db) {
      db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
      db.createObjectStore("rejected", { keyPath: "id" });
      db.createObjectStore("meta");
    },
  });
  await old.add("outbox", { item: { id: "wacht", kind: "sale" } });
  await old.put("meta", "tok-1", "deviceToken");
  old.close();
  const db = await getDb();
  expect(db.version).toBe(2);
  expect([...db.objectStoreNames]).toEqual(["meta", "outbox", "pin", "rejected"]);
  expect(await pendingCount()).toBe(1);
  expect(await db.get("meta", "deviceToken")).toBe("tok-1");
  expect(await listParked()).toEqual([]);
});
