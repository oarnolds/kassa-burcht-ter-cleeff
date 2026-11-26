import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GmailCandidate, GmailState } from "../shared/ledger-types";
import { exportAll } from "../worker/db/maintenance";
import { finishLink, nameWords, startLink } from "../worker/db/gmail";
import type { Env } from "../worker/env";
import { createFakeGoogle, FAKE_GOOGLE_CLIENT_ID, FAKE_GOOGLE_CLIENT_SECRET, FAKE_REFRESH_TOKEN, type FakeGoogle } from "./fake-google";
import { api, asAdmin, openGate, resetData } from "./helpers";

const base = "/api/admin/boekhouding";
const NOW = new Date("2026-11-26T12:00:00.000Z");
const ORIGIN = "https://beheer.example";
const keys: Partial<Env> = { GOOGLE_CLIENT_ID: FAKE_GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: FAKE_GOOGLE_CLIENT_SECRET };
// 0xfb and 0xff come out as "-" and "_" in base64url, so the decoding of Gmail's alphabet is exercised.
const PDF = new Uint8Array([...new TextEncoder().encode("%PDF-1.4 factuur "), 0xfb, 0xff, 0xfe, 0x3e, 0x3f]);
const FOLDER = new TextEncoder().encode("%PDF-1.4 folder");

let google: FakeGoogle;
let cookie: string;
let gEnv: Env;

