import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { EntryLine } from "../shared/ledger-types";
import { ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES, addAttachment, hideAttachment, readAttachment } from "../worker/db/attachments";
import { createEntry, entryHistory, getEntry, listEntries } from "../worker/db/ledger";
import type { Env } from "../worker/env";
import { resetData } from "./helpers";

beforeEach(async () => {
  await resetData();
  const { objects } = await env.ATTACHMENTS.list();
  await Promise.all(objects.map((o) => env.ATTACHMENTS.delete(o.key)));
});

const NOW = new Date("2027-03-01T12:00:00.000Z");
const LATER = new Date("2027-03-02T12:00:00.000Z");
const LINES: EntryLine[] = [
  { accountCode: "4514", amountCents: 1250, note: null, assetId: null },
  { accountCode: "1010", amountCents: -1250, note: null, assetId: null },
];
const manual = () => createEntry(env.DB, { date: "2027-01-10", description: "Bonnetje", source: "manual", lines: LINES }, NOW);
const pdf = (text = "%PDF-1.4 test") => new TextEncoder().encode(text).buffer as ArrayBuffer;
const file = (body = pdf(), over: Partial<{ filename: string; contentType: string; sizeBytes: number }> = {}) => ({
  filename: "bon.pdf",
  contentType: "application/pdf",
  body,
  sizeBytes: body.byteLength,
  ...over,
});

it("keeps a PDF with its entry and hands it back", async () => {
  const entry = await manual();
  const attachment = await addAttachment(env, entry.id, file(), NOW);
  expect(attachment).toMatchObject({ filename: "bon.pdf", contentType: "application/pdf", sizeBytes: 13, uploadedAt: NOW.toISOString() });
  expect((await getEntry(env.DB, entry.id))!.attachments).toEqual([attachment]);
  expect((await listEntries(env.DB, { year: 2027 }))[0]!.attachments).toEqual([attachment]);
  const key = `bijlagen/2027/${entry.id}/${attachment.id}`;
  expect(await env.ATTACHMENTS.head(key)).not.toBeNull();
  const read = await readAttachment(env, attachment.id);
  expect(read!.attachment).toEqual(attachment);
  expect(await new Response(read!.body).text()).toBe("%PDF-1.4 test");
  expect(await readAttachment(env, "bestaat-niet")).toBeNull();
});

it("takes a stream with a known length and cleans the file name", async () => {
  const entry = await manual();
  const bytes = pdf("abc");
  const stream = new Response(bytes).body!;
  const attachment = await addAttachment(env, entry.id, { ...file(bytes, { filename: "../Bon  façade (1).pdf" }), body: stream }, NOW);
  expect(attachment.filename).toMatch(/^[A-Za-z0-9._-]{1,100}$/);
  expect(attachment.filename).not.toContain("/");
  const long = await addAttachment(env, entry.id, file(pdf(), { filename: "a".repeat(300) + ".pdf" }), NOW);
  expect(long.filename.length).toBe(100);
});

it("refuses a file that is too large or of another type", async () => {
  const entry = await manual();
  expect(ATTACHMENT_TYPES).toContain("image/png");
  await expect(addAttachment(env, entry.id, file(pdf(), { sizeBytes: MAX_ATTACHMENT_BYTES + 1 }), NOW)).rejects.toMatchObject({ code: "too_large", status: 400 });
  await expect(addAttachment(env, entry.id, file(pdf(), { contentType: "text/html" }), NOW)).rejects.toMatchObject({ code: "wrong_type", status: 400 });
  await expect(addAttachment(env, "bestaat-niet", file(), NOW)).rejects.toMatchObject({ code: "not_found", status: 404 });
  expect((await getEntry(env.DB, entry.id))!.attachments).toEqual([]);
  expect((await env.ATTACHMENTS.list()).objects).toHaveLength(0);
});

it("hides an attachment but keeps the file", async () => {
  const entry = await manual();
  const first = await addAttachment(env, entry.id, file(), NOW);
  const second = await addAttachment(env, entry.id, file(pdf("tweede"), { filename: "foto.png", contentType: "image/png" }), NOW);
  await hideAttachment(env, first.id, LATER);
  const after = (await getEntry(env.DB, entry.id))!;
  expect(after.attachments).toEqual([second]);
  expect(after.changed).toBe(true);
  expect((await env.ATTACHMENTS.list()).objects).toHaveLength(2);
  expect((await readAttachment(env, first.id))!.attachment.id).toBe(first.id);
  const history = await entryHistory(env.DB, entry.id);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ at: LATER.toISOString(), note: "bijlage verborgen: bon.pdf" });
  expect(history[0]!.before).toEqual(history[0]!.after);
  expect(history[0]!.after).toMatchObject({ date: "2027-01-10", description: "Bonnetje", lines: LINES });
  await expect(hideAttachment(env, "bestaat-niet", LATER)).rejects.toMatchObject({ code: "not_found", status: 404 });
});

it("refuses changes in a closed year", async () => {
  const entry = await manual();
  const attachment = await addAttachment(env, entry.id, file(), NOW);
  await env.DB.prepare("UPDATE ledger_years SET status = 'closed' WHERE year = 2027").run();
  await expect(addAttachment(env, entry.id, file(), LATER)).rejects.toMatchObject({ code: "year_closed", status: 409 });
  await expect(hideAttachment(env, attachment.id, LATER)).rejects.toMatchObject({ code: "year_closed", status: 409 });
  expect((await getEntry(env.DB, entry.id))!.attachments).toHaveLength(1);
});

it("says the attachments are off without a bucket", async () => {
  const entry = await manual();
  const off = { DB: env.DB } as unknown as Env;
  await expect(addAttachment(off, entry.id, file(), NOW)).rejects.toMatchObject({ code: "attachments_off", status: 503 });
  await expect(readAttachment(off, "x")).rejects.toMatchObject({ code: "attachments_off", status: 503 });
});
