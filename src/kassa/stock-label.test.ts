import { expect, it } from "vitest";
import type { CatalogProduct } from "../../shared/types";
import { orderLineText, stockLabel } from "./stock-label";

const p = (o: Partial<CatalogProduct>): CatalogProduct => ({
  id: "a",
  name: "Aardbeitje",
  priceCents: 110,
  categoryId: "ijs",
  sort: 1,
  quantityPad: false,
  trackStock: true,
  stock: 20,
  reorderAt: 12,
  ...o,
});

it("says nothing while there is plenty", () => {
  expect(stockLabel(p({}), 0)).toBeNull();
  expect(stockLabel(p({}), 7)).toBeNull();
});

it("says how many are left from the reorder level down", () => {
  expect(stockLabel(p({}), 8)).toBe("nog 12");
  expect(stockLabel(p({ stock: 5 }), 0)).toBe("nog 5");
  expect(stockLabel(p({ stock: 5 }), 4)).toBe("nog 1");
});

it("asks whether it is gone when the count says none are left", () => {
  expect(stockLabel(p({ stock: 5 }), 5)).toBe("op?");
  expect(stockLabel(p({ stock: -3 }), 0)).toBe("op?");
  expect(stockLabel(p({ reorderAt: 0, stock: 0 }), 0)).toBe("op?");
});

it("says nothing for a product without a reorder level or without stock keeping", () => {
  expect(stockLabel(p({ reorderAt: null, stock: 0 }), 0)).toBeNull();
  expect(stockLabel(p({ trackStock: false, stock: null }), 0)).toBeNull();
  expect(stockLabel(p({ stock: null }), 0)).toBeNull();
});

it("counts a reversal back in", () => {
  expect(stockLabel(p({ stock: 12 }), -1)).toBeNull();
});

it("describes an order line in boxes and loose pieces", () => {
  expect(orderLineText({ productId: "a", name: "Aardbeitje", boxes: 2, looseUnits: 0, units: 48 })).toBe("2 dozen Aardbeitje (48 stuks)");
  expect(orderLineText({ productId: "a", name: "Aardbeitje", boxes: 1, looseUnits: 0, units: 24 })).toBe("1 doos Aardbeitje (24 stuks)");
  expect(orderLineText({ productId: "a", name: "Aardbeitje", boxes: 2, looseUnits: 5, units: 53 })).toBe("2 dozen + 5 los Aardbeitje (53 stuks)");
  expect(orderLineText({ productId: "b", name: "Bosfruit", boxes: 0, looseUnits: 6, units: 6 })).toBe("6 los Bosfruit (6 stuks)");
  expect(orderLineText({ productId: "b", name: "Bosfruit", boxes: 0, looseUnits: 1, units: 1 })).toBe("1 los Bosfruit (1 stuk)");
});
