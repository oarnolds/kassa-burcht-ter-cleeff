import { Hono } from "hono";
import { getCatalog } from "../db/products";
import type { AppEnv } from "../env";

/** Routes for the paired iPad. Mounted behind `requireDevice`. */
export const kassa = new Hono<AppEnv>();

kassa.get("/ping", (c) => c.json({ ok: true }));

kassa.get("/catalog", async (c) => c.json(await getCatalog(c.env.DB, new Date())));
