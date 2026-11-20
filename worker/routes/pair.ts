import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { randomToken, sha256Hex } from "../lib/crypto";
import { clearFailures, isBlocked, registerFailure } from "../lib/rate-limit";

const pairBody = z.object({ code: z.string().max(20), name: z.string().trim().min(1).max(40) });

/** Public: an iPad trades a pairing code from beheer for its own token. */
export const pair = new Hono<AppEnv>();

pair.post("/", async (c) => {
  const db = c.env.DB;
  const key = `pair:${c.req.header("CF-Connecting-IP") ?? "local"}`;
  const now = new Date();
  if (await isBlocked(db, key, now)) return c.json({ error: "too_many_attempts" }, 429);
  const body = pairBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  // Claiming the code is one statement, so two iPads cannot both pair on the same code.
  const claimed = await db
    .prepare("UPDATE pairing_codes SET used_at = ?1 WHERE code_hash = ?2 AND used_at IS NULL AND expires_at > ?1")
    .bind(now.toISOString(), await sha256Hex(body.data.code))
    .run();
  if (claimed.meta.changes === 0) {
    await registerFailure(db, key, now);
    return c.json({ error: "invalid_code" }, 401);
  }
  const deviceId = crypto.randomUUID();
  const token = randomToken();
  await db
    .prepare("INSERT INTO devices (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(deviceId, body.data.name, await sha256Hex(token), now.toISOString())
    .run();
  await clearFailures(db, key);
  return c.json({ deviceId, token }, 201);
});
