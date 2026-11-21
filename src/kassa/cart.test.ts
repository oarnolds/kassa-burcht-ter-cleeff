import { expect, it } from "vitest";
import { cartReducer, cartTotal, emptyCart, qtyOf, type CartAction } from "./cart";

const ijs = { id: "aardbeitje", name: "Aardbeitje", priceCents: 110 };
const stat = { id: "statiegeld", name: "Statiegeld", priceCents: 15 };
const run = (...actions: CartAction[]) => actions.reduce(cartReducer, emptyCart);

it("counts a second tap on the same product on the same line", () => {
  expect(run({ type: "add", product: ijs }, { type: "add", product: ijs }).lines).toEqual([
    { productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 2 },
  ]);
});

it("adds up the total", () => {
  expect(cartTotal(run({ type: "add", product: ijs }, { type: "add", product: stat, qty: 40 }))).toBe(710);
  expect(cartTotal(emptyCart)).toBe(0);
});

it("keeps the lines in the order they were first tapped", () => {
  expect(run({ type: "add", product: stat }, { type: "add", product: ijs }, { type: "add", product: stat }).lines.map((l) => l.productId)).toEqual([
    "statiegeld",
    "aardbeitje",
  ]);
});

it("removes the line when the last piece is taken off", () => {
  expect(run({ type: "add", product: ijs }, { type: "dec", productId: "aardbeitje" }).lines).toEqual([]);
  expect(qtyOf(run({ type: "add", product: ijs, qty: 3 }, { type: "dec", productId: "aardbeitje" }), "aardbeitje")).toBe(2);
});

it("adds one with inc", () => {
  expect(qtyOf(run({ type: "add", product: ijs }, { type: "inc", productId: "aardbeitje" }), "aardbeitje")).toBe(2);
  expect(qtyOf(emptyCart, "aardbeitje")).toBe(0);
});

it("removes a whole line", () => {
  expect(run({ type: "add", product: ijs, qty: 5 }, { type: "remove", productId: "aardbeitje" })).toEqual(emptyCart);
});

it("clears the receipt", () => {
  expect(run({ type: "add", product: ijs }, { type: "add", product: stat, qty: 3 }, { type: "clear" })).toEqual(emptyCart);
});

it("ignores adding nothing", () => {
  expect(run({ type: "add", product: ijs, qty: 0 })).toEqual(emptyCart);
  expect(run({ type: "add", product: ijs, qty: -2 })).toEqual(emptyCart);
});

it("keeps the price of the first tap", () => {
  const dearer = { ...ijs, priceCents: 150 };
  expect(run({ type: "add", product: ijs }, { type: "add", product: dearer }).lines).toEqual([
    { productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 2 },
  ]);
});

it("never lets a line grow past what the server accepts", () => {
  expect(qtyOf(run({ type: "add", product: stat, qty: 999 }, { type: "add", product: stat, qty: 5 }), "statiegeld")).toBe(999);
  expect(qtyOf(run({ type: "add", product: stat, qty: 999 }, { type: "inc", productId: "statiegeld" }), "statiegeld")).toBe(999);
});

it("does not change the cart it is given", () => {
  const before = run({ type: "add", product: ijs });
  const copy = structuredClone(before);
  cartReducer(before, { type: "inc", productId: "aardbeitje" });
  cartReducer(before, { type: "add", product: stat });
  expect(before).toEqual(copy);
});
