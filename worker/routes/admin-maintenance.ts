import { Hono } from "hono";
import { businessDate } from "../../shared/time";
import { exportAll, wipeTrialData } from "../db/maintenance";
import type { AppEnv } from "../env";

// Typed in by hand in beheer, so that a stray click cannot wipe anything.
const CONFIRM_WORD = "WISSEN";

/** Beheer: starting clean after the trial, and a full download. Mounted behind `requireAdmin`. */
export const adminMaintenance = new Hono<AppEnv>();

adminMaintenance.post("/wipe-trial", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== CONFIRM_WORD) return c.json({ error: "confirm_required" }, 400);
  await wipeTrialData(c.env.DB);
  return c.json({ ok: true });
});

adminMaintenance.get("/export.json", async (c) => {
  const now = new Date();
  const file = await exportAll(c.env.DB, now);
  return c.body(JSON.stringify(file), 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="kassa-export-${businessDate(now.toISOString())}.json"`,
  });
});
