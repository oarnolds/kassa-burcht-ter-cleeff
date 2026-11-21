import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { getCatalog } from "../worker/db/products";
import { ingestItems } from "../worker/db/sales";
import { createOrder, listStock, receiveOrder, recordCount } from "../worker/db/stock";
import { asDevice, cashSale, meteredDb, resetData } from "./helpers";

// The free plan allows 5 million rows read a day, and after that the database refuses until midnight.
// The iPad asks for the catalog twice a minute and every sale is a request of its own, so the daily work
// may not read more rows as the history grows.

let deviceId: string;

beforeEach(async () => {
  await resetData();
  ({ deviceId } = await asDevice());
});

/** A season behind us: `n` ice creams sold one by one, spread over the ten tracked products. */
const season = (n: number) =>
  env.DB.prepare(
    `INSERT INTO stock_movements (product_id, delta, kind, ref_id, created_at)
     WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < ?1),
       tracked AS (SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS k FROM products WHERE track_stock = 1)
     SELECT tracked.id, -1, 'sale', 'old-' || s.i, '2026-07-01T10:00:00.000Z'
     FROM s JOIN tracked ON tracked.k = s.i % 10`,
  )
    .bind(n)
    .run();

const now = () => new Date();

/** The rows each piece of daily work reads, with the history as it is at this moment. */
async function rowsRead(): Promise<Record<string, number>> {
  const sale = cashSale();
  await ingestItems(env.DB, deviceId, [sale], now());
  const order = await createOrder(env.DB, { note: null, lines: [{ productId: "aardbeitje", boxes: 0, looseUnits: 6 }] }, now());
  const work: Record<string, (db: D1Database) => Promise<unknown>> = {
    "the catalog": (db) => getCatalog(db, now(), "test"),
    "a sale": (db) => ingestItems(db, deviceId, [cashSale()], now()),
    "a reversal": (db) => ingestItems(db, deviceId, [{ id: crypto.randomUUID(), kind: "reversal", soldAt: now().toISOString(), reversesSaleId: sale.id }], now()),
    "a delivery": (db) => receiveOrder(db, order.id, "device", now()),
    "the stock list": (db) => listStock(db),
    "a count": (db) => recordCount(db, { productId: "aardbeitje", counted: 10, note: null }, now()),
  };
  const read: Record<string, number> = {};
  for (const [name, run] of Object.entries(work)) {
    const metered = meteredDb(env.DB);
    await run(metered.db);
    read[name] = metered.rowsRead();
  }
  return read;
}

it("reads no more rows for the daily work after a season of sales", async () => {
  const fresh = await rowsRead();
  // The figures must be real ones: a meter that reads nothing would pass anything.
  expect(fresh["the catalog"]).toBeGreaterThan(20);
  await season(600);
  const later = await rowsRead();
  for (const name of Object.keys(fresh)) {
    // A few rows either way is the work itself (one more sale, one more order); a scan would be hundreds.
    expect.soft(later[name], name).toBeLessThanOrEqual(fresh[name]! + 10);
  }
});

it("keeps the stock as the sum of the movements, through sales, reversals, deliveries, counts and a wipe", async () => {
  const sums = async () =>
    (
      await env.DB.prepare(
        `SELECT p.id, COALESCE((SELECT SUM(m.delta) FROM stock_movements m WHERE m.product_id = p.id), 0) AS total
         FROM products p WHERE p.track_stock = 1 ORDER BY p.id`,
      ).all<{ id: string; total: number }>()
    ).results.map((row) => [row.id, row.total]);
  // The stock as it is kept on the product, which is what the kassa and beheer show.
  const levels = async () =>
    (await env.DB.prepare("SELECT id, stock FROM products WHERE track_stock = 1 ORDER BY id").all<{ id: string; stock: number }>()).results.map((row) => [
      row.id,
      row.stock,
    ]);
  const same = async () => {
    expect(await levels()).toEqual(await sums());
    expect((await listStock(env.DB)).map((item) => [item.productId, item.stock]).sort()).toEqual(await sums());
  };
  const aardbeitjes = async () => (await levels()).find(([id]) => id === "aardbeitje")![1] as number;

  await season(25);
  await same();
  const sale = cashSale({ totalCents: 330, lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 3 }] });
  await ingestItems(env.DB, deviceId, [sale], now());
  await same();
  await ingestItems(env.DB, deviceId, [{ id: crypto.randomUUID(), kind: "reversal", soldAt: now().toISOString(), reversesSaleId: sale.id }], now());
  await same();
  const order = await createOrder(env.DB, { note: null, lines: [{ productId: "aardbeitje", boxes: 0, looseUnits: 48 }] }, now());
  await receiveOrder(env.DB, order.id, "admin", now());
  await same();
  const before = await aardbeitjes();
  expect(before).toBe(48 - 2); // the delivery, less the two of the season; the sale of three was taken back
  expect(await recordCount(env.DB, { productId: "aardbeitje", counted: 40, note: null }, now())).toEqual({ stock: 40, delta: -6 });
  await same();
  expect(await aardbeitjes()).toBe(40);
  // Taking movements away takes their pieces out of the stock again.
  await env.DB.prepare("DELETE FROM stock_movements WHERE kind = 'count'").run();
  await same();
  // A movement is never changed by the kassa, but if one ever is, the stock follows.
  await env.DB.prepare("UPDATE stock_movements SET delta = delta - 5 WHERE id = (SELECT MIN(id) FROM stock_movements WHERE product_id = 'aardbeitje')").run();
  await same();
  await env.DB.prepare("DELETE FROM stock_movements").run();
  expect((await levels()).every(([, stock]) => stock === 0)).toBe(true);
});
