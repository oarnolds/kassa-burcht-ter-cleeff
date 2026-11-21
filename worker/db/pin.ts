// A pin payment from start to finish. The receipt waits as a 'pending' sale until the server has read
// Mollie's final word; only then does it count as revenue and does the stock go down.

import type { PinSaleInput } from "../../shared/schemas";
import { businessDate } from "../../shared/time";
import type { PinOutcome, PinStatus } from "../../shared/types";
import { pinOutcome, type Mollie, type MolliePayment } from "../lib/mollie";
import { PinError, chosenFrom, chosenTerminal, terminalChoiceQuery } from "./pin-settings";
import { getSale, lineStatement, productsQuery, storedSoldAt, type ProductInfo, type SaleRow } from "./sales";

/** While a start request has had no answer, it is sent again (same Idempotency-Key) for this long: the beheerder is still waiting. */
export const RESEND_MS = 60_000;
/** A sale Mollie never answered for and never called back about counts as not started after this long. */
export const GIVE_UP_MS = 15 * 60_000;

export type PinContext = { db: D1Database; mollie: Mollie | null; origin: string; now: Date };

function statusOf(sale: SaleRow, testUrl: string | null = null): PinStatus {
  return {
    id: sale.id,
    outcome: sale.pin_outcome,
    reason: sale.pin_reason,
    sent: sale.mollie_payment_id !== null,
    testUrl: sale.status === "pending" ? testUrl : null,
  };
}

const reread = async (db: D1Database, sale: SaleRow): Promise<SaleRow> => (await getSale(db, sale.id)) ?? sale;

/** Ends a sale the terminal was never asked for, as far as the kassa knows. A sale that has a payment is left alone. */
async function endWithoutPayment(db: D1Database, sale: SaleRow, outcome: PinOutcome, reason: string, now: Date): Promise<SaleRow> {
  await db
    .prepare(
      `UPDATE sales SET status = 'failed', pin_outcome = ?2, pin_reason = ?3, settled_at = ?4
       WHERE id = ?1 AND method = 'pin' AND status = 'pending' AND mollie_payment_id IS NULL`,
    )
    .bind(sale.id, outcome, reason, now.toISOString())
    .run();
  return reread(db, sale);
}

/** Writes what Mollie says about this sale's payment, exactly once, and returns the row as it then is. */
export async function settleFromMollie(db: D1Database, sale: SaleRow, payment: MolliePayment, now: Date): Promise<SaleRow> {
  const outcome = pinOutcome(payment.status);
  const at = now.toISOString();
  if (outcome === "paid") {
    // Both statements carry the same condition, so of two requests that learn "paid" at the same moment only
    // one books the sale and lowers the stock. Final is final, with one exception: a sale the kassa gave up
    // on without ever learning of a payment is still booked when Mollie says that it was paid.
    const open = (s: string) =>
      `${s}method = 'pin' AND (${s}status = 'pending' OR (${s}status = 'failed' AND ${s}mollie_payment_id IS NULL))
       AND (${s}mollie_payment_id IS NULL OR ${s}mollie_payment_id = ?3)`;
    await db.batch([
      db
        .prepare(
          `INSERT INTO stock_movements (product_id, delta, kind, ref_id, created_at)
           SELECT l.product_id, -l.qty, 'sale', l.sale_id, ?2
           FROM sale_lines l JOIN products p ON p.id = l.product_id JOIN sales s ON s.id = l.sale_id
           WHERE l.sale_id = ?1 AND p.track_stock = 1 AND ${open("s.")}
           ORDER BY l.id`,
        )
        .bind(sale.id, at, payment.id),
      db
        .prepare(
          `UPDATE sales SET status = 'paid', pin_outcome = 'paid', pin_reason = NULL, mollie_payment_id = ?3, settled_at = ?2
           WHERE id = ?1 AND ${open("")}`,
        )
        .bind(sale.id, at, payment.id),
    ]);
  } else if (outcome !== null) {
    await db
      .prepare(
        `UPDATE sales SET status = 'failed', pin_outcome = ?2, pin_reason = ?3, mollie_payment_id = COALESCE(mollie_payment_id, ?4), settled_at = ?5
         WHERE id = ?1 AND method = 'pin' AND status = 'pending' AND (mollie_payment_id IS NULL OR mollie_payment_id = ?4)`,
      )
      .bind(sale.id, outcome, payment.reason, payment.id, at)
      .run();
  } else if (sale.mollie_payment_id === null) {
    // Still running: remember which payment it is, so that the next question goes straight to it.
    await db
      .prepare("UPDATE sales SET mollie_payment_id = ?2 WHERE id = ?1 AND method = 'pin' AND status = 'pending' AND mollie_payment_id IS NULL")
      .bind(sale.id, payment.id)
      .run();
  } else {
    return sale;
  }
  return reread(db, sale);
}

