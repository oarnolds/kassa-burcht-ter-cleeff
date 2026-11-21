import { Hono } from "hono";
import { z } from "zod";
import { PinError, chooseTerminal, pinSettings } from "../db/pin-settings";
import type { AppEnv } from "../env";
import { mollieFor } from "../lib/mollie";

const terminalBody = z.object({ terminalId: z.string().min(1).max(100).nullable() });

/** Beheer: which Mollie terminal the kassa uses. Mounted behind `requireAdmin`. */
export const adminPin = new Hono<AppEnv>();

adminPin.get("/pin", async (c) => c.json(await pinSettings(c.env.DB, mollieFor(c.env))));

adminPin.post("/pin/terminal", async (c) => {
  const body = terminalBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  const mollie = mollieFor(c.env);
  if (!mollie) return c.json({ error: "no_key" }, 503);
  try {
    await chooseTerminal(c.env.DB, mollie, body.data.terminalId);
  } catch (error) {
    if (error instanceof PinError) return c.json({ error: error.code }, error.status as 409 | 503);
    throw error;
  }
  return c.json({ ok: true });
});
