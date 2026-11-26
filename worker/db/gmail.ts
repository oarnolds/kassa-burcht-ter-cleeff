// "Zoek bijlage": the link with the speeltuin's Gmail (read only), and the search for the file that belongs with an entry.
// The state that goes to Google is used once; the refresh token stays in gmail_links, out of every copy and every answer.
// The search only proposes: the penningmeester picks the file, and only then is it fetched and kept with the entry.

import type { Attachment, Entry, GmailCandidate, GmailState } from "../../shared/ledger-types";
import { businessDate, shiftDate } from "../../shared/time";
import type { Env } from "../env";
import {
  accessToken,
  authUrl,
  exchangeCode,
  filesOf,
  getAttachment,
  getMessage,
  GmailError,
  type GmailKeys,
  type GmailPart,
  header,
  profileEmail,
  revoke,
  searchMessages,
} from "../lib/gmail";
import { addAttachment, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "./attachments";
import { getEntry, LedgerError, yearStatus } from "./ledger";

/** Where Google sends the browser back to; the same address must be listed with the OAuth client at Google. */
export const GMAIL_RETURN_PATH = "/beheer/gmail";
/** The page at Google must be finished within this long after it was asked for. */
const STATE_LIFETIME_MS = 30 * 60_000;
/** An invoice usually comes before it is paid: the search looks this far back from the entry's date, and a little after. */
const DAYS_BEFORE = 60;
const DAYS_AFTER = 15;
/** Messages read per search, and files proposed. Each message read is one call to Google. */
const MAX_MESSAGES = 10;
const MAX_CANDIDATES = 8;
const DAY_MS = 86_400_000;

const keysOf = (env: Env): GmailKeys | null =>
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : null;

function needKeys(env: Env): GmailKeys {
  const keys = keysOf(env);
  if (!keys) throw new LedgerError("gmail_off", 409);
  return keys;
}

function asLedger(error: unknown): never {
  if (error instanceof GmailError) {
    if (error.failure === "expired") throw new LedgerError("gmail_expired", 409);
    throw new LedgerError(error.failure === "forbidden" ? "gmail_forbidden" : "gmail_failed", 502);
  }
  throw error;
}

/** Where the link stands. Never the token. */
export async function gmailState(env: Env): Promise<GmailState> {
  if (!keysOf(env)) return { status: "not_configured", email: null };
  const row = await env.DB.prepare(
    "SELECT status, email FROM gmail_links WHERE status IN ('active', 'expired') ORDER BY created_at DESC, rowid DESC LIMIT 1",
  ).first<{ status: "active" | "expired"; email: string | null }>();
  return row ? { status: row.status, email: row.email } : { status: "none", email: null };
}

/** The page at Google where the penningmeester allows read-only access, with a state that can be used once. */
export async function startLink(env: Env, origin: string, now: Date): Promise<{ url: string }> {
  const keys = needKeys(env);
  const state = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO gmail_links (id, state, status, created_at) VALUES (?1, ?2, 'pending', ?3)")
    .bind(crypto.randomUUID(), state, now.toISOString())
    .run();
  return { url: authUrl(keys, `${origin}${GMAIL_RETURN_PATH}`, state) };
}

/**
 * Google sent the browser back with a code. The state is spent first, in one conditional update, so a code is used
 * once. An earlier link of the same address is forgotten but not revoked; one of another address is revoked.
 */
export async function finishLink(env: Env, input: { code: string; state: string }, origin: string, now: Date): Promise<GmailState> {
  const keys = needKeys(env);
  const spent = await env.DB.prepare(
    "UPDATE gmail_links SET used_at = ?1 WHERE state = ?2 AND status = 'pending' AND used_at IS NULL AND created_at > ?3 RETURNING id",
  )
    .bind(now.toISOString(), input.state, new Date(now.getTime() - STATE_LIFETIME_MS).toISOString())
    .first<{ id: string }>();
  if (!spent) throw new LedgerError("state_invalid", 409);
  let refreshToken: string;
  let email: string;
  try {
    const tokens = await exchangeCode(keys, input.code, `${origin}${GMAIL_RETURN_PATH}`);
    if (!tokens.refreshToken) throw new GmailError("failed");
    refreshToken = tokens.refreshToken;
    email = await profileEmail(tokens.accessToken);
  } catch (error) {
    return asLedger(error);
  }
  const earlier = await env.DB.prepare("SELECT email, refresh_token FROM gmail_links WHERE refresh_token IS NOT NULL AND id <> ?1")
    .bind(spent.id)
    .all<{ email: string | null; refresh_token: string }>();
  await env.DB.batch([
    env.DB.prepare("UPDATE gmail_links SET status = 'replaced', refresh_token = NULL WHERE status IN ('active', 'expired') AND id <> ?1").bind(spent.id),
    env.DB.prepare("UPDATE gmail_links SET status = 'active', email = ?2, refresh_token = ?3 WHERE id = ?1").bind(spent.id, email, refreshToken),
  ]);
  // Another address: its access at Google ends too. The same address keeps it: revoking would end the new link as well.
  for (const row of earlier.results) if (row.email !== email) await revoke(row.refresh_token);
  return { status: "active", email };
}

/** Ends the link: the token is revoked at Google (best effort) and gone from the Worker. */
export async function unlink(env: Env): Promise<GmailState> {
  const held = await env.DB.prepare("SELECT refresh_token FROM gmail_links WHERE refresh_token IS NOT NULL").all<{ refresh_token: string }>();
  await env.DB.prepare("UPDATE gmail_links SET status = 'replaced', refresh_token = NULL WHERE status IN ('active', 'expired') OR refresh_token IS NOT NULL").run();
  for (const row of held.results) await revoke(row.refresh_token);
  return gmailState(env);
}

/** An access token for this one request. When Google refuses the link, it is marked expired and its token dropped. */
async function accessFor(env: Env): Promise<string> {
  const keys = needKeys(env);
  const row = await env.DB.prepare(
    "SELECT id, refresh_token FROM gmail_links WHERE status = 'active' AND refresh_token IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1",
  ).first<{ id: string; refresh_token: string }>();
  if (!row) {
    const expired = await env.DB.prepare("SELECT 1 AS one FROM gmail_links WHERE status = 'expired' LIMIT 1").first();
    throw new LedgerError(expired ? "gmail_expired" : "gmail_not_linked", 409);
  }
  try {
    return await accessToken(keys, row.refresh_token);
  } catch (error) {
    if (error instanceof GmailError && error.failure === "expired") {
      await env.DB.prepare("UPDATE gmail_links SET status = 'expired', refresh_token = NULL WHERE id = ?").bind(row.id).run();
    }
    return asLedger(error);
  }
}

/** Words that say nothing about who sent an invoice: bank-line labels, legal forms and filler. */
const FILLER = new Set([
  "naam",
  "omschrijving",
  "iban",
  "kenmerk",
  "valutadatum",
  "factuur",
  "factuurnr",
  "betreft",
  "periode",
  "via",
  "stichting",
  "payments",
  "van",
  "voor",
  "het",
  "een",
  "der",
  "den",
  "met",
  "order",
  "b.v",
  "n.v",
]);

/** Up to three words that name who was paid: from a bank line's "Naam:" when there is one, else from the description. */
export function nameWords(description: string): string[] {
  const named = /Naam:\s*(.+?)(?=\s+(?:Omschrijving|IBAN|Kenmerk|Valutadatum|Machtiging|Incassant|BIC|Betalingskenmerk):|$)/i.exec(description);
  const words: string[] = [];
  for (const raw of (named ? named[1]! : description).split(/[\s,;:()/–—]+/)) {
    const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (word.length < 3 || /\d/.test(word) || !/\p{L}/u.test(word) || FILLER.has(word.toLowerCase())) continue;
    if (!words.some((kept) => kept.toLowerCase() === word.toLowerCase())) words.push(word);
    if (words.length === 3) break;
  }
  return words;
}

/** After these words an invoice number usually follows: "Factuur 2026-1234", "Factuurnr. 1000778", "Invoice #A1B2C3". */
const AFTER_WORD = /\b(?:factuur(?:nr|nummer)?|fact|nota|invoice|inv)\b\.?\s*(?:(?:nr|no|nummer|number)\b\.?)?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9./-]*[A-Za-z0-9])/gi;
const DATE = /^(?:\d{1,2}-\d{1,2}-\d{2,4}|\d{4}-\d{2}-\d{2})$/;
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
/** A payment code such as Mollie's: long hex. */
const HEX = /^[0-9a-f]{16,}$/i;
const digitsIn = (text: string) => (text.match(/\d/g) ?? []).length;
const looksLikeNumber = (token: string) =>
  token.length <= 25 && digitsIn(token) >= 3 && !DATE.test(token) && !IBAN.test(token) && !HEX.test(token) && !/,\d{2}$/.test(token);

