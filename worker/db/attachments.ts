import type { Attachment } from "../../shared/ledger-types";
import type { Env } from "../env";
import { LedgerError, entrySnapshot, getEntry, yearStatus } from "./ledger";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

type Row = { id: string; entry_id: string; r2_key: string; filename: string; content_type: string; size_bytes: number; uploaded_at: string };

const toAttachment = (row: Row): Attachment => ({
  id: row.id,
  filename: row.filename,
  contentType: row.content_type,
  sizeBytes: row.size_bytes,
  uploadedAt: row.uploaded_at,
});

/** Letters, digits, `-`, `_` and `.`, at most 100 characters; never empty. */
function cleanName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 100);
  return cleaned || "bijlage";
}

const bucketOf = (env: Env): R2Bucket => {
  if (!env.ATTACHMENTS) throw new LedgerError("attachments_off", 503);
  return env.ATTACHMENTS;
};

/**
 * Keeps a PDF or photo with an entry. The file goes into R2 first, then the row; when the row cannot be written
 * the file stays (nothing is ever deleted). A stream needs `sizeBytes` to be its exact length.
 */
export async function addAttachment(
  env: Env,
  entryId: string,
  file: { filename: string; contentType: string; body: ReadableStream | ArrayBuffer; sizeBytes: number },
  now: Date,
): Promise<Attachment> {
  const bucket = bucketOf(env);
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 || file.sizeBytes > MAX_ATTACHMENT_BYTES) throw new LedgerError("too_large", 400);
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.contentType)) throw new LedgerError("wrong_type", 400);
  const entry = await getEntry(env.DB, entryId);
  if (!entry) throw new LedgerError("not_found", 404);
  if ((await yearStatus(env.DB, entry.year)) === "closed") throw new LedgerError("year_closed", 409);

  const id = crypto.randomUUID();
  const key = `bijlagen/${entry.year}/${entry.id}/${id}`;
  const filename = cleanName(file.filename);
  const body = file.body instanceof ArrayBuffer ? file.body : file.body.pipeThrough(new FixedLengthStream(file.sizeBytes));
  await bucket.put(key, body, { httpMetadata: { contentType: file.contentType } });

  const uploadedAt = now.toISOString();
  const written = await env.DB
    .prepare(
      `INSERT INTO ledger_attachments (id, entry_id, r2_key, filename, content_type, size_bytes, uploaded_at)
       SELECT ?, e.id, ?, ?, ?, ?, ? FROM ledger_entries e
       WHERE e.id = ? AND EXISTS (SELECT 1 FROM ledger_years y WHERE y.year = e.year AND y.status = 'open')`,
    )
    .bind(id, key, filename, file.contentType, file.sizeBytes, uploadedAt, entry.id)
    .run();
  if (written.meta.changes === 0) throw new LedgerError("year_closed", 409); // closed since the check; the file stays
  return { id, filename, contentType: file.contentType, sizeBytes: file.sizeBytes, uploadedAt };
}

async function findRow(db: D1Database, id: string): Promise<Row | null> {
  return db.prepare("SELECT id, entry_id, r2_key, filename, content_type, size_bytes, uploaded_at FROM ledger_attachments WHERE id = ?").bind(id).first<Row>();
}

/** The attachment and its file, hidden or not (the file stays readable by id). Null when there is no such attachment. */
export async function readAttachment(env: Env, id: string): Promise<{ attachment: Attachment; body: ReadableStream } | null> {
  const bucket = bucketOf(env);
  const row = await findRow(env.DB, id);
  if (!row) return null;
  const object = await bucket.get(row.r2_key);
  if (!object) return null;
  return { attachment: toAttachment(row), body: object.body };
}

/** Hides an attachment from the lists; the file stays in R2. The entry's history says so. */
export async function hideAttachment(env: Env, id: string, now: Date): Promise<void> {
  bucketOf(env);
  const row = await findRow(env.DB, id);
  if (!row) throw new LedgerError("not_found", 404);
  const entry = await getEntry(env.DB, row.entry_id);
  if (!entry) throw new LedgerError("not_found", 404);
  if ((await yearStatus(env.DB, entry.year)) === "closed") throw new LedgerError("year_closed", 409);
  const nowIso = now.toISOString();
  const content = JSON.stringify(entrySnapshot(entry));
  const visibleInOpenYear = `EXISTS (SELECT 1 FROM ledger_attachments a JOIN ledger_entries e ON e.id = a.entry_id JOIN ledger_years y ON y.year = e.year
     WHERE a.id = ? AND a.hidden_at IS NULL AND y.status = 'open')`;
  // The history line first: both statements carry the same condition, so neither runs for an attachment hidden or closed in between.
  await env.DB.batch([
    env.DB
      .prepare(`INSERT INTO ledger_history (entry_id, at, before_json, after_json, note) SELECT ?, ?, ?, ?, ? WHERE ${visibleInOpenYear}`)
      .bind(entry.id, nowIso, content, content, `bijlage verborgen: ${row.filename}`, id),
    env.DB.prepare(`UPDATE ledger_attachments SET hidden_at = ? WHERE id = ? AND hidden_at IS NULL AND ${visibleInOpenYear}`).bind(nowIso, id, id),
  ]);
}
