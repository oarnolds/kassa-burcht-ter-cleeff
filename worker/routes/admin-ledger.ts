import { Hono } from "hono";
import { z } from "zod";
import { addAttachment, hideAttachment, MAX_ATTACHMENT_BYTES, readAttachment } from "../db/attachments";
import { createEntry, editEntry, emptyEntry, entryHistory, getEntry, LedgerError, listEntries } from "../db/ledger";
import { addAccount, categoryAccounts, listAccounts, patchAccount, setCategoryAccounts } from "../db/ledger-accounts";
import { accountLines, balanceReport, comparisonYears, getComparison, multiYearReport, overview, resultReport, setComparison } from "../db/ledger-reports";
import { getOpening } from "../db/opening";
import type { AppEnv } from "../env";
import { runNightly } from "../nightly";
import { parseDate } from "../lib/params";

const cents = z.number().int();
const code = z.string().regex(/^\d{4}$/);

const accountBody = z.object({
  code,
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["asset", "liability", "equity", "expense", "income"]),
});
const accountPatch = z
  .object({ name: z.string().trim().min(1).max(60).optional(), hidden: z.boolean().optional() })
  .refine((body) => body.name !== undefined || body.hidden !== undefined);
const categoryBody = z.array(z.object({ categoryId: z.string().min(1).max(64), accountCode: z.string().max(10) })).max(100);

const entryBody = z.object({
  date: z.iso.date(),
  description: z.string().trim().min(1).max(200),
  lines: z
    // `assetId`: the toestel a line on 0130 or 0135 belongs to, sent back as it came so an edit keeps it (R32).
    .array(z.object({ accountCode: z.string().max(10), amountCents: cents, note: z.string().max(200).nullish(), assetId: z.string().max(64).nullish() }))
    .min(2)
    .max(50),
});
const toContent = (body: z.infer<typeof entryBody>) => ({
  date: body.date,
  description: body.description,
  lines: body.lines.map((line) => ({ accountCode: line.accountCode, amountCents: line.amountCents, note: line.note ?? null, assetId: line.assetId || null })),
});

const comparisonBody = z.object({ figures: z.array(z.object({ accountCode: z.string().max(10), amountCents: cents })).max(100) });

const yearOf = (value: string | undefined): number | null => (value && /^\d{4}$/.test(value) ? Number(value) : null);
const jsonBody = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => null);

/** Beheer → Boekhouding: accounts, entries, attachments, the opening, the reports. Mounted under /api/admin/boekhouding. */
export const adminLedger = new Hono<AppEnv>();

adminLedger.onError((error, c) => {
  if (error instanceof LedgerError) return c.json({ error: error.code }, error.status);
  throw error;
});

// ---- Accounts ----

adminLedger.get("/accounts", async (c) => c.json(await listAccounts(c.env.DB)));

adminLedger.post("/accounts", async (c) => {
  const body = accountBody.safeParse(await jsonBody(c));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await addAccount(c.env.DB, body.data), 201);
});

adminLedger.patch("/accounts/:code", async (c) => {
  const body = accountPatch.safeParse(await jsonBody(c));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await patchAccount(c.env.DB, c.req.param("code"), body.data));
});

adminLedger.post("/sync", async (c) => c.json(await runNightly(c.env, new Date())));

adminLedger.get("/category-accounts", async (c) => c.json(await categoryAccounts(c.env.DB)));

adminLedger.put("/category-accounts", async (c) => {
  const body = categoryBody.safeParse(await jsonBody(c));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await setCategoryAccounts(c.env.DB, body.data));
});

// ---- Entries ----

adminLedger.get("/entries", async (c) => {
  const year = yearOf(c.req.query("year"));
  const from = c.req.query("from");
  const to = c.req.query("to");
  const amount = c.req.query("amount");
  if (year === null || (from !== undefined && !parseDate(from)) || (to !== undefined && !parseDate(to))) return c.json({ error: "invalid" }, 400);
  if (amount !== undefined && !/^-?\d{1,12}$/.test(amount)) return c.json({ error: "invalid" }, 400);
  return c.json(
    await listEntries(c.env.DB, {
      year,
      accountCode: c.req.query("account") || undefined,
      from,
      to,
      text: c.req.query("text") || undefined,
      amountCents: amount === undefined ? undefined : Number(amount),
    }),
  );
});

adminLedger.post("/entries", async (c) => {
  const body = entryBody.safeParse(await jsonBody(c));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await createEntry(c.env.DB, { ...toContent(body.data), source: "manual" }, new Date()), 201);
});

