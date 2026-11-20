import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { sha256Hex } from "../lib/crypto";

export const SESSION_COOKIE = "kassa_admin";

/** The stored hash of the session cookie on this request, or null when there is no cookie. */
export async function sessionHash(c: Context<AppEnv>): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  return token ? sha256Hex(token) : null;
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const hash = await sessionHash(c);
  const session = hash
    ? await c.env.DB.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").bind(hash).first<{ expires_at: string }>()
    : null;
  if (!session || session.expires_at <= new Date().toISOString()) return c.json({ error: "unauthorized" }, 401);
  const safe = c.req.method === "GET" || c.req.method === "HEAD";
  if (!safe && c.req.header("X-Requested-With") !== "kassa") return c.json({ error: "csrf" }, 403);
  await next();
};