/** Asks the terminal for the payment of a pending sale that has none yet, and writes down the answer. */
async function sendStart(ctx: PinContext, mollie: Mollie, sale: SaleRow, terminalId: string): Promise<PinStatus> {
  const asked = await mollie.createPayment({ saleId: sale.id, amountCents: sale.total_cents, terminalId, origin: ctx.origin });
  if (!asked.ok) {
    // No usable answer: the payment may exist all the same. The sale waits, and the next question about it asks again.
    if (asked.failure === "unreachable") return statusOf(sale);
    return statusOf(await endWithoutPayment(ctx.db, sale, "start_failed", asked.failure, ctx.now));
  }
  const after = await settleFromMollie(ctx.db, sale, asked.data, ctx.now);
  if (after.status === "failed" && after.mollie_payment_id === null && pinOutcome(asked.data.status) === null) {
    // The sale ended while Mollie was being asked (the beheerder cancelled): the request must not stay on the
    // terminal. Should Mollie refuse and the customer pay after all, the webhook still books the sale.
    await mollie.cancelPayment(asked.data.id);
  }
  return statusOf(after, asked.data.testUrl);
}

/**
 * The Mollie to ask about this sale. A key of the other kind (test or live) cannot see the sale's payment
 * and must never make one for it: for this sale there is then no Mollie.
 */
function mollieOf(ctx: PinContext, sale: SaleRow): Mollie | null {
  return ctx.mollie?.mode === sale.mollie_mode ? ctx.mollie : null;
}

/**
 * Stores the receipt as a pending pin sale and asks the terminal. Sending the same id again returns where
 * that payment stands. Throws PinError: pin_not_configured 409 (no key), no_terminal 409, id_in_use 409
 * (the id is a cash sale), total_mismatch 422, unknown_product 422.
 */
export async function startPin(ctx: PinContext, deviceId: string, input: PinSaleInput): Promise<PinStatus> {
  const { db, mollie, now } = ctx;
  if (!mollie) throw new PinError("pin_not_configured", 409);
  // One round trip for everything the start needs to know.
  const [productRows, saleRows, terminalRows] = await db.batch([
    productsQuery(db),
    db.prepare("SELECT * FROM sales WHERE id = ?").bind(input.id),
    terminalChoiceQuery(db),
  ]);
  const standing = (sale: SaleRow): PinStatus => {
    if (sale.method !== "pin") throw new PinError("id_in_use", 409);
    return statusOf(sale);
  };
  const existing = (saleRows!.results as SaleRow[])[0];
  if (existing) return standing(existing);

  const products = new Map((productRows!.results as ProductInfo[]).map((product) => [product.id, product]));
  const sum = input.lines.reduce((total, line) => total + line.unitPriceCents * line.qty, 0);
  if (sum !== input.totalCents) throw new PinError("total_mismatch", 422);
  if (input.lines.some((line) => !products.has(line.productId))) throw new PinError("unknown_product", 422);
  const terminalId = chosenFrom(terminalRows!.results as { key: string; value: string }[], mollie.mode);
  if (!terminalId) throw new PinError("no_terminal", 409);

  const soldAt = storedSoldAt(input.soldAt, now);
  const sale: SaleRow = {
    id: input.id,
    device_id: deviceId,
    method: "pin",
    status: "pending",
    total_cents: input.totalCents,
    cash_given_cents: null,
    sold_at: soldAt,
    received_at: now.toISOString(),
    business_date: businessDate(soldAt),
    reverses_sale_id: null,
    reversal_reason: null,
    reversed_by: null,
    late: 0,
    handover_id: null,
    mollie_payment_id: null,
    mollie_mode: mollie.mode,
    pin_outcome: null,
    pin_reason: null,
    settled_at: null,
    instead_of_sale_id: null,
  };
  try {
    // The receipt is stored before the terminal is asked: whatever happens next, the sale can be found again.
    // The stock goes down only when the payment has gone through.
    await db.batch([
      db
        .prepare(
          `INSERT INTO sales (id, device_id, method, status, total_cents, sold_at, received_at, business_date, late, mollie_mode)
           VALUES (?1, ?2, 'pin', 'pending', ?3, ?4, ?5, ?6, 0, ?7)`,
        )
        .bind(sale.id, deviceId, sale.total_cents, soldAt, sale.received_at, sale.business_date, mollie.mode),
      ...input.lines.map((line) => lineStatement(db, sale.id, line, products.get(line.productId)!)),
    ]);
  } catch (error) {
    // Most likely the same start arrived twice at the same moment and the other one stored it: that one asks the terminal.
    const winner = await getSale(db, input.id);
    if (!winner) throw error;
    return standing(winner);
  }
  return sendStart(ctx, mollie, sale, terminalId);
}