/**
 * Up to two invoice numbers from the description: what follows "Factuur", "Factuurnr", "Nota" or "Invoice", and any word
 * of letters and digits such as "INV-2026-0042". Not a date, an IBAN, an amount or a long payment code.
 */
export function invoiceNumbers(description: string): string[] {
  const found: string[] = [];
  const keep = (token: string) => {
    if (looksLikeNumber(token) && !found.includes(token)) found.push(token);
  };
  for (const match of description.matchAll(AFTER_WORD)) keep(match[1]!);
  for (const raw of description.split(/[\s,;:()]+/)) {
    const token = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (/[A-Za-z]/.test(token) && /^[A-Za-z0-9][A-Za-z0-9/-]*$/.test(token)) keep(token);
  }
  return found.slice(0, 2);
}

/** The entry's amount (its debit side) as an invoice writes it: `1.234,56`, and `1234.56` for one in English. */
function amountForms(entry: Entry): string[] {
  const cents = entry.lines.reduce((total, line) => total + Math.max(line.amountCents, 0), 0);
  const euros = Math.floor(cents / 100);
  const rest = String(cents % 100).padStart(2, "0");
  return [`${String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${rest}`, `${euros}.${rest}`];
}

const gmailDay = (date: string) => date.replaceAll("-", "/");

