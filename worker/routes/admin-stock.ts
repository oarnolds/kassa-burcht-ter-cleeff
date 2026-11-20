import { Hono } from "hono";
import { z } from "zod";
import { StockError, cancelOrder, createOrder, listOrders, listStock, receiveOrder, recordCount } from "../db/stock";
import type { AppEnv } from "../env";

const note = z.string().trim().max(500).nullish();

const orderBody = z.object({
  note,
  lines: z
    .array(
      z.object({
        productId: z.string().min(1).max(100),
        boxes: z.number().int().min(0).max(1000),
        looseUnits: z.number().int().min(0).max(10_000),
      }),
    )
    .min(1)
    .max(100),
});

const countBody = z.object({
  productId: z.string().min(1).max(100),
  counted: z.number().int().min(0).max(100_000),
  note,
});

/** Beheer: stock, orders and counts. Mounted behind `requireAdmin`. */
export const adminStock = new Hono<AppEnv>();

adminStock.onError((error, c) => {
  if (error instanceof StockError) return c.json({ error: error.code }, error.status as 400 | 409);
  throw error;
});

adminStock.get("/stock", async (c) => c.json({ items: await listStock(c.env.DB) }));

adminStock.get("/stock/orders", async (c) => c.json({ orders: await listOrders(c.env.DB) }));

adminStock.post("/stock/orders", async (c) => {
  const body = orderBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  const order = await createOrder(c.env.DB, { note: body.data.note || null, lines: body.data.lines }, new Date());
  return c.json(order, 201);
});

adminStock.post("/stock/orders/:id/receive", async (c) => {
  await receiveOrder(c.env.DB, c.req.param("id"), "admin", new Date());
  return c.json({ ok: true });
});

adminStock.post("/stock/orders/:id/cancel", async (c) => {
  await cancelOrder(c.env.DB, c.req.param("id"));
  return c.json({ ok: true });
});

adminStock.post("/stock/counts", async (c) => {
  const body = countBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  const { productId, counted } = body.data;
  return c.json(await recordCount(c.env.DB, { productId, counted, note: body.data.note || null }, new Date()));
});
