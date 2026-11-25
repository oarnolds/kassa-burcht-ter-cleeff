import { Hono } from "hono";
import { z } from "zod";
import { PAYOUT_REFERENCE } from "../../shared/ledger-types";
import { eboekhoudenStatus, finishImport, importEntries, startImport } from "../db/eboekhouden";
import { LedgerError } from "../db/ledger";
import type { AppEnv } from "../env";

const cents = z.number().int();
const code = z.string().regex(/^\d{4}$/);
const ref = z.string().min(1).max(64);

const startBody = z.object({
  createdOn: z.iso.date(),
  /** Signed as the auditfile has them: debit +, credit −. */
  opening: z.array(z.object({ accountCode: code, amountCents: cents })).max(100),
  ebEquityCents: cents,
  /** Bare references, as PAYOUT_REFERENCE finds them in a description. */
  payouts: z.array(z.string().max(20).refine((value) => PAYOUT_REFERENCE.exec(value)?.[1] === value)).max(1000),
});
// At most MAX_ENTRIES entries: `importEntries` refuses more with `too_many`.
const entriesBody = z.object({
  entries: z.array(
    z.object({
      ref,
      date: z.iso.date(),
      description: z.string().max(500),
      lines: z.array(z.object({ accountCode: code, amountCents: cents, note: z.string().max(1000).nullable() })).min(1).max(100),
    }),
  ),
});
const finishBody = z.object({ createdOn: z.iso.date(), refs: z.array(ref).max(5000) });

const jsonBody = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => null);

/**
 * Beheer → Boekhouding → Instellingen → "2026 uit e-Boekhouden inlezen": the browser reads the auditfile and sends
 * the opening, the bookings in chunks and the finish (spec §7). Mounted under /api/admin/boekhouding.
 */
export const adminLedgerEboekhouden = new Hono<AppEnv>();

adminLedgerEboekhouden.onError((error, c) => {
  if (error instanceof LedgerError) return c.json({ error: error.code }, error.status);
  throw error;
});

adminLedgerEboekhouden.get("/eboekhouden/status", async (c) => c.json(await eboekhoudenStatus(c.env.DB)));

adminLedgerEboekhouden.post("/eboekhouden/start", async (c) => {
  const body = startBody.safeParse(await jsonBody(c));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  await startImport(c.env.DB, body.data, new Date());
  return c.json({ ok: true });
});

adminLedgerEboekhouden.post("/eboekhouden/entries", async (c) => {
  const body = entriesBody.safeParse(await jsonBody(c));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await importEntries(c.env.DB, body.data.entries, new Date()));
});

adminLedgerEboekhouden.post("/eboekhouden/finish", async (c) => {
  const body = finishBody.safeParse(await jsonBody(c));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await finishImport(c.env.DB, body.data, new Date()));
});
