import { Hono } from "hono";
import { z } from "zod";
import { getCatalog } from "../db/products";
import { ingestItems } from "../db/sales";
import { StockError, receiveOrder } from "../db/stock";
import type { AppEnv } from "../env";

/** Routes for the paired iPad. Mounted behind `requireDevice`. */
export const kassa = new Hono<AppEnv>();

kassa.get("/ping", (c) => c.json({ ok: true }));

kassa.get("/catalog", async (c) => c.json(await getCatalog(c.env.DB, new Date())));

// The iPad's outbox sends at most fifty items at a time.
const salesBody = z.object({ items: z.array(z.unknown()).min(1).max(50) });

kassa.post("/sales", async (c) => {
  const body = salesBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json({ results: await ingestItems(c.env.DB, c.var.deviceId, body.data.items, new Date()) });
});

// The beheerder confirms a delivery on the iPad; the stock then goes up by what was ordered.
kassa.post("/orders/:id/receive", async (c) => {
  try {
    await receiveOrder(c.env.DB, c.req.param("id"), "device", new Date());
  } catch (error) {
    if (error instanceof StockError) return c.json({ error: error.code }, error.status as 409);
    throw error;
  }
  return c.json({ ok: true });
});