beforeEach(async () => {
  await resetData();
  await openGate();
  cookie = (await asAdmin()).cookie;
  gEnv = { ...env, ...keys } as Env;
  google = createFakeGoogle();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => google.handle(new Request(input, init)));
  google.messages = [
    {
      id: "m-news",
      from: "TalentPro <nieuws@talentpro.nl>",
      subject: "Nieuwsbrief november",
      date: "2026-11-15T09:00:00.000Z",
      snippet: "Ons nieuws van deze maand",
      files: [
        { partId: "1", filename: "logo.gif", mimeType: "image/gif", data: new Uint8Array([1, 2, 3]) },
        { partId: "2", filename: "folder.pdf", mimeType: "application/octet-stream", data: FOLDER },
      ],
    },
    {
      id: "m-invoice",
      from: "TalentPro <facturen@talentpro.nl>",
      subject: "Factuur 2026-1234",
      date: "2026-11-02T09:00:00.000Z",
      snippet: "In de bijlage vindt u onze factuur",
      files: [{ partId: "1", filename: "factuur-2026-1234.pdf", mimeType: "application/pdf", data: PDF }],
    },
  ];
  google.find = (q) => (q.includes('"412,80"') ? ["m-invoice"] : q.includes("TalentPro") ? ["m-news", "m-invoice"] : []);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ledger_entries (id, year, number, date, description, source, source_ref, created_at, updated_at)
       VALUES ('g1', 2026, 900, '2026-11-20', 'TalentPro B.V. – Naam: TalentPro B.V. Omschrijving: Factuur 2026-1234 IBAN: NL91ABNA0417164300', 'manual', NULL, 'a', 'a')`,
    ),
    env.DB.prepare("INSERT INTO ledger_lines (entry_id, account_code, amount_cents) VALUES ('g1', '4401', 41280), ('g1', '1010', -41280)"),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const stateOf = async () => (await env.DB.prepare("SELECT state FROM gmail_links ORDER BY created_at DESC, rowid DESC").first<{ state: string }>())!.state;

async function link(): Promise<GmailState> {
  await startLink(gEnv, ORIGIN, NOW);
  return finishLink(gEnv, { code: "code-1", state: await stateOf() }, ORIGIN, NOW);
}

it("says Gmail is not set up while the Google keys are missing", async () => {
  const none = { GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined };
  const answer = await api(`${base}/gmail`, { cookie, env: none });
  expect(await answer.json()).toEqual({ status: "not_configured", email: null });
  const connect = await api(`${base}/gmail/connect`, { method: "POST", cookie, env: none });
  expect(connect.status).toBe(409);
  expect(await connect.json()).toEqual({ error: "gmail_off" });
});

it("sends the penningmeester to Google for read-only access, and back to /beheer/gmail", async () => {
  const { url } = await (await api(`${base}/gmail/connect`, { method: "POST", cookie, env: keys })).json<{ url: string }>();
  const page = new URL(url);
  expect(page.origin + page.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  expect(page.searchParams.get("client_id")).toBe(FAKE_GOOGLE_CLIENT_ID);
  expect(page.searchParams.get("redirect_uri")).toBe("http://localhost/beheer/gmail");
  expect(page.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
  expect(page.searchParams.get("access_type")).toBe("offline");
  expect(page.searchParams.get("prompt")).toBe("consent");
  expect(page.searchParams.get("state")).toBe(await stateOf());
  expect(url).not.toContain(FAKE_GOOGLE_CLIENT_SECRET);
});

it("links once: the state is spent, and the refresh token never leaves the Worker", async () => {
  expect(await link()).toEqual({ status: "active", email: "speeltuin@gmail.com" });
  const token = google.requests.find((r) => r.grant === "authorization_code")!;
  expect(token.host).toBe("oauth2.googleapis.com");

  const again = await api(`${base}/gmail/callback`, { method: "POST", cookie, env: keys, json: { code: "code-1", state: await stateOf() } });
  expect(again.status).toBe(409);
  expect(await again.json()).toEqual({ error: "state_invalid" });

  const shown = await (await api(`${base}/gmail`, { cookie, env: keys })).text();
  expect(shown).not.toContain(FAKE_REFRESH_TOKEN);
  expect(JSON.stringify(await exportAll(env.DB, NOW))).not.toContain(FAKE_REFRESH_TOKEN);
});

it("refuses a state that has gone stale", async () => {
  await startLink(gEnv, ORIGIN, NOW);
  const later = new Date(NOW.getTime() + 31 * 60_000);
  await expect(finishLink(gEnv, { code: "code-1", state: await stateOf() }, ORIGIN, later)).rejects.toMatchObject({ code: "state_invalid" });
});

it("finds the files around the entry's date, with the name from the bank line, and puts the mail Gmail found the amount in first", async () => {
  await link();
  const answer = await api(`${base}/entries/g1/gmail`, { cookie, env: keys });
  expect(answer.status).toBe(200);
  const { candidates } = await answer.json<{ candidates: GmailCandidate[] }>();
  expect(candidates).toEqual([
    {
      messageId: "m-invoice",
      partId: "1",
      date: "2026-11-02",
      from: "TalentPro <facturen@talentpro.nl>",
      subject: "Factuur 2026-1234",
      filename: "factuur-2026-1234.pdf",
      contentType: "application/pdf",
      sizeBytes: PDF.byteLength,
      amountFound: true,
    },
    {
      messageId: "m-news",
      partId: "2",
      date: "2026-11-15",
      from: "TalentPro <nieuws@talentpro.nl>",
      subject: "Nieuwsbrief november",
      filename: "folder.pdf",
      contentType: "application/pdf",
      sizeBytes: FOLDER.byteLength,
      amountFound: false,
    },
  ]);
  const searches = google.requests.filter((r) => r.path.endsWith("/messages")).map((r) => r.query.q!);
  expect(searches.length).toBeGreaterThan(0);
  for (const q of searches) {
    expect(q).toContain("after:2026/09/21");
    expect(q).toContain("before:2026/12/06");
    expect(q).toContain("has:attachment");
  }
  expect(searches.some((q) => q.includes("TalentPro"))).toBe(true);
  expect(searches.some((q) => q.includes('"412,80"'))).toBe(true);
});

it("puts a PDF before a picture, so logos do not crowd out the invoice", async () => {
  await link();
  google.messages.push({
    id: "m-logo",
    from: "TalentPro <info@talentpro.nl>",
    subject: "Welkom",
    date: "2026-11-19T09:00:00.000Z",
    snippet: "Welkom",
    files: [{ partId: "1", filename: "logo.png", mimeType: "image/png", data: new Uint8Array([1]) }],
  });
  google.find = () => ["m-logo", "m-news"];
  const { candidates } = await (await api(`${base}/entries/g1/gmail`, { cookie, env: keys })).json<{ candidates: GmailCandidate[] }>();
  expect(candidates.map((c) => c.filename)).toEqual(["folder.pdf", "logo.png"]);
});

it("still shows what it could read when one mail cannot be read", async () => {
  await link();
  google.find = () => ["m-gone", "m-invoice"];
  const answer = await api(`${base}/entries/g1/gmail`, { cookie, env: keys });
  expect(answer.status).toBe(200);
  expect((await answer.json<{ candidates: GmailCandidate[] }>()).candidates.map((c) => c.messageId)).toEqual(["m-invoice"]);
});

it("says so when Google refuses because the Gmail API is not switched on", async () => {
  await link();
  google.forbid();
  const answer = await api(`${base}/entries/g1/gmail`, { cookie, env: keys });
  expect(answer.status).toBe(502);
  expect(await answer.json()).toEqual({ error: "gmail_forbidden" });
});

it("revokes the earlier link when another address is linked, but not when the same one is linked again", async () => {
  await link();
  await link();
  expect(google.revoked).toEqual([]);
  google.email = "ander@gmail.com";
  await link();
  expect(google.revoked).toEqual([FAKE_REFRESH_TOKEN]);
});

it("adds the chosen file to the entry, found again by its part, with Gmail's name and type", async () => {
  await link();
  const added = await api(`${base}/entries/g1/gmail`, { method: "POST", cookie, env: keys, json: { messageId: "m-invoice", partId: "1" } });
  expect(added.status).toBe(201);
  expect(await added.json()).toMatchObject({ filename: "factuur-2026-1234.pdf", contentType: "application/pdf", sizeBytes: PDF.byteLength });
  const row = (await env.DB.prepare("SELECT r2_key FROM ledger_attachments WHERE entry_id = 'g1'").first<{ r2_key: string }>())!;
  const stored = await env.ATTACHMENTS.get(row.r2_key);
  expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(PDF);
});

it("refuses a part that is not a file the boekhouding keeps", async () => {
  await link();
  const gif = await api(`${base}/entries/g1/gmail`, { method: "POST", cookie, env: keys, json: { messageId: "m-news", partId: "1" } });
  expect(gif.status).toBe(400);
  expect(await gif.json()).toEqual({ error: "wrong_type" });
  const none = await api(`${base}/entries/g1/gmail`, { method: "POST", cookie, env: keys, json: { messageId: "m-news", partId: "7" } });
  expect(none.status).toBe(404);
});

it("says when Gmail is not linked yet", async () => {
  const answer = await api(`${base}/entries/g1/gmail`, { cookie, env: keys });
  expect(answer.status).toBe(409);
  expect(await answer.json()).toEqual({ error: "gmail_not_linked" });
});

it("asks to link again once Google no longer accepts the link", async () => {
  await link();
  google.expire();
  const answer = await api(`${base}/entries/g1/gmail`, { cookie, env: keys });
  expect(answer.status).toBe(409);
  expect(await answer.json()).toEqual({ error: "gmail_expired" });
  expect(await (await api(`${base}/gmail`, { cookie, env: keys })).json()).toEqual({ status: "expired", email: "speeltuin@gmail.com" });
});

it("unlinks: the token is revoked at Google and gone from the Worker", async () => {
  await link();
  const answer = await api(`${base}/gmail/disconnect`, { method: "POST", cookie, env: keys });
  expect(await answer.json()).toEqual({ status: "none", email: null });
  expect(google.revoked).toEqual([FAKE_REFRESH_TOKEN]);
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM gmail_links WHERE refresh_token IS NOT NULL").first<{ n: number }>();
  expect(left!.n).toBe(0);
});

it("takes the name from a bank line's Naam, else the first words that are not numbers or filler", () => {
  expect(nameWords("TalentPro B.V. – Naam: TalentPro B.V. Omschrijving: Factuur 2026-1234 IBAN: NL91ABNA0417164300")).toEqual(["TalentPro"]);
  expect(nameWords("Mollie B.V. via Stichting Mollie Payments – Naam: Mollie B.V. via Stichting Mollie Payments Omschrijving: Order 1 x Tap Terminal")).toEqual(["Mollie"]);
  expect(nameWords("Kosten Zakelijk Betalingsverkeer Factuurnr. 10007786829 Betreft IBAN: NL23INGB0007453959 Periode: 01-10-2026 / 31-10-2026")).toEqual([
    "Kosten",
    "Zakelijk",
    "Betalingsverkeer",
  ]);
  expect(nameWords("12-11-2026 1234")).toEqual([]);
});
