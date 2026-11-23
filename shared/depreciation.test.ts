import { describe, expect, it } from "vitest";
import { depreciationFor, type DepreciableAsset } from "./depreciation";

const asset = (over: Partial<DepreciableAsset>): DepreciableAsset => ({
  purchaseDate: "2008-01-01",
  costCents: 949600,
  residualCents: 0,
  lifeYears: 20,
  disposedOn: null,
  ...over,
});

describe("depreciationFor", () => {
  it("goes on as e-Boekhouden did", () => {
    expect(depreciationFor(asset({}), 2027, 902120)).toBe(47480); // Straaljager
    expect(depreciationFor(asset({}), 2028, 949600)).toBe(0);
    expect(
      depreciationFor(asset({ purchaseDate: "2012-07-10", costCents: 4445721, residualCents: 200000 }), 2027, 3072928),
    ).toBe(212286); // Dome - Kopan
    expect(
      depreciationFor(asset({ purchaseDate: "2024-05-01", costCents: 584430, residualCents: 292215 }), 2027, 38962),
    ).toBe(14611); // Banken
  });

  it("writes off only what is left in the last year", () => {
    // Poort deel 1
    expect(depreciationFor(asset({ costCents: 395700, lifeYears: 10 }), 2027, 395375)).toBe(325);
  });

  it("counts months in the year of purchase", () => {
    const a = asset({ purchaseDate: "2027-07-15", costCents: 1200000 });
    expect(depreciationFor(a, 2027, 0)).toBe(30000);
    expect(depreciationFor(a, 2028, 30000)).toBe(60000);
  });

  it("stops at the month of disposal", () => {
    const a = asset({ purchaseDate: "2020-01-01", costCents: 1200000, disposedOn: "2028-03-20" });
    expect(depreciationFor(a, 2028, 0)).toBe(15000);
    expect(depreciationFor(a, 2029, 15000)).toBe(0);
  });

  it("counts the months between purchase and disposal when both are in one year", () => {
    const a = asset({ purchaseDate: "2027-03-10", costCents: 1200000, disposedOn: "2027-08-31" });
    expect(depreciationFor(a, 2027, 0)).toBe(30000); // March to August = 6 months
  });

  it("writes nothing before the year of purchase", () => {
    expect(depreciationFor(asset({ purchaseDate: "2028-02-01" }), 2027, 0)).toBe(0);
  });

  it("never goes below the residual value", () => {
    const a = asset({ costCents: 100000, residualCents: 20000, lifeYears: 2 });
    expect(depreciationFor(a, 2027, 60000)).toBe(20000);
    expect(depreciationFor(a, 2028, 80000)).toBe(0);
    expect(depreciationFor(a, 2028, 90000)).toBe(0);
  });

  it("returns 0 for impossible assets instead of throwing", () => {
    expect(depreciationFor(asset({ lifeYears: 0 }), 2027, 0)).toBe(0);
    expect(depreciationFor(asset({ costCents: -1 }), 2027, 0)).toBe(0);
    expect(depreciationFor(asset({ costCents: 1000, residualCents: 2000 }), 2027, 0)).toBe(0);
  });
});
