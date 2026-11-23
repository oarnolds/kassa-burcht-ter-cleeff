import { Hono } from "hono";
import { z } from "zod";
import { addTypedLine, autoBook, bookLine, getBankLine, importStatement, moneyAccounts, openLines, setMoneyAccount } from "../db/bank";
import { consentState, finishConsent, startConsent } from "../db/bank-consent";
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

const bookBody = z.object({
  split: z
    .array(z.object({ accountCode: z.string().max(10), amountCents: cents.refine((value) => value !== 0), assetId: z.string().max(64).nullish() }))
    .min(1)
    .max(20),
  description: z.string().trim().min(1).max(200).optional(),
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
  const now = new Date();
  const result = await importStatement(c.env.DB, body.data.accountCode, body.data.statement, now);
  return c.json({ ...result, autoBooked: await autoBook(c.env.DB, now) });
});

adminLedgerBank.post("/bank/lines", async (c) => {
  const body = typedBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  const now = new Date();
  const line = await addTypedLine(c.env.DB, { ...body.data, counterpartyName: body.data.counterpartyName || null }, now);
  await autoBook(c.env.DB, now);
  return c.json((await getBankLine(c.env.DB, line.id)) ?? line, 201);
});

adminLedgerBank.get("/bank/lines", async (c) => c.json(await openLines(c.env.DB, { accountCode: c.req.query("account") || undefined })));

adminLedgerBank.post("/bank/lines/:id/book", async (c) => {
  const body = bookBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await bookLine(c.env.DB, c.req.param("id"), body.data, new Date()));
});

// ---- ING through Enable Banking ----

const callbackBody = z.object({ code: z.string().min(1).max(2000), state: z.string().min(1).max(200) });

adminLedgerBank.get("/bank/ing", async (c) => c.json(await consentState(c.env.DB, new Date())));

adminLedgerBank.post("/bank/ing/connect", async (c) => c.json(await startConsent(c.env, new URL(c.req.url).origin, new Date())));

adminLedgerBank.post("/bank/ing/callback", async (c) => {
  const body = callbackBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await finishConsent(c.env, body.data, new Date()));
});