/** Where a pin sale stands, after asking Mollie when it is still running. */
async function follow(ctx: PinContext, sale: SaleRow): Promise<PinStatus> {
  const { db, now } = ctx;
  if (sale.status !== "pending") return statusOf(sale);
  const mollie = mollieOf(ctx, sale);
  if (sale.mollie_payment_id !== null) {
    if (!mollie) return statusOf(sale);
    const asked = await mollie.getPayment(sale.mollie_payment_id);
    // No usable answer from Mollie says nothing about the payment: the sale keeps waiting.
    if (!asked.ok) return statusOf(sale);
    return statusOf(await settleFromMollie(db, sale, asked.data, now), asked.data.testUrl);
  }
  const age = now.getTime() - Date.parse(sale.received_at);
  if (age > GIVE_UP_MS) return statusOf(await endWithoutPayment(db, sale, "start_failed", "no_answer", now));
  if (age < RESEND_MS && mollie) {
    const terminalId = await chosenTerminal(db, mollie.mode);
    if (terminalId) return sendStart(ctx, mollie, sale, terminalId);
  }
  return statusOf(sale);
}

const pinSaleOf = async (db: D1Database, saleId: string): Promise<SaleRow | null> => {
  const sale = await getSale(db, saleId);
  return sale?.method === "pin" ? sale : null;
};

/** Where the payment stands, after asking Mollie when it is still running. null: there is no pin sale with this id. */
export async function pinStatus(ctx: PinContext, saleId: string): Promise<PinStatus | null> {
  const sale = await pinSaleOf(ctx.db, saleId);
  return sale && follow(ctx, sale);
}

/** Asks Mollie to cancel. The answer says where the payment stands afterwards: it may still be running. */
export async function cancelPin(ctx: PinContext, saleId: string): Promise<PinStatus | null> {
  const { db, now } = ctx;
  const sale = await pinSaleOf(db, saleId);
  if (!sale) return null;
  const mollie = mollieOf(ctx, sale);
  if (sale.status !== "pending") return statusOf(sale);
  // The terminal was never asked, as far as the kassa knows: nothing to take back, and nothing is sent any more.
  if (sale.mollie_payment_id === null) return statusOf(await endWithoutPayment(db, sale, "canceled", "before_start", now));
  if (mollie) {
    const asked = await mollie.cancelPayment(sale.mollie_payment_id);
    if (asked.ok) return statusOf(await settleFromMollie(db, sale, asked.data, now), asked.data.testUrl);
  }
  // Mollie would not cancel: the payment may be running still, or may just have gone through. Say which.
  return follow(ctx, sale);
}
