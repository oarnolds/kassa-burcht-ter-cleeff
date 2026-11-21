import { expect, it } from "vitest";
import type { CashSaleInput } from "../../shared/schemas";
import type { AdminPinAttempt, AdminSale, KassaPayments } from "../../shared/types";
import { paymentRows } from "./payment-rows";
import type { Parked } from "./store/pin";

const at = (minute: number) => `2026-11-21T12:${String(minute).padStart(2, "0")}:00.000Z`;
const lines = [{ name: "Koffie", categoryName: "Drinken", unitPriceCents: 140, qty: 1 }];

const sale = (id: string, minute: number, over: Partial<AdminSale> = {}): AdminSale => ({
  id,
  method: "cash",
  totalCents: 140,
  soldAt: at(minute),
  soldAtLocal: "",
  businessDate: "2026-11-21",
  late: false,
  reversed: false,
  reversesSaleId: null,
  reversalReason: null,
  possiblyDouble: false,
  lines,
  ...over,
});
const attempt = (id: string, minute: number, outcome: AdminPinAttempt["outcome"]): AdminPinAttempt => ({
  id,
  soldAt: at(minute),
  soldAtLocal: "",
  totalCents: 60,
  outcome,
  reason: null,
  lines: [{ name: "Entreegeld", categoryName: "Entree", unitPriceCents: 60, qty: 1 }],
});
const parked = (id: string, minute: number, over: Partial<Parked> = {}): Parked => ({
  id,
  soldAt: at(minute),
  totalCents: 60,
  lines: [{ productId: "entree", name: "Entreegeld", unitPriceCents: 60, qty: 1 }],
  parked: true,
  failed: false,
  cashTaken: false,
  ...over,
});
const unsent = (id: string, minute: number): CashSaleInput => ({
  id,
  kind: "sale",
  soldAt: at(minute),
  totalCents: 220,
  cashGivenCents: 500,
  lines: [{ productId: "thee", name: "Thee", unitPriceCents: 110, qty: 2 }],
});

it("lists the day newest first: sales, pin payments that did not go through or still wait, and what this iPad has not sent", () => {
  const server: KassaPayments = {
    sales: [sale("a", 1), sale("b", 5, { method: "pin" }), sale("c", 9, { reversed: true }), sale("r", 10, { reversesSaleId: "c", totalCents: -140 })],
    pinAttempts: [attempt("d", 3, "declined"), attempt("e", 7, null)],
  };
  const rows = paymentRows(server, [parked("e", 7)], [unsent("f", 11)]);
  expect(rows.map((row) => [row.id, row.method, row.state, row.totalCents])).toEqual([
    ["f", "cash", "unsent", 220],
    ["c", "cash", "reversed", 140],
    ["e", "pin", "waiting", 60],
    ["b", "pin", "paid", 140],
    ["d", "pin", "failed", 60],
    ["a", "cash", "paid", 140],
  ]);
  // The counter-entry is not a payment: its sale says "teruggedraaid".
  expect(rows.map((row) => row.id)).not.toContain("r");
  // A waiting payment this iPad still holds can be rung up as cash from the list.
  expect(rows.find((row) => row.id === "e")!.receipt).toMatchObject({ id: "e", parked: true });
  expect(rows.find((row) => row.id === "a")!.lines).toEqual([{ name: "Koffie", qty: 1 }]);
});

it("shows what only this iPad knows when the server cannot be asked", () => {
  const rows = paymentRows(null, [parked("w", 4), parked("x", 6, { cashTaken: true })], [unsent("u", 8)]);
  expect(rows.map((row) => [row.id, row.state])).toEqual([
    ["u", "unsent"],
    ["x", "cashTaken"],
    ["w", "waiting"],
  ]);
});

it("takes the server's word for a payment this iPad still thinks is waiting", () => {
  const server: KassaPayments = { sales: [sale("p", 2, { method: "pin" })], pinAttempts: [attempt("q", 3, "expired")] };
  const rows = paymentRows(server, [parked("p", 2), parked("q", 3), parked("s", 4)], [unsent("a", 1)]);
  expect(rows.map((row) => [row.id, row.state])).toEqual([
    // The server never got this start: only the iPad knows of it.
    ["s", "waiting"],
    ["q", "failed"],
    ["p", "paid"],
    ["a", "unsent"],
  ]);
  expect(rows.find((row) => row.id === "p")!.receipt).toBeUndefined();
});

it("does not list a cash sale twice once the server has it", () => {
  const rows = paymentRows({ sales: [sale("f", 11, { totalCents: 220 })], pinAttempts: [] }, [], [unsent("f", 11)]);
  expect(rows.map((row) => [row.id, row.state])).toEqual([["f", "paid"]]);
});
