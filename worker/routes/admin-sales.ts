import { Hono } from "hono";
import { z } from "zod";
import { CashError, reverseSaleAsAdmin } from "../db/cash";
import type { AppEnv } from "../env";

const reverseBody = z.object({ reason: z.string().max(200) });

/** Beheer: individual sales. Mounted behind `requireAdmin`. */
export const adminSales = new Hono<AppEnv>();

adminSales.post("/sales/:id/reverse", async (c) => {
  const body = reverseBody.safeParse(await c.req.json().catch(() => null));
  // A missing reason is reported by the same rule as one that is too short.
  const reason = body.success ? body.data.reason : "";
  try {
    return c.json(await reverseSaleAsAdmin(c.env.DB, c.req.param("id"), reason, new Date()), 201);
  } catch (error) {
    if (error instanceof CashError) return c.json({ error: error.code }, error.status as 400 | 404 | 409);
    throw error;
  }
});
