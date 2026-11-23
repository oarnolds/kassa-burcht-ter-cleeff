/** The boekhouding's own key/value settings. The kassa's `settings` table is never written from here. */

export async function getLedgerSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM ledger_settings WHERE key = ?1").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

/** The same as a statement, so it can ride in a batch. */
export function setLedgerSettingStatement(db: D1Database, key: string, value: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO ledger_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key, value, now.toISOString());
}

export async function setLedgerSetting(db: D1Database, key: string, value: string, now: Date): Promise<void> {
  await setLedgerSettingStatement(db, key, value, now).run();
}

export function deleteLedgerSettingStatement(db: D1Database, key: string): D1PreparedStatement {
  return db.prepare("DELETE FROM ledger_settings WHERE key = ?1").bind(key);
}
