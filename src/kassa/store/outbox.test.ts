import { beforeEach, expect, it, vi } from "vitest";
import type { OutboxItem } from "../../../shared/schemas";
import { deleteKassaDatabase } from "../../test-utils";
import { getDb } from "./db";
import { enqueue, flush, pendingCount, rejectedCount, type SendResult } from "./outbox";

beforeEach(deleteKassaDatabase);

const item = (n = 1) =>
  ({
    id: crypto.randomUUID(),
    kind: "sale",
    soldAt: new Date().toISOString(),
    totalCents: 110 * n,
    cashGivenCents: null,
    lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: n }],
  }) as OutboxItem;

const accept: (items: OutboxItem[]) => Promise<SendResult> = async (items) => ({
  ok: true,
  results: items.map((i) => ({ id: i.id, status: "accepted" })),
});

it("sends queued sales in order and empties the queue", async () => {
  const a = item(1);
  const b = item(2);
  await enqueue(a);
  await enqueue(b);
  expect(await pendingCount()).toBe(2);
  const send = vi.fn(accept);
  expect(await flush(send)).toEqual({ sent: 2, rejected: 0, remaining: 0 });
  expect(send.mock.calls[0]![0].map((i) => i.id)).toEqual([a.id, b.id]);
  expect(await pendingCount()).toBe(0);
});

it("does not call the server when nothing is waiting", async () => {
  const send = vi.fn(accept);
  expect(await flush(send)).toEqual({ sent: 0, rejected: 0, remaining: 0 });
  expect(send).not.toHaveBeenCalled();
});

it("keeps everything when offline", async () => {
  await enqueue(item());
  expect(await flush(async () => ({ ok: false, reason: "offline" }))).toEqual({ sent: 0, rejected: 0, remaining: 1, stopped: "offline" });
  expect(await pendingCount()).toBe(1);
});

it("sets a rejected item aside and carries on (Review Focus 2)", async () => {
  const bad = item(1);
  const good = item(2);
  await enqueue(bad);
  await enqueue(good);
  const out = await flush(async () => ({
    ok: true,
    results: [
      { id: bad.id, status: "rejected", reason: "total_mismatch" },
      { id: good.id, status: "accepted" },
    ],
  }));
  expect(out).toEqual({ sent: 1, rejected: 1, remaining: 0 });
  expect(await rejectedCount()).toBe(1);
  expect(await pendingCount()).toBe(0);
  const kept = await (await getDb()).get("rejected", bad.id);
  expect(kept).toMatchObject({ id: bad.id, item: bad, reason: "total_mismatch" });
  expect(Number.isNaN(Date.parse(kept.at))).toBe(false);
});

it("treats a duplicate as delivered", async () => {
  const a = item();
  await enqueue(a);
  expect(await flush(async () => ({ ok: true, results: [{ id: a.id, status: "duplicate" }] }))).toMatchObject({ remaining: 0 });
  expect(await pendingCount()).toBe(0);
  expect(await rejectedCount()).toBe(0);
});

it("keeps unsent sales when the device is unpaired, and sends them after pairing again (Review Focus 5)", async () => {
  await enqueue(item());
  await enqueue(item());
  expect(await flush(async () => ({ ok: false, reason: "unauthorized" }))).toMatchObject({ remaining: 2, stopped: "unauthorized" });
  expect(await flush(accept)).toMatchObject({ sent: 2, remaining: 0 });
});

it("sends at most fifty per request and keeps going", async () => {
  for (let i = 0; i < 120; i++) await enqueue(item());
  const send = vi.fn(accept);
  expect(await flush(send)).toMatchObject({ sent: 120, remaining: 0 });
  expect(send.mock.calls.map((c) => c[0].length)).toEqual([50, 50, 20]);
});

it("does not send twice when flushed twice at once", async () => {
  await enqueue(item());
  const send = vi.fn(accept);
  const [first, second] = await Promise.all([flush(send), flush(send)]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(second).toEqual(first);
});

it("keeps a sale the server gave no answer for, and stops instead of asking for ever", async () => {
  const a = item(1);
  const b = item(2);
  await enqueue(a);
  await enqueue(b);
  const send = vi.fn(async (): Promise<SendResult> => ({ ok: true, results: [{ id: a.id, status: "accepted" }] }));
  expect(await flush(send)).toEqual({ sent: 1, rejected: 0, remaining: 1, stopped: "server" });
  expect(send).toHaveBeenCalledTimes(2);
});

it("stops when the server keeps failing half way", async () => {
  for (let i = 0; i < 60; i++) await enqueue(item());
  let call = 0;
  const out = await flush(async (items) => (call++ === 0 ? accept(items) : { ok: false, reason: "server" }));
  expect(out).toEqual({ sent: 50, rejected: 0, remaining: 10, stopped: "server" });
});
