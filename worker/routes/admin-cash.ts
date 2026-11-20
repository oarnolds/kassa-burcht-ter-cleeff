import { Hono } from "hono";
import { z } from "zod";
import { CashError, getCashState, recordHandover } from "../db/cash";
import type { AppEnv } from "../env";

const cents = z.number().int().min(0).max(100_000_000);

const handoverBody = z.object({
  kind: z.enum(["opening", "handover"]),
  countedAt: z.iso.datetime(),
  receivedCents: cents,
  leftCents: cents,
  note: z.string().trim().max(500).nullish(),
});

/** Beheer: the cash box. Mounted behind `requireAdmin`. */
export const adminCash = new Hono<AppEnv>();

adminCash.get("/cash", async (c) => c.json(await getCashState(c.env.DB)));

adminCash.post("/cash/handovers", async (c) => {
  const body = handoverBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  try {
    const handover = await recordHandover(c.env.DB, { ...body.data, note: body.data.note || null }, new Date());
    return c.json(handover, 201);
  } catch (error) {
    if (error instanceof CashError) return c.json({ error: error.code }, error.status as 400 | 409);
    throw error;
  }
});
