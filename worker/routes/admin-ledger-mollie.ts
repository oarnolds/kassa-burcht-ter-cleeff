import { Hono } from "hono";
import { z } from "zod";
import { LedgerError } from "../db/ledger";
import { businessDate, monthOf } from "../../shared/time";
import { deleteRule, listRules, mollieMonth, saveRule } from "../db/mollie-ledger";
import type { AppEnv } from "../env";

const ruleBody = z.object({
  id: z.string().min(1).max(64).optional(),
  keyword: z.string().trim().min(2).max(40),
  accountCode: z.string().max(10),
});

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Beheer → Boekhouding: Mollie. Mounted under /api/admin/boekhouding, behind `requireAdmin`. */
export const adminLedgerMollie = new Hono<AppEnv>();

adminLedgerMollie.onError((error, c) => {
  if (error instanceof LedgerError) return c.json({ error: error.code }, error.status);
  throw error;
});

adminLedgerMollie.get("/mollie/rules", async (c) => c.json(await listRules(c.env.DB)));

/** Without `id` a new rule, at the end; with `id` that rule changed in place. */
adminLedgerMollie.post("/mollie/rules", async (c) => {
  const body = ruleBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await saveRule(c.env.DB, body.data), body.data.id === undefined ? 201 : 200);
});

adminLedgerMollie.delete("/mollie/rules/:id", async (c) => {
  await deleteRule(c.env.DB, c.req.param("id"));
  return c.json({ ok: true });
});

/** A month (`YYYY-MM`, the current one without) of Mollie next to the books. */
adminLedgerMollie.get("/mollie/month", async (c) => {
  const now = new Date();
  const month = c.req.query("month") || monthOf(businessDate(now.toISOString()));
  if (!MONTH.test(month)) return c.json({ error: "invalid" }, 400);
  return c.json(await mollieMonth(c.env.DB, month, now));
});
