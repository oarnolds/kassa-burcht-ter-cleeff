import { expect, it } from "vitest";
import { cashOptions, changeFor } from "./cash";

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