type Search = { q: string; kind: "number" | "amount" | "name" };

/** The searches, most precise first: the invoice number, the amount, all the name's words, any of them. All with a file, around the date. */
export function searchQueries(entry: Entry): Search[] {
  const around = `has:attachment after:${gmailDay(shiftDate(entry.date, -DAYS_BEFORE))} before:${gmailDay(shiftDate(entry.date, DAYS_AFTER + 1))}`;
  const words = nameWords(entry.description);
  const searches: Search[] = invoiceNumbers(entry.description).map((number) => ({ q: `${around} "${number}"`, kind: "number" }));
  searches.push({ q: `${around} "${amountForms(entry)[0]}"`, kind: "amount" });
  if (words.length > 0) searches.push({ q: `${around} ${words.join(" ")}`, kind: "name" });
  if (words.length > 1) searches.push({ q: `${around} {${words.join(" ")}}`, kind: "name" });
  return searches;
}

/** A file the boekhouding keeps: PDF, JPEG or PNG. Gmail often calls a PDF `application/octet-stream`; then the name decides. */
function typeOf(part: GmailPart): string | null {
  const mime = (part.mimeType ?? "").toLowerCase();
  if ((ATTACHMENT_TYPES as readonly string[]).includes(mime)) return mime;
  if (mime === "image/jpg") return "image/jpeg";
  if (mime !== "application/octet-stream" && mime !== "") return null;
  const name = (part.filename ?? "").toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (/\.jpe?g$/.test(name)) return "image/jpeg";
  if (name.endsWith(".png")) return "image/png";
  return null;
}

