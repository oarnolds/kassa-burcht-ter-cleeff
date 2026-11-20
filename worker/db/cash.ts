import type { CashState, Handover } from "../../shared/types";
import { createReversal, getSale } from "./sales";

/** A refusal with a reason the beheer pages can show. */
export class CashError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

export type HandoverInput = {
  kind: "opening" | "handover";
  countedAt: string;
  receivedCents: number;
  leftCents: number;
  note: string | null;
};

type HandoverRow = {
  id: string;
  kind: "opening" | "handover";
  counted_at: string;
  expected_cents: number;
  received_cents: number;
  left_cents: number;
  difference_cents: number;
  note: string | null;
  created_at: string;
};

const CLOCK_AHEAD_MS = 5 * 60_000;

// The cash sales that no handover has closed yet. Reversals are sales with a negative amount.
const OPEN_CASH = "method = 'cash' AND status = 'paid' AND handover_id IS NULL";
const LAST_LEFT = "COALESCE((SELECT left_cents FROM handovers ORDER BY counted_at DESC LIMIT 1), 0)";

function toHandover(row: HandoverRow): Handover {
  return {
    id: row.id,
    kind: row.kind,
    countedAt: row.counted_at,
    expectedCents: row.expected_cents,
    receivedCents: row.received_cents,
    leftCents: row.left_cents,
    differenceCents: row.difference_cents,
    note: row.note,
    createdAt: row.created_at,
  };
}

/** What should be in the cash box now, and the handovers so far, newest first. */
export async function getCashState(db: D1Database): Promise<CashState> {
  const [expected, handovers] = await db.batch<{ cents: number } & HandoverRow>([
    db.prepare(`SELECT ${LAST_LEFT} + COALESCE((SELECT SUM(total_cents) FROM sales WHERE ${OPEN_CASH}), 0) AS cents`),
    db.prepare("SELECT * FROM handovers ORDER BY counted_at DESC"),
  ]);
  return { expectedCents: expected!.results[0]!.cents, handovers: handovers!.results.map(toHandover) };
}

/**
 * Records the opening amount or a count of the cash box. Either one closes every cash sale made up to the
 * moment of counting: that money is in the amount that was counted. What is sold after that moment, or
 * arrives later, belongs to the next period.
 */
export async function recordHandover(db: D1Database, input: HandoverInput, now: Date): Promise<Handover> {
  const countedAt = new Date(input.countedAt).toISOString();
  if (Date.parse(countedAt) > now.getTime() + CLOCK_AHEAD_MS) throw new CashError("counted_in_future", 400);
  const last = await db.prepare("SELECT MAX(counted_at) AS counted_at FROM handovers").first<{ counted_at: string | null }>();
  if (last?.counted_at && countedAt <= last.counted_at) throw new CashError("counted_before_last", 400);
  if (input.kind === "opening" && last?.counted_at) throw new CashError("already_opened", 409);

  const id = crypto.randomUUID();
  const created = now.toISOString();
  // Each insert checks its own precondition again, so a count sent twice at the same moment is recorded once.
  const insert =
    input.kind === "opening"
      ? db
          .prepare(
            `INSERT INTO handovers (id, kind, counted_at, expected_cents, received_cents, left_cents, difference_cents, note, created_at)
             SELECT ?1, 'opening', ?2, 0, 0, ?3, 0, ?4, ?5
             WHERE NOT EXISTS (SELECT 1 FROM handovers)`,
          )
          .bind(id, countedAt, input.leftCents, input.note, created)
      : db
          .prepare(
            `INSERT INTO handovers (id, kind, counted_at, expected_cents, received_cents, left_cents, difference_cents, note, created_at)
             SELECT ?1, 'handover', ?2, expected, ?3, ?4, expected - ?3 - ?4, ?5, ?6
             FROM (SELECT ${LAST_LEFT}
                          + COALESCE((SELECT SUM(total_cents) FROM sales WHERE ${OPEN_CASH} AND sold_at <= ?2), 0) AS expected)
             WHERE NOT EXISTS (SELECT 1 FROM handovers WHERE counted_at >= ?2)`,
          )
          .bind(id, countedAt, input.receivedCents, input.leftCents, input.note, created);
  const close = db
    .prepare(
      `UPDATE sales SET handover_id = ?1
       WHERE ${OPEN_CASH} AND sold_at <= ?2 AND EXISTS (SELECT 1 FROM handovers WHERE id = ?1)`,
    )
    .bind(id, countedAt);
  const [inserted] = await db.batch([insert, close]);
  if (inserted!.meta.changes === 0) {
    throw input.kind === "opening" ? new CashError("already_opened", 409) : new CashError("counted_before_last", 400);
  }
  const row = await db.prepare("SELECT * FROM handovers WHERE id = ?").bind(id).first<HandoverRow>();
  return toHandover(row!);
}

/** Beheer undoes a sale by booking its counter-entry, dated now. */
export async function reverseSaleAsAdmin(db: D1Database, saleId: string, reason: string, now: Date): Promise<{ id: string }> {
  const sale = await getSale(db, saleId);
  if (!sale) throw new CashError("not_found", 404);
  const why = reason.trim();
  if (why.length < 3) throw new CashError("reason_required", 400);
  if (sale.reverses_sale_id !== null) throw new CashError("is_reversal", 409);
  const reversed = await db.prepare("SELECT 1 FROM sales WHERE reverses_sale_id = ?").bind(saleId).first();
  if (reversed) throw new CashError("already_reversed", 409);
  if (sale.status !== "paid") throw new CashError("not_paid", 409);
  // A counted period stays as it was counted. Pin money never passes through the cash box.
  if (sale.method === "cash" && sale.handover_id !== null) throw new CashError("closed_by_handover", 409);
  const id = crypto.randomUUID();
  try {
    await createReversal(db, sale, { id, soldAt: now.toISOString(), by: "admin", reason: why, deviceId: null, now });
  } catch (error) {
    // Someone else reversed it a moment ago.
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: sales.reverses_sale_id")) {
      throw new CashError("already_reversed", 409);
    }
    throw error;
  }
  return { id };
}