adminLedger.put("/entries/:id", async (c) => {
  const body = entryBody.safeParse(await jsonBody(c));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await editEntry(c.env.DB, c.req.param("id"), toContent(body.data), new Date()));
});

adminLedger.get("/entries/:id", async (c) => {
  const entry = await getEntry(c.env.DB, c.req.param("id"));
  return entry ? c.json(entry) : c.json({ error: "not_found" }, 404);
});

adminLedger.post("/entries/:id/empty", async (c) => c.json(await emptyEntry(c.env.DB, c.req.param("id"), new Date())));

adminLedger.get("/entries/:id/history", async (c) => {
  const id = c.req.param("id");
  if (!(await getEntry(c.env.DB, id))) return c.json({ error: "not_found" }, 404);
  return c.json(await entryHistory(c.env.DB, id));
});

// ---- Attachments ----

adminLedger.post("/entries/:id/attachments", async (c) => {
  let filename: string;
  try {
    filename = decodeURIComponent(c.req.header("X-Filename") ?? "");
  } catch {
    return c.json({ error: "invalid" }, 400);
  }
  if (!filename) return c.json({ error: "invalid" }, 400);
  // The header is only a first look to refuse a huge body early; the size kept is that of the bytes received.
  if (Number(c.req.header("Content-Length") ?? 0) > MAX_ATTACHMENT_BYTES) return c.json({ error: "too_large" }, 400);
  const contentType = (c.req.header("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
  const body = await c.req.arrayBuffer();
  if (body.byteLength > MAX_ATTACHMENT_BYTES) return c.json({ error: "too_large" }, 400);
  const attachment = await addAttachment(c.env, c.req.param("id"), { filename, contentType, body, sizeBytes: body.byteLength }, new Date());
  return c.json(attachment, 201);
});

adminLedger.get("/attachments/:id", async (c) => {
  const found = await readAttachment(c.env, c.req.param("id"));
  if (!found) return c.json({ error: "not_found" }, 404);
  return new Response(found.body, {
    headers: {
      "Content-Type": found.attachment.contentType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(found.attachment.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

adminLedger.post("/attachments/:id/hide", async (c) => {
  await hideAttachment(c.env, c.req.param("id"), new Date());
  return c.json({ ok: true });
});

// ---- Opening and comparison figures ----

adminLedger.get("/opening", async (c) => {
  const year = yearOf(c.req.query("year"));
  if (year === null) return c.json({ error: "invalid" }, 400);
  return c.json(await getOpening(c.env.DB, year, new Date()));
});

/** The opening of 2026 comes from e-Boekhouden's auditfile and the toestellen list, and is not typed (spec §9). */
adminLedger.put("/opening", (c) => c.json({ error: "opening_from_file" }, 409));

adminLedger.get("/comparison/years", async (c) => c.json(await comparisonYears(c.env.DB)));

adminLedger.get("/comparison", async (c) => {
  const year = yearOf(c.req.query("year"));
  if (year === null) return c.json({ error: "invalid" }, 400);
  return c.json({ year, figures: await getComparison(c.env.DB, year) });
});

adminLedger.put("/comparison", async (c) => {
  const year = yearOf(c.req.query("year"));
  const body = comparisonBody.safeParse(await jsonBody(c));
  if (year === null || !body.success) return c.json({ error: "invalid" }, 400);
  await setComparison(c.env.DB, year, body.data.figures);
  return c.json({ year, figures: await getComparison(c.env.DB, year) });
});

// ---- Reports ----

adminLedger.get("/reports/balance", async (c) => {
  const date = parseDate(c.req.query("date"));
  if (!date) return c.json({ error: "invalid" }, 400);
  return c.json(await balanceReport(c.env.DB, date));
});

adminLedger.get("/reports/result", async (c) => {
  const from = parseDate(c.req.query("from"));
  const to = parseDate(c.req.query("to"));
  if (!from || !to || from > to) return c.json({ error: "invalid" }, 400);
  return c.json(await resultReport(c.env.DB, from, to));
});

adminLedger.get("/reports/years", async (c) => c.json(await multiYearReport(c.env.DB)));

adminLedger.get("/reports/account/:code", async (c) => {
  const from = parseDate(c.req.query("from"));
  const to = parseDate(c.req.query("to"));
  if (!from || !to || from > to) return c.json({ error: "invalid" }, 400);
  return c.json(await accountLines(c.env.DB, c.req.param("code"), from, to));
});

adminLedger.get("/overview", async (c) => c.json(await overview(c.env.DB, new Date())));
