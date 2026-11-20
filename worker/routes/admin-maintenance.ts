import { Hono } from "hono";
import { businessDate } from "../../shared/time";
import { exportAll, inUseSince, wipeTrialData } from "../db/maintenance";
import type { AppEnv } from "../env";

// Typed in by hand in beheer, so that a stray click cannot wipe anything.
const CONFIRM_WORD = "WISSEN";

/** Beheer: starting clean after the trial, and a full download. Mounted behind `requireAdmin`. */
export const adminMaintenance = new Hono<AppEnv>();

/** Whether wiping is still possible: not once the kassa has gone into real use. */
adminMaintenance.get("/wipe-trial", async (c) => c.json({ inUseSince: await inUseSince(c.env.DB) }));

adminMaintenance.post("/wipe-trial", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { confirm?: unknown; final?: unknown } | null;
  if (body?.confirm !== CONFIRM_WORD) return c.json({ error: "confirm_required" }, 400);
  if (body.final !== undefined && typeof body.final !== "boolean") return c.json({ error: "invalid" }, 400);
  const outcome = await wipeTrialData(c.env.DB, body.final === true, new Date());
  if (!outcome.wiped) return c.json({ error: "in_use", inUseSince: outcome.inUseSince }, 409);
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
