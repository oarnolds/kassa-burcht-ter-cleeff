import { Hono } from "hono";
import { z } from "zod";
import { getCatalog } from "../db/products";
import { ingestItems } from "../db/sales";
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
