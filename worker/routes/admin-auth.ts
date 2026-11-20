import { Hono, type Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv } from "../env";
import { hashPassword, randomToken, sha256Hex, timingSafeEqual, verifyPassword, type StoredPassword } from "../lib/crypto";
import { clearFailures, isBlocked, registerFailure } from "../lib/rate-limit";
import { SESSION_COOKIE, sessionHash } from "../middleware/admin";

const SESSION_SECONDS = 2_592_000; // thirty days
const MIN_PASSWORD_LENGTH = 10;
const COOKIE_PATH = "/api/admin";

// The upper limit keeps a huge body from tying up the password hashing.
const text = z.string().max(200);
const setupBody = z.object({ setupToken: text, password: text });
const loginBody = z.object({ password: text });
const passwordBody = z.object({ current: text, next: text });

function clientIp(c: Context<AppEnv>): string {
  return c.req.header("CF-Connecting-IP") ?? "local";
}

async function readBody<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T | null> {
  const raw = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function storedPassword(db: D1Database): Promise<StoredPassword | null> {
  const row = await db
    .prepare("SELECT password_hash, salt, iterations FROM admin WHERE id = 1")
    .first<{ password_hash: string; salt: string; iterations: number }>();
  return row ? { hash: row.password_hash, salt: row.salt, iterations: row.iterations } : null;
}

/** Routes that work without a session. */
export const adminAuthPublic = new Hono<AppEnv>();

adminAuthPublic.get("/status", async (c) => {
  const row = await c.env.DB.prepare("SELECT 1 FROM admin WHERE id = 1").first();
  return c.json({ configured: row !== null });
});

adminAuthPublic.post("/setup", async (c) => {
  const db = c.env.DB;
  const key = `setup:${clientIp(c)}`;
  const now = new Date();
  if (await isBlocked(db, key, now)) return c.json({ error: "too_many_attempts" }, 429);
  const body = await readBody(c, setupBody);
  if (!body) return c.json({ error: "invalid" }, 400);
  const expected = c.env.SETUP_TOKEN;
  if (!expected || !timingSafeEqual(body.setupToken, expected)) {
    await registerFailure(db, key, now);
    return c.json({ error: "forbidden" }, 403);
  }
  if (await storedPassword(db)) return c.json({ error: "already_configured" }, 409);
  if (body.password.length < MIN_PASSWORD_LENGTH) return c.json({ error: "password_too_short" }, 400);
  const password = await hashPassword(body.password);
  const inserted = await db
    .prepare("INSERT OR IGNORE INTO admin (id, password_hash, salt, iterations, updated_at) VALUES (1, ?, ?, ?, ?)")
    .bind(password.hash, password.salt, password.iterations, now.toISOString())
    .run();
  if (inserted.meta.changes === 0) return c.json({ error: "already_configured" }, 409);
  await clearFailures(db, key);
  return c.json({ ok: true }, 201);
});

adminAuthPublic.post("/login", async (c) => {
  const db = c.env.DB;
  const key = `login:${clientIp(c)}`;
  const now = new Date();
  if (await isBlocked(db, key, now)) return c.json({ error: "too_many_attempts" }, 429);
  const body = await readBody(c, loginBody);
  if (!body) return c.json({ error: "invalid" }, 400);
  const stored = await storedPassword(db);
  if (!stored || !(await verifyPassword(body.password, stored))) {
    await registerFailure(db, key, now);
    return c.json({ error: "unauthorized" }, 401);
  }
  const token = randomToken();
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now.toISOString()),
    db
      .prepare("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256Hex(token), now.toISOString(), expires.toISOString()),
    db.prepare("DELETE FROM auth_attempts WHERE key = ?").bind(key),
  ]);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: COOKIE_PATH,
    maxAge: SESSION_SECONDS,
  });
  return c.json({ ok: true });
});

/** Routes that need a session; `requireAdmin` is mounted in front of them in app.ts. */
export const adminAuth = new Hono<AppEnv>();

adminAuth.get("/me", (c) => c.json({ authenticated: true }));

adminAuth.post("/logout", async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sessionHash(c)).run();
  deleteCookie(c, SESSION_COOKIE, { path: COOKIE_PATH, secure: true });
  return c.json({ ok: true });
});

adminAuth.post("/password", async (c) => {
  const db = c.env.DB;
  const body = await readBody(c, passwordBody);
  if (!body) return c.json({ error: "invalid" }, 400);
  const stored = await storedPassword(db);
  if (!stored || !(await verifyPassword(body.current, stored))) return c.json({ error: "unauthorized" }, 401);
  if (body.next.length < MIN_PASSWORD_LENGTH) return c.json({ error: "password_too_short" }, 400);
  const password = await hashPassword(body.next);
  await db.batch([
    db
      .prepare("UPDATE admin SET password_hash = ?, salt = ?, iterations = ?, updated_at = ? WHERE id = 1")
      .bind(password.hash, password.salt, password.iterations, new Date().toISOString()),
    db.prepare("DELETE FROM sessions WHERE token_hash <> ?").bind(await sessionHash(c)),
  ]);
  return c.json({ ok: true });
});
