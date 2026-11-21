import { businessDate } from "../shared/time";
import type { BackupState } from "../shared/types";
import { exportAll } from "./db/maintenance";
import type { Env } from "./env";

/** How many weekly copies stay: half a year. */
const KEEP = 26;
const PREFIX = "kassa-";

/**
 * Writes everything the kassa has recorded to the backup bucket as one dated file,
 * then drops the copies older than the newest 26. Writing comes first: a failure never leaves fewer copies.
 */
export async function runBackup(env: Env, now: Date): Promise<{ key: string }> {
  const key = `${PREFIX}${businessDate(now.toISOString())}.json`;
  const file = await exportAll(env.DB, now);
  await env.BACKUPS.put(key, JSON.stringify(file), { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  const { objects } = await env.BACKUPS.list({ prefix: PREFIX });
  const old = objects
    .map((object) => object.key)
    .sort()
    .slice(0, -KEEP);
  if (old.length > 0) await env.BACKUPS.delete(old);
  return { key };
}

/** How many copies there are and when the newest was written, so beheer can show that the weekly copy really runs. */
export async function backupState(env: Env): Promise<BackupState> {
  const { objects } = await env.BACKUPS.list({ prefix: PREFIX });
  const newest = objects.reduce<R2Object | null>((best, object) => (best === null || object.key > best.key ? object : best), null);
  return {
    latest: newest && { key: newest.key, at: newest.uploaded.toISOString(), sizeBytes: newest.size },
    count: objects.length,
  };
}
