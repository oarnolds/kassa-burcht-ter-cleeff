// The books of 2026 come from e-Boekhouden's auditfile. Until it has been read in, the app books nothing by itself:
// it stores what arrives (bank lines, Mollie payments, balances) and waits. The gate is global, not per year.

/** In `ledger_settings`: the moment the auditfile was read in (written once, by `finishImport`). */
export const IMPORTED_KEY = "eboekhouden_imported_at";

/** One row `{ done: 0 | 1 }`, for a caller's batch: the gate costs no database call of its own. */
export function eboekhoudenDoneStatement(db: D1Database): D1PreparedStatement {
  return db.prepare("SELECT EXISTS (SELECT 1 FROM ledger_settings WHERE key = ?1) AS done").bind(IMPORTED_KEY);
}

/** The auditfile has been read in (finishImport ran once). Until then the app books nothing by itself. */
export async function eboekhoudenDone(db: D1Database): Promise<boolean> {
  return (await eboekhoudenDoneStatement(db).first<{ done: number }>())?.done === 1;
}

/** The gate as read from a batch result of `eboekhoudenDoneStatement`. */
export const gateOpen = (result: D1Result): boolean => (result.results[0] as { done: number } | undefined)?.done === 1;
