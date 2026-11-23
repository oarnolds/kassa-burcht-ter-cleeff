import { Hono } from "hono";
import { z } from "zod";
import { YEAR_PAGE } from "../../shared/ledger-types";
import { changesPage, entriesPage, LedgerError } from "../db/ledger";
import { closeYear, listYears, reopenYear, yearChecks, yearExport } from "../db/year";
import type { AppEnv } from "../env";

const closeBody = z.object({ note: z.string().max(1000).nullish() });
const reopenBody = z.object({ reason: z.string().max(1000).optional() });

const yearOf = (value: string): number | null => (/^\d{4}$/.test(value) ? Number(value) : null);
/** A whole number from `min` to `max` written in digits; `fallback` when it is not given. */
const wholeOf = (value: string | undefined, fallback: number, min: number, max: number): number | null => {
  if (value === undefined) return fallback;
  if (!/^\d{1,15}$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
};
const jsonBody = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => null);

/**
 * Beheer → Boekhouding → Jaar: the checks, closing a year and reopening it, and what the jaaroverzicht reads.
 * Mounted under /api/admin/boekhouding.
 */
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

// ---- The jaaroverzicht: the browser makes the Excel file, the PDF and the zip from these (spec §15) ----

adminLedgerYear.get("/year/:year/export", async (c) => {
  const year = yearOf(c.req.param("year"));
  if (year === null) return c.json({ error: "invalid" }, 400);
  return c.json(await yearExport(c.env, year, new Date()));
});

/** The entries numbered after `after`, by number, `limit` (at most YEAR_PAGE) at a time. */
adminLedgerYear.get("/year/:year/entries", async (c) => {
  const year = yearOf(c.req.param("year"));
  const after = wholeOf(c.req.query("after"), 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = wholeOf(c.req.query("limit"), YEAR_PAGE, 1, YEAR_PAGE);
  if (year === null || after === null || limit === null) return c.json({ error: "invalid" }, 400);
  return c.json(await entriesPage(c.env.DB, year, after, limit));
});

/** The changes of the year's entries after the change `after`, by id, YEAR_PAGE at a time. */
adminLedgerYear.get("/year/:year/changes", async (c) => {
  const year = yearOf(c.req.param("year"));
  const after = wholeOf(c.req.query("after"), 0, 0, Number.MAX_SAFE_INTEGER);
  if (year === null || after === null) return c.json({ error: "invalid" }, 400);
  return c.json(await changesPage(c.env.DB, year, after, YEAR_PAGE));
});
