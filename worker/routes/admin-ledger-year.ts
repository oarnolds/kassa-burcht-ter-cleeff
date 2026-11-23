import { Hono } from "hono";
import { z } from "zod";
import { LedgerError } from "../db/ledger";
import { closeYear, listYears, reopenYear, yearChecks } from "../db/year";
import type { AppEnv } from "../env";

const closeBody = z.object({ note: z.string().max(1000).nullish() });
const reopenBody = z.object({ reason: z.string().max(1000).optional() });

const yearOf = (value: string): number | null => (/^\d{4}$/.test(value) ? Number(value) : null);
const jsonBody = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => null);

/** Beheer → Boekhouding → Jaar: the checks, closing a year and reopening it. Mounted under /api/admin/boekhouding. */
export const adminLedgerYear = new Hono<AppEnv>();

adminLedgerYear.onError((error, c) => {
  if (error instanceof LedgerError) return c.json({ error: error.code }, error.status);
  throw error;
});

/** Every year, oldest first, with its closing and reopening. */
adminLedgerYear.get("/years", async (c) => c.json(await listYears(c.env.DB)));

adminLedgerYear.get("/year/:year/checks", async (c) => {
  const year = yearOf(c.req.param("year"));
  if (year === null) return c.json({ error: "invalid" }, 400);
  return c.json(await yearChecks(c.env, year, new Date()));
});

adminLedgerYear.post("/year/:year/close", async (c) => {
  const year = yearOf(c.req.param("year"));
  const body = closeBody.safeParse(await jsonBody(c));
  if (year === null || !body.success) return c.json({ error: "invalid" }, 400);
  await closeYear(c.env, year, body.data.note ?? null, new Date());
  return c.json({ ok: true });
});

/** Without a reason (or a shorter one than 3 characters) it is refused as `reason_required`. */
adminLedgerYear.post("/year/:year/reopen", async (c) => {
  const year = yearOf(c.req.param("year"));
  const body = reopenBody.safeParse(await jsonBody(c));
  if (year === null || !body.success) return c.json({ error: "invalid" }, 400);
  await reopenYear(c.env.DB, year, body.data.reason ?? "", new Date());
  return c.json({ ok: true });
});
