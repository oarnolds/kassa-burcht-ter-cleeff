import { Hono } from "hono";
import { z } from "zod";
import { addTypedLine, importStatement, moneyAccounts, setMoneyAccount } from "../db/bank";
import { LedgerError } from "../db/ledger";
import type { AppEnv } from "../env";

/** A year of a busy account is about 1.000 lines; more than this in one request is refused, not cut short. */
export const MAX_IMPORT_LINES = 2000;

const date = z.iso.date();
const cents = z.number().int();
const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((value) => value ?? null);

const camtLine = z.object({
  bookingDate: date,
  amountCents: cents,
  description: z.string().max(4000),
  counterpartyName: text(500),
  counterpartyIban: text(64),
  bankRef: text(200),
});
const balance = z
  .object({ date, cents })
  .nullish()
  .transform((value) => value ?? null);

const importBody = z.object({
  accountCode: z.string().max(10),
  statement: z.object({
    account: z.string().trim().min(1).max(64),
    opening: balance,
    closing: balance,
    lines: z.array(camtLine),
  }),
});

const typedBody = z.object({
  accountCode: z.string().max(10),
  date,
  amountCents: cents.refine((value) => value !== 0),
  description: z.string().trim().min(1).max(200),
  counterpartyName: z.string().trim().max(200).nullish(),
});

const accountBody = z.object({
  identifier: z.string().max(64).nullish(),
  source: z.enum(["file", "enable_banking", "kassa", "mollie"]).optional(),
});

const tooManyLines = (body: unknown) => {
  const lines = (body as { statement?: { lines?: unknown } } | null)?.statement?.lines;
  return Array.isArray(lines) && lines.length > MAX_IMPORT_LINES;
};

/** Beheer → Boekhouding: money accounts and bank lines. Mounted under /api/admin/boekhouding, behind `requireAdmin`. */
export const adminLedgerBank = new Hono<AppEnv>();

adminLedgerBank.onError((error, c) => {
  if (error instanceof LedgerError) return c.json({ error: error.code }, error.status);
  throw error;
});

adminLedgerBank.get("/money-accounts", async (c) => c.json(await moneyAccounts(c.env.DB, new Date())));

adminLedgerBank.patch("/money-accounts/:code", async (c) => {
  const body = accountBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await setMoneyAccount(c.env.DB, c.req.param("code"), body.data, new Date()));
});

adminLedgerBank.post("/bank/import", async (c) => {
  const raw: unknown = await c.req.json().catch(() => null);
  if (tooManyLines(raw)) return c.json({ error: "too_many_lines" }, 400);
  const body = importBody.safeParse(raw);
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await importStatement(c.env.DB, body.data.accountCode, body.data.statement, new Date()));
});

adminLedgerBank.post("/bank/lines", async (c) => {
  const body = typedBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  const line = await addTypedLine(c.env.DB, { ...body.data, counterpartyName: body.data.counterpartyName || null }, new Date());
  return c.json(line, 201);
});
