import { Hono } from "hono";
import { z } from "zod";
import { MAX_BUDGET_CENTS } from "../../shared/budget";
import { budgetActuals, deleteBudget, deleteBudgetLine, getBudget, putBudget, putBudgetLine } from "../db/budget";
import { LedgerError } from "../db/ledger";
import type { AppEnv } from "../env";
import { parseDate } from "../lib/params";

const date = z.string().refine((value) => parseDate(value) !== null);
const months = z.array(z.number().int().min(-MAX_BUDGET_CENTS).max(MAX_BUDGET_CENTS)).length(12);

// The rule itself is read by shared/budget.ts (readRule), and the source as a whole by db/budget.ts, so that their
// refusals have their own codes.
const budgetBody = z.object({
  source: z.object({
    kind: z.enum(["mutations", "ledger", "empty"]),
    baseYear: z.number().int().min(1900).max(9999).nullable(),
    from: date.nullable(),
    to: date.nullable(),
  }),
  lines: z
    .array(
      z.object({
        accountCode: z.string().max(10),
        rule: z.unknown(),
        base: months.nullish().transform((value) => value ?? null),
      }),
    )
    .max(100),
});
// A missing rule is a rule that cannot be read ("invalid_rule"), not a body of the wrong shape.
const lineBody = z.object({ rule: z.unknown().optional() });

const yearOf = (value: string | undefined): number | null => (value && /^\d{4}$/.test(value) ? Number(value) : null);
const jsonBody = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => null);

/** Beheer → Boekhouding → Begroting: a budget per year, and the books per month next to it. Mounted under /api/admin/boekhouding. */
export const adminLedgerBudget = new Hono<AppEnv>();

adminLedgerBudget.onError((error, c) => {
  if (error instanceof LedgerError) return c.json({ error: error.code }, error.status);
  throw error;
});

adminLedgerBudget.get("/budget", async (c) => {
  const year = yearOf(c.req.query("year"));
  if (year === null) return c.json({ error: "invalid" }, 400);
  return c.json(await getBudget(c.env.DB, year, new Date()));
});

/** The whole year at once: its source and every line (the Worker works out the months). */
adminLedgerBudget.put("/budget", async (c) => {
  const year = yearOf(c.req.query("year"));
  const body = budgetBody.safeParse(await jsonBody(c));
  if (year === null || !body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await putBudget(c.env.DB, year, body.data, new Date()));
});

adminLedgerBudget.delete("/budget", async (c) => {
  const year = yearOf(c.req.query("year"));
  if (year === null) return c.json({ error: "invalid" }, 400);
  await deleteBudget(c.env.DB, year, new Date());
  return c.json({ ok: true });
});

/** One line added or changed: only its rule; a line keeps its base. */
adminLedgerBudget.put("/budget/line", async (c) => {
  const year = yearOf(c.req.query("year"));
  const body = lineBody.safeParse(await jsonBody(c));
  if (year === null || !body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await putBudgetLine(c.env.DB, year, c.req.query("account") ?? "", body.data.rule, new Date()));
});

adminLedgerBudget.delete("/budget/line", async (c) => {
  const year = yearOf(c.req.query("year"));
  if (year === null) return c.json({ error: "invalid" }, 400);
  await deleteBudgetLine(c.env.DB, year, c.req.query("account") ?? "", new Date());
  return c.json({ ok: true });
});

/** A year of the books per income and expense account and month, to lay next to its budget. */
adminLedgerBudget.get("/budget/actuals", async (c) => {
  const year = yearOf(c.req.query("year"));
  if (year === null) return c.json({ error: "invalid" }, 400);
  return c.json(await budgetActuals(c.env.DB, year));
});
