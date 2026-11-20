import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { sha256Hex } from "../lib/crypto";

const SEEN_INTERVAL_MS = 60_000;

/** Lets a paired, unrevoked kassa through and puts its id in `c.var.deviceId`. */
export const requireDevice: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  const device = token
    ? await c.env.DB.prepare("SELECT id, last_seen_at FROM devices WHERE token_hash = ? AND revoked_at IS NULL")
        .bind(await sha256Hex(token))
        .first<{ id: string; last_seen_at: string | null }>()
    : null;
  if (!device) return c.json({ error: "unauthorized" }, 401);
  const now = new Date();
  if (!device.last_seen_at || now.getTime() - Date.parse(device.last_seen_at) >= SEEN_INTERVAL_MS) {
    await c.env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").bind(now.toISOString(), device.id).run();
  }
  c.set("deviceId", device.id);
  await next();
};
