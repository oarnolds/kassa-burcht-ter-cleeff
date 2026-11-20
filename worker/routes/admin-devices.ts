import { Hono } from "hono";
import type { Device } from "../../shared/types";
import type { AppEnv } from "../env";
import { sha256Hex } from "../lib/crypto";

const CODE_MINUTES = 10;

/** Beheer: pairing codes and the list of paired kassa's. Mounted behind `requireAdmin`. */
export const adminDevices = new Hono<AppEnv>();

adminDevices.post("/pairing-codes", async (c) => {
  const db = c.env.DB;
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_MINUTES * 60_000).toISOString();
  // Only the newest code works; older ones, used or not, are gone.
  await db.batch([
    db.prepare("DELETE FROM pairing_codes"),
    db
      .prepare("INSERT INTO pairing_codes (code_hash, created_at, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256Hex(code), now.toISOString(), expiresAt),
  ]);
  return c.json({ code, expiresAt }, 201);
});

adminDevices.get("/devices", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, created_at, last_seen_at, revoked_at FROM devices ORDER BY created_at, id",
  ).all<{ id: string; name: string; created_at: string; last_seen_at: string | null; revoked_at: string | null }>();
  const devices: Device[] = results.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revoked: row.revoked_at !== null,
  }));
  return c.json({ devices });
});

adminDevices.post("/devices/:id/revoke", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const exists = await db.prepare("SELECT 1 FROM devices WHERE id = ?").bind(id).first();
  if (!exists) return c.json({ error: "not_found" }, 404);
  await db
    .prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), id)
    .run();
  return c.json({ ok: true });
});
