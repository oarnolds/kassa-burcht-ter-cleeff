import { describe, expect, it } from "vitest";
import { parseAssetPaste } from "./asset-paste";
import { VASTE_ACTIVA_2026 } from "./fixtures/vaste-activa-2026";

describe("parseAssetPaste", () => {
  // Rows copied from the penningmeester's paste of 23 November 2026.
  it("reads the rows of Vaste activa 2026", () => {
    expect(parseAssetPaste(VASTE_ACTIVA_2026).assets).toEqual([
      { name: "Straaljager", purchaseDate: "2008-01-01", costCents: 949600, writtenOffCents: 854640, lifeYears: 20 },
      { name: "Dome - Kopan", purchaseDate: "2012-07-10", costCents: 4445721, writtenOffCents: 2860642, lifeYears: 20 },
    ]);
  });

  it("reads the overview as e-Boekhouden copies it: the header one word per line and an empty column after 31-12", () => {
    // The layout of the penningmeester's paste of 23 November 2026, rows as they came; the totals carry an empty date.
    const text = [
      "Vaste activa 2026",
      "Activa",
      "Aanschafdatum",
      "Aanschafwaarde",
      "per 01-01-2026",
      "Afschrijven",
      "in (jaren)",
      ["Speeltoestellen", "", "", "", "", "", "", "", "", "", "", ""].join("\t"),
      ["Fietsjes", "01-04-2018", "1.397,00", "0,00", "1.397,00", "", "1.353,50", "43,50", "0,00", "1.397,00", "0,00", "8"].join("\t"),
      ["Dome - Kopan", "10-07-2012", "44.457,21", "0,00", "44.457,21", "", "28.606,42", "2.122,86", "0,00", "30.729,28", "13.727,93", "20"].join("\t"),
      ["Totaal Speeltoestellen", "", "45.854,21", "0,00", "45.854,21", "", "29.959,92", "2.166,36", "0,00", "32.126,28", "13.727,93", ""].join("\t"),
      ["45.854,21", "0,00", "45.854,21", "", "29.959,92", "2.166,36", "0,00", "32.126,28", "13.727,93"].join("\t"),
    ].join("\n");
    const { assets, skipped } = parseAssetPaste(text);
    expect(assets).toEqual([
      { name: "Fietsjes", purchaseDate: "2018-04-01", costCents: 139700, writtenOffCents: 135350, lifeYears: 8 },
      { name: "Dome - Kopan", purchaseDate: "2012-07-10", costCents: 4445721, writtenOffCents: 2860642, lifeYears: 20 },
    ]);
    expect(skipped).toHaveLength(10);
  });

  it("reads the cost and what was written off on 1 January", () => {
    // Without the empty column: column 2 is the cost on 1-1 and column 5 what was written off up to 1-1; 31-12 is not read.
    const [straaljager] = parseAssetPaste(VASTE_ACTIVA_2026).assets;
    expect(straaljager).toMatchObject({ costCents: 949600, writtenOffCents: 854640 });
  });

  it("skips the header lines, the group row and the totals", () => {
    const { skipped } = parseAssetPaste(VASTE_ACTIVA_2026);
    expect(skipped).toHaveLength(24);
    expect(skipped[0]).toBe("Vaste activa 2026");
    expect(skipped).toContain("Speeltoestellen");
    expect(skipped.at(-2)).toMatch(/^Totaal Speeltoestellen\t/);
    expect(skipped.at(-1)).toMatch(/^53\.953,21\t/);
  });

  it("reads columns split by two or more spaces, a euro sign and a minus", () => {
    const text = [
      "Vaste activa 2026",
      "",
      "Poort deel 1  1-1-2017  € 3.957,00  0,00  3.957,00  -3.558,05  -395,70  0,00  0,00  -3.953,75  3,25  10",
      "   ",
    ].join("\r\n");
    expect(parseAssetPaste(text)).toEqual({
      assets: [{ name: "Poort deel 1", purchaseDate: "2017-01-01", costCents: 395700, writtenOffCents: 355805, lifeYears: 10 }],
      skipped: ["Vaste activa 2026"],
    });
  });

  it("skips a row with a date that does not exist, an amount it cannot read or no years", () => {
    const cells = (date: string, cost: string, years: string) =>
      ["Toestel", date, cost, "0,00", "0,00", "100,00", "0,00", "0,00", "0,00", "100,00", "900,00", years].join("\t");
    const { assets, skipped } = parseAssetPaste([cells("31-2-2020", "1.000,00", "10"), cells("1-3-2020", "veel", "10"), cells("1-3-2020", "1.000,00", ""), cells("1-3-2020", "1.000,00", "0")].join("\n"));
    expect(assets).toEqual([]);
    expect(skipped).toHaveLength(4);
  });
});