/** The files in Gmail that may belong with an entry: the invoice number first, then the amount, PDFs, the name, the closest date. */
export async function findFiles(env: Env, entryId: string): Promise<GmailCandidate[]> {
  const entry = await getEntry(env.DB, entryId);
  if (!entry) throw new LedgerError("not_found", 404);
  const access = await accessFor(env);
  const words = nameWords(entry.description).map((word) => word.toLowerCase());
  const amounts = amountForms(entry);
  const numbers = invoiceNumbers(entry.description).map((number) => number.toLowerCase());
  try {
    const ids: string[] = [];
    // Gmail also searches the text inside a PDF: what the number or the amount search finds has it, wherever it is.
    const withNumber = new Set<string>();
    const withAmount = new Set<string>();
    for (const search of searchQueries(entry)) {
      if (ids.length >= MAX_MESSAGES) break;
      const hits = await searchMessages(access, search.q, MAX_MESSAGES);
      for (const id of hits) {
        if (search.kind === "number") withNumber.add(id);
        if (search.kind === "amount") withAmount.add(id);
        if (!ids.includes(id)) ids.push(id);
      }
    }
    // One mail that cannot be read (gone since the search) does not spoil the others; a refusal of the link does.
    const reads = await Promise.allSettled(ids.slice(0, MAX_MESSAGES).map((id) => getMessage(access, id)));
    const refused = reads.find((read) => read.status === "rejected" && !(read.reason instanceof GmailError && read.reason.failure === "failed"));
    if (refused?.status === "rejected") throw refused.reason;
    const messages = reads.flatMap((read) => (read.status === "fulfilled" ? [read.value] : []));
    if (messages.length === 0 && reads.length > 0) throw new GmailError("failed");
    const found = messages.flatMap((message) => {
      const date = message.internalDate ? businessDate(new Date(Number(message.internalDate)).toISOString()) : entry.date;
      const from = header(message, "From");
      const subject = header(message, "Subject");
      return filesOf(message.payload).flatMap((part) => {
        const contentType = typeOf(part);
        const sizeBytes = part.body?.size ?? 0;
        if (!contentType || !part.partId || sizeBytes > MAX_ATTACHMENT_BYTES) return [];
        const filename = part.filename!;
        const text = `${message.snippet ?? ""} ${subject} ${filename}`;
        const amountFound = withAmount.has(message.id) || amounts.some((amount) => text.includes(amount));
        const numberFound = withNumber.has(message.id) || numbers.some((number) => text.toLowerCase().includes(number));
        const named = words.filter((word) => `${from} ${subject} ${filename}`.toLowerCase().includes(word)).length;
        const distance = Math.abs(Date.parse(date) - Date.parse(entry.date)) / DAY_MS;
        const candidate: GmailCandidate = { messageId: message.id, partId: part.partId, date, from, subject, filename, contentType, sizeBytes, amountFound, numberFound };
        return [{ candidate, named, distance }];
      });
    });
    // An invoice is nearly always a PDF; a picture is often a logo in the mail's signature.
    const pdf = (one: GmailCandidate) => Number(one.contentType === "application/pdf");
    found.sort(
      (a, b) =>
        Number(b.candidate.numberFound) - Number(a.candidate.numberFound) ||
        Number(b.candidate.amountFound) - Number(a.candidate.amountFound) ||
        pdf(b.candidate) - pdf(a.candidate) ||
        b.named - a.named ||
        a.distance - b.distance,
    );
    return found.slice(0, MAX_CANDIDATES).map((one) => one.candidate);
  } catch (error) {
    return asLedger(error);
  }
}

/** Fetches the file the penningmeester picked, found again by its part (Gmail's attachment ids change), and keeps it with the entry. */
export async function attachFromGmail(env: Env, entryId: string, pick: { messageId: string; partId: string }, now: Date): Promise<Attachment> {
  const entry = await getEntry(env.DB, entryId);
  if (!entry) throw new LedgerError("not_found", 404);
  if ((await yearStatus(env.DB, entry.year)) === "closed") throw new LedgerError("year_closed", 409);
  const access = await accessFor(env);
  let file: { filename: string; contentType: string; bytes: Uint8Array };
  try {
    const message = await getMessage(access, pick.messageId);
    const part = filesOf(message.payload).find((one) => one.partId === pick.partId);
    if (!part) throw new LedgerError("not_found", 404);
    const contentType = typeOf(part);
    if (!contentType) throw new LedgerError("wrong_type", 400);
    if ((part.body?.size ?? 0) > MAX_ATTACHMENT_BYTES) throw new LedgerError("too_large", 400);
    file = { filename: part.filename!, contentType, bytes: await getAttachment(access, pick.messageId, part.body!.attachmentId!) };
  } catch (error) {
    if (error instanceof LedgerError) throw error;
    return asLedger(error);
  }
  const body = file.bytes.buffer as ArrayBuffer;
  return addAttachment(env, entryId, { filename: file.filename, contentType: file.contentType, body, sizeBytes: file.bytes.byteLength }, now);
}
