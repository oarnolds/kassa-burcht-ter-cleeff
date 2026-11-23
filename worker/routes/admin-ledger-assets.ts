import { Hono } from "hono";
import { z } from "zod";
import { MAX_LIFE_YEARS } from "../../shared/asset-paste";
import { LEDGER_START } from "../../shared/ledger-types";
import { addPastedAssets, ALL_DATES, bookDepreciation, depreciationPlan, disposeAsset, listAssets, saveAsset } from "../db/assets";
import { LedgerError } from "../db/ledger";
import type { AppEnv } from "../env";
import { parseDate } from "../lib/params";

const FIRST_YEAR = Number(LEDGER_START.slice(0, 4));

const name = z.string().trim().min(1).max(60);
const lifeYears = z.number().int().min(1).max(MAX_LIFE_YEARS);
const cents = z.number().int().min(0);
const date = z.string().refine((value) => parseDate(value) !== null);
const year = z.number().int().min(FIRST_YEAR).max(9999);

const pasteBody = z.object({
  assets: z
    .array(z.object({ name: z.string().trim().min(1).max(200), purchaseDate: date, costCents: cents, writtenOffCents: cents, lifeYears }))
    .min(1)
    .max(500),
});
const newBody = z.object({ name, lifeYears, residualCents: cents });
const patchBody = z
  .object({ name: name.optional(), lifeYears: lifeYears.optional(), residualCents: cents.optional() })
  .refine((body) => body.name !== undefined || body.lifeYears !== undefined || body.residualCents !== undefined);
const disposeBody = z.object({ date });
const depreciationBody = z.object({ year: z.number().int() });

const jsonBody = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => null);

/** Beheer → Boekhouding: the speeltoestellen, their depreciation and disposal. Mounted under /api/admin/boekhouding. */
export const adminLedgerAssets = new Hono<AppEnv>();

adminLedgerAssets.onError((error, c) => {
  if (error instanceof LedgerError) return c.json({ error: error.code }, error.status);
  throw error;
});

/** The list with everything booked so far, or as it stood at the end of `?date=`. */
adminLedgerAssets.get("/assets", async (c) => {
  const asked = c.req.query("date");
  const upTo = asked === undefined ? ALL_DATES : parseDate(asked);
  if (upTo === null) return c.json({ error: "invalid" }, 400);
  return c.json(await listAssets(c.env.DB, upTo));
});

/** The list read from e-Boekhouden's "Vaste activa" (the browser reads the paste): the opening toestellen, replaced. */
adminLedgerAssets.post("/assets/paste", async (c) => {
  const body = pasteBody.safeParse(await jsonBody(c));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await addPastedAssets(c.env.DB, body.data.assets, new Date()));
});

/** A toestel bought later; its cost is what is booked on 0130 for it. */
adminLedgerAssets.post("/assets", async (c) => {
  const body = newBody.safeParse(await jsonBody(c));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await saveAsset(c.env.DB, body.data, new Date()), 201);
});

adminLedgerAssets.patch("/assets/:id", async (c) => {
  const body = patchBody.safeParse(await jsonBody(c));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await saveAsset(c.env.DB, { ...body.data, id: c.req.param("id") }, new Date()));
});

adminLedgerAssets.post("/assets/:id/dispose", async (c) => {
  const body = disposeBody.safeParse(await jsonBody(c));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await disposeAsset(c.env.DB, c.req.param("id"), body.data.date, new Date()));
});

adminLedgerAssets.get("/depreciation", async (c) => {
  const asked = c.req.query("year");
  if (!asked || !/^\d{4}$/.test(asked)) return c.json({ error: "invalid" }, 400);
  const parsed = year.safeParse(Number(asked));
  if (!parsed.success) return c.json({ error: "year_unknown" }, 400);
  return c.json(await depreciationPlan(c.env.DB, parsed.data));
});

adminLedgerAssets.post("/depreciation", async (c) => {
  const body = depreciationBody.safeParse(await jsonBody(c));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  if (!year.safeParse(body.data.year).success) return c.json({ error: "year_unknown" }, 400);
  return c.json(await bookDepreciation(c.env.DB, body.data.year, new Date()));
});
