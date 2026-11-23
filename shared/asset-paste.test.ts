import { describe, expect, it } from "vitest";
import { parseAssetPaste } from "./asset-paste";
import { VASTE_ACTIVA_2026 } from "./fixtures/vaste-activa-2026";

describe("parseAssetPaste", () => {
  // Rows copied from the penningmeester's paste of 23 November 2026.
  it("reads the rows of Vaste activa 2026", () => {
    expect(parseAssetPaste(VASTE_ACTIVA_2026).assets).toEqual([
      { name: "Straaljager", purchaseDate: "2008-01-01", costCents: 949600, writtenOffCents: 902120, lifeYears: 20 },
      { name: "Dome - Kopan", purchaseDate: "2012-07-10", costCents: 4445721, writtenOffCents: 3072928, lifeYears: 20 },
    ]);
  });

  it("skips the header, the group row and the totals", () => {
    const { skipped } = parseAssetPaste(VASTE_ACTIVA_2026);
    expect(skipped).toHaveLength(3);
    expect(skipped[0]).toMatch(/^Omschrijving\tAanschafdatum/);
    expect(skipped[1]).toBe("Speeltoestellen");
    expect(skipped[2]).toMatch(/^Totaal Speeltoestellen\t/);
  });

  it("reads columns split by two or more spaces, a euro sign and a minus", () => {
    const text = [
      "Vaste activa 2026",
      "",
      "Poort deel 1  1-1-2017  3.957,00  0,00  € 3.957,00  -3.558,05  -395,70  0,00  0,00  -3.953,75  3,25  10",
      "   ",
    ].join("\r\n");
    expect(parseAssetPaste(text)).toEqual({
      assets: [{ name: "Poort deel 1", purchaseDate: "2017-01-01", costCents: 395700, writtenOffCents: 395375, lifeYears: 10 }],
      skipped: ["Vaste activa 2026"],
    });
  });

  it("skips a row with a date that does not exist, an amount it cannot read or no years", () => {
    const cells = (date: string, cost: string, years: string) =>
      ["Toestel", date, "0,00", "0,00", cost, "0,00", "0,00", "0,00", "0,00", "100,00", "900,00", years].join("\t");
    const { assets, skipped } = parseAssetPaste([cells("31-2-2020", "1.000,00", "10"), cells("1-3-2020", "veel", "10"), cells("1-3-2020", "1.000,00", ""), cells("1-3-2020", "1.000,00", "0")].join("\n"));
    expect(assets).toEqual([]);
    expect(skipped).toHaveLength(4);
  });
});
