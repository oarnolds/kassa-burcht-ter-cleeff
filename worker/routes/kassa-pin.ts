import { Hono, type Context } from "hono";
import { pinSaleInput } from "../../shared/schemas";
import { cancelPin, pinStatus, startPin, type PinContext } from "../db/pin";
import { PinError } from "../db/pin-settings";
import type { AppEnv } from "../env";
import { mollieFor } from "../lib/mollie";

/**
 * Pin payments for the paired iPad. Mounted behind `requireDevice`. Any paired kassa may ask about any
 * pin sale: an iPad that was paired again must still find the receipts it left waiting.
 */
export const kassaPin = new Hono<AppEnv>();

const contextOf = (c: Context<AppEnv>): PinContext => ({ db: c.env.DB, mollie: mollieFor(c.env), origin: new URL(c.req.url).origin, now: new Date() });

kassaPin.post("/pin", async (c) => {
  const body = pinSaleInput.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  try {
    return c.json(await startPin(contextOf(c), c.var.deviceId, body.data));
  } catch (error) {
    if (error instanceof PinError) return c.json({ error: error.code }, error.status as 409 | 422);
    throw error;
  }
});

// No pin sale with this id: the start never arrived. Its own code, because a server without pin (an older
// version, after a rollback) answers "not_found" to every path, and that proves nothing about a payment.
const NO_PIN_SALE = { error: "no_pin_sale" } as const;

// The iPad asks this every second while the customer stands at the terminal.
kassaPin.get("/pin/:id", async (c) => {
  const status = await pinStatus(contextOf(c), c.req.param("id"));
  return status ? c.json(status) : c.json(NO_PIN_SALE, 404);
});

kassaPin.post("/pin/:id/cancel", async (c) => {
  const status = await cancelPin(contextOf(c), c.req.param("id"));
  return status ? c.json(status) : c.json(NO_PIN_SALE, 404);
});
