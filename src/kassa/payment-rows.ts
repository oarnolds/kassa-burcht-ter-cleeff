// "Betalingen" on the kassa: every payment of the day in one list, newest first, to look at only. The
// server's list comes first; what only this iPad knows (a sale not sent yet, a pin payment the server
// never heard of) is added to it.

import type { CashSaleInput } from "../../shared/schemas";
import type { KassaPayments } from "../../shared/types";
import type { Parked } from "./store/pin";

/**
 * How a payment stands. `cashTaken`: a pin payment that is still waiting, but the beheerder rang the
 * receipt up as cash meanwhile. `unsent`: a cash sale this iPad has not handed to the server yet.
 */
export type PaymentState = "paid" | "waiting" | "failed" | "reversed" | "unsent" | "cashTaken";

export type PaymentRow = {
  id: string;
  soldAt: string;
  method: "cash" | "pin";
  totalCents: number;
  lines: { name: string; qty: number }[];
  state: PaymentState;
  /** The receipt this iPad holds for a waiting pin payment: it can still be rung up as cash. */
  receipt?: Parked;
};

const linesOf = (lines: { name: string; qty: number }[]) => lines.map(({ name, qty }) => ({ name, qty }));

/** The day's payments in one list, newest first. `server` is null when the server cannot be asked. */
export function paymentRows(server: KassaPayments | null, waiting: Parked[], unsent: CashSaleInput[]): PaymentRow[] {
  const rows = new Map<string, PaymentRow>();
  for (const sale of server?.sales ?? []) {
    // A counter-entry is not a payment: the sale it takes back says so.
    if (sale.reversesSaleId !== null) continue;
    rows.set(sale.id, { id: sale.id, soldAt: sale.soldAt, method: sale.method, totalCents: sale.totalCents, lines: linesOf(sale.lines), state: sale.reversed ? "reversed" : "paid" });
  }
  for (const attempt of server?.pinAttempts ?? []) {
    rows.set(attempt.id, { id: attempt.id, soldAt: attempt.soldAt, method: "pin", totalCents: attempt.totalCents, lines: linesOf(attempt.lines), state: attempt.outcome === null ? "waiting" : "failed" });
  }
  for (const receipt of waiting) {
    const known = rows.get(receipt.id);
    // The server's word goes: a payment it has settled is no longer waiting, whatever this iPad still holds.
    if (known && known.state !== "waiting") continue;
    rows.set(receipt.id, {
      id: receipt.id,
      soldAt: receipt.soldAt,
      method: "pin",
      totalCents: receipt.totalCents,
      lines: linesOf(receipt.lines),
      state: receipt.cashTaken ? "cashTaken" : "waiting",
      receipt,
    });
  }
  for (const sale of unsent) {
    if (rows.has(sale.id)) continue;
    rows.set(sale.id, { id: sale.id, soldAt: sale.soldAt, method: "cash", totalCents: sale.totalCents, lines: linesOf(sale.lines), state: "unsent" });
  }
  return [...rows.values()].sort((a, b) => b.soldAt.localeCompare(a.soldAt) || b.id.localeCompare(a.id));
}
