import { expect, it } from "vitest";
import { cashSaleInput } from "../../shared/schemas";
import { cashOptions, cashSaleFor, changeFor } from "./cash";

it("offers the banknotes above the amount", () => {
  expect(cashOptions(960)).toEqual([1000, 2000, 5000]);
  expect(cashOptions(500)).toEqual([1000, 2000, 5000]);
  expect(cashOptions(60)).toEqual([500, 1000, 2000, 5000]);
  expect(cashOptions(6000)).toEqual([]);
});

it("works out the change", () => {
  expect(changeFor(960, 1000)).toBe(40);
  expect(changeFor(360, 360)).toBe(0);
});

it("makes a cash sale the server accepts, with and without the pin attempt it replaces", () => {
  const receipt = { totalCents: 250, lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 1 }, { productId: "koffie", name: "Koffie", unitPriceCents: 140, qty: 1 }] };
  const before = Date.now();
  const plain = cashSaleFor(receipt, 500, null);
  expect(cashSaleInput.parse(plain)).toEqual(plain);
  expect(plain).toMatchObject({ kind: "sale", totalCents: 250, cashGivenCents: 500, lines: receipt.lines });
  expect(plain).not.toHaveProperty("insteadOfSaleId");
  expect(plain.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(Date.parse(plain.soldAt)).toBeGreaterThanOrEqual(before);
  expect(plain.lines).not.toBe(receipt.lines);

  const attempt = crypto.randomUUID();
  const instead = cashSaleFor(receipt, 250, attempt);
  expect(cashSaleInput.parse(instead)).toEqual(instead);
  expect(instead.insteadOfSaleId).toBe(attempt);
  expect(instead.id).not.toBe(plain.id);
  expect(instead.id).not.toBe(attempt);
});
