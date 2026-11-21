import { Hono } from "hono";
import { noticeFromMollie } from "../db/pin";
import type { AppEnv } from "../env";
import { mollieFor } from "../lib/mollie";

const PAYMENT_ID = /^tr_[A-Za-z0-9_]{1,64}$/;

/**
 * Where Mollie reports that something changed about a payment. Anyone can call this address, and the call
 * carries nothing but an id: what happened to the payment is always asked of Mollie itself.
 */
export const mollieWebhook = new Hono<AppEnv>();

mollieWebhook.post("/webhook", async (c) => {
  const mollie = mollieFor(c.env);
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const id = form.id;
  // Mollie tries again on anything but a 200, so a call the kassa can do nothing with is answered with one.
  if (!mollie || typeof id !== "string" || !PAYMENT_ID.test(id)) return c.text("ok");
  const result = await noticeFromMollie({ db: c.env.DB, mollie, origin: new URL(c.req.url).origin, now: new Date() }, id);
  return result === "done" ? c.text("ok") : c.text("retry", 503);
});
