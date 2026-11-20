// Five failures within fifteen minutes block a key until that window ends.

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

export async function isBlocked(db: D1Database, key: string, now: Date): Promise<boolean> {
  const row = await db
    .prepare("SELECT count, window_start FROM auth_attempts WHERE key = ?")
    .bind(key)
    .first<{ count: number; window_start: string }>();
  if (!row) return false;
  if (now.getTime() - Date.parse(row.window_start) >= WINDOW_MS) return false;
  return row.count >= MAX_FAILURES;
}

export async function registerFailure(db: D1Database, key: string, now: Date): Promise<void> {
  // One statement, so two failures at the same moment both count. An expired window starts again at one.
  const expiredBefore = new Date(now.getTime() - WINDOW_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO auth_attempts (key, count, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END`,
    )
    .bind(key, now.toISOString(), expiredBefore)
    .run();
}

export async function clearFailures(db: D1Database, key: string): Promise<void> {
  await db.prepare("DELETE FROM auth_attempts WHERE key = ?").bind(key).run();
}
