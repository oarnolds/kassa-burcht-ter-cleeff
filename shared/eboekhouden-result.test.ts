import { describe, expect, it } from "vitest";
import { ACCOUNTS } from "./accounts";
import { EbResultError, mapToAccounts, parseEBoekhoudenResult, type EbResult } from "./eboekhouden-result";
import { wvParts, type WvRow } from "./fixtures/eboekhouden-wv";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EbResultError);
    return (error as EbResultError).message;
  }
  return "no error";
}

const READ: EbResult = {
  year: 2025,
  rows: [
    { code: "4301", name: "Huur", debitCents: 120000, creditCents: 0 },
    { code: "4302", name: "Onderhoud gebouw", debitCents: 452898, creditCents: 0 },
    { code: "4303", name: "Onderhoud inventaris", debitCents: 31050, creditCents: 0 },
    { code: "4760", name: "Verzekeringen", debitCents: 84525, creditCents: 0 },
    { code: "4810", name: "Kamer van Koophandel", debitCents: 7515, creditCents: 0 },
    { code: "4311", name: "Overige huisvestingskosten", debitCents: 6000, creditCents: 0 },
    { code: "8000", name: "Contributie", debitCents: 0, creditCents: 250000 },
    { code: "8002", name: "Contributie gezinnen", debitCents: 0, creditCents: 125050 },
    { code: "8012", name: "Winkelverkoop-Toegang pin", debitCents: 0, creditCents: 987654 },
    { code: "8025", name: "Donaties/schenkingen", debitCents: 25000, creditCents: 0 },
    { code: "9999", name: "Eindresultaat", debitCents: 0, creditCents: 10000 },
  ],
  saldo: { label: "Saldo winst", cents: 645716 },
};

describe("parseEBoekhoudenResult", () => {
  it("reads the year, every account row, 9999 and the Saldo winst; the formulas of the last row are left out", () => {
    expect(parseEBoekhoudenResult(wvParts())).toEqual(READ);
  });

  it("reads inline strings and string cells too", () => {
    expect(parseEBoekhoudenResult(wvParts({ inline: true }))).toEqual(READ);
  });

  it("follows the workbook to its first sheet", () => {
    expect(parseEBoekhoudenResult(wvParts({ sheetPath: "worksheets/blad7.xml" })).rows).toHaveLength(11);
  });

  it("turns amounts into whole cents, without floating-point surprises", () => {
    const rows: WvRow[] = [
      { code: "4512", name: "Schoonmaak", verlies: 0.1 },
      { code: "4513", name: "Website", verlies: 1234.56, winst: 0.29 },
      { code: "8030", name: "Rente", winst: 118.44 },
    ];
    expect(parseEBoekhoudenResult(wvParts({ rows, saldo: { label: "Saldo verlies", winst: 1116.3 } }))).toEqual({
      year: 2025,
      rows: [
        { code: "4512", name: "Schoonmaak", debitCents: 10, creditCents: 0 },
        { code: "4513", name: "Website", debitCents: 123456, creditCents: 29 },
        { code: "8030", name: "Rente", debitCents: 0, creditCents: 11844 },
      ],
      saldo: { label: "Saldo verlies", cents: 111630 },
    });
  });

  it("has no saldo when the file has none", () => {
    expect(parseEBoekhoudenResult(wvParts({ saldo: null })).saldo).toBeNull();
  });

  it("refuses a sheet that is not a winst-en-verliesrekening", () => {
    expect(codeOf(() => parseEBoekhoudenResult(wvParts({ title: "Balans per 31-12-2025", header: ["Code", "Omschrijving", "Debet", "Credit"] })))).toBe(
      "not_eboekhouden_result",
    );
    expect(codeOf(() => parseEBoekhoudenResult(wvParts({ title: "Kolommenbalans 2025" })))).toBe("not_eboekhouden_result");
    expect(codeOf(() => parseEBoekhoudenResult(wvParts({ header: ["Code", "Omschrijving", "Debet", "Credit"] })))).toBe("not_eboekhouden_result");
    expect(codeOf(() => parseEBoekhoudenResult({}))).toBe("not_eboekhouden_result");
    const broken = wvParts();
    broken["xl/worksheets/sheet1.xml"] = new TextEncoder().encode("<worksheet><sheetData><row");
    expect(codeOf(() => parseEBoekhoudenResult(broken))).toBe("not_eboekhouden_result");
  });

  it("refuses an amount it cannot read", () => {
    const parts = wvParts({ inline: true });
    const sheet = new TextDecoder().decode(parts["xl/worksheets/sheet1.xml"]).replace('<c r="C11" s="2"><v>1200</v></c>', '<c r="C11" t="inlineStr"><is><t>veel</t></is></c>');
    parts["xl/worksheets/sheet1.xml"] = new TextEncoder().encode(sheet);
    expect(codeOf(() => parseEBoekhoudenResult(parts))).toBe("not_eboekhouden_result");
  });

  it("refuses a period that is not one whole calendar year", () => {
    expect(codeOf(() => parseEBoekhoudenResult(wvParts({ title: "Winst & verlies 01-01-2025 t/m 30-06-2025 (38)" })))).toBe("not_whole_year");
    expect(codeOf(() => parseEBoekhoudenResult(wvParts({ title: "Winst & verlies 01-07-2024 t/m 30-06-2025 (38)" })))).toBe("not_whole_year");
    expect(codeOf(() => parseEBoekhoudenResult(wvParts({ title: "Winst & verlies 01-01-2024 t/m 31-12-2025 (38)" })))).toBe("not_whole_year");
  });
});

describe("mapToAccounts", () => {
  it("adds the old codes up on the new accounts, as the report shows them; what no account takes stays apart", () => {
    expect(mapToAccounts(READ, [...ACCOUNTS])).toEqual({
      figures: [
        { accountCode: "4301", amountCents: 120000 },
        { accountCode: "4302", amountCents: 452898 + 31050 },
        { accountCode: "4502", amountCents: 7515 },
        { accountCode: "4508", amountCents: 84525 },
        { accountCode: "8000", amountCents: 250000 + 125050 },
        { accountCode: "8012", amountCents: 987654 },
        { accountCode: "8025", amountCents: -25000 },
      ],
      unplaced: [
        { code: "4311", name: "Overige huisvestingskosten", amountCents: 6000, kind: "expense" },
        { code: "9999", name: "Eindresultaat", amountCents: 10000, kind: null },
      ],
    });
  });

  it("takes debit minus credit on costs and credit minus debit on income", () => {
    const result: EbResult = {
      year: 2024,
      rows: [
        { code: "4514", name: "Algemene kosten", debitCents: 5000, creditCents: 1200 },
        { code: "4506", name: "Kantoorkosten", debitCents: 0, creditCents: 300 },
        { code: "8040", name: "Overige opbrengsten", debitCents: 700, creditCents: 2000 },
        { code: "8099", name: "Onbekend", debitCents: 0, creditCents: 4400 },
        { code: "9951", name: "Afronding", debitCents: 3, creditCents: 0 },
        { code: "1010", name: "Bank", debitCents: 999, creditCents: 0 },
      ],
      saldo: null,
    };
    expect(mapToAccounts(result, [...ACCOUNTS])).toEqual({
      figures: [
        { accountCode: "4514", amountCents: 3800 - 300 },
        { accountCode: "8040", amountCents: 1300 },
      ],
      unplaced: [
        { code: "8099", name: "Onbekend", amountCents: 4400, kind: "income" },
        { code: "9951", name: "Afronding", amountCents: -3, kind: null },
        { code: "1010", name: "Bank", amountCents: -999, kind: null },
      ],
    });
  });
});
