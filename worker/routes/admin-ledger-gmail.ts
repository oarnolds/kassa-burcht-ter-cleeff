import { Hono } from "hono";
import { z } from "zod";
import { attachFromGmail, findFiles, finishLink, gmailState, startLink, unlink } from "../db/gmail";
import { LedgerError } from "../db/ledger";
import type { AppEnv } from "../env";

/** Beheer → Boekhouding: the Gmail link and "Zoek bijlage". Mounted under /api/admin/boekhouding, behind the login. */
export const adminLedgerGmail = new Hono<AppEnv>();

adminLedgerGmail.onError((error, c) => {
  if (error instanceof LedgerError) return c.json({ error: error.code }, error.status);
  throw error;
});

const callbackBody = z.object({ code: z.string().min(1).max(2000), state: z.string().min(1).max(200) });
// Gmail's message ids are hex; a part is numbered like 1 or 1.2.
const pickBody = z.object({ messageId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), partId: z.string().max(40).regex(/^\d+(\.\d+)*$/) });

adminLedgerGmail.get("/gmail", async (c) => c.json(await gmailState(c.env)));

adminLedgerGmail.post("/gmail/connect", async (c) => c.json(await startLink(c.env, new URL(c.req.url).origin, new Date())));

adminLedgerGmail.post("/gmail/callback", async (c) => {
  const body = callbackBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await finishLink(c.env, body.data, new URL(c.req.url).origin, new Date()));
});

adminLedgerGmail.post("/gmail/disconnect", async (c) => c.json(await unlink(c.env)));

adminLedgerGmail.get("/entries/:id/gmail", async (c) => c.json({ candidates: await findFiles(c.env, c.req.param("id")) }));

adminLedgerGmail.post("/entries/:id/gmail", async (c) => {
  const body = pickBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "invalid" }, 400);
  return c.json(await attachFromGmail(c.env, c.req.param("id"), body.data, new Date()), 201);
});
