import { describe, expect, it } from "vitest";
import { EbMutationsError, parseEBoekhoudenMutations } from "./eboekhouden-mutations";
import { MUT_ROWS, mutParts, serialOf, type MutRow } from "./fixtures/eboekhouden-mutaties";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EbMutationsError);
    return (error as EbMutationsError).message;
  }
  return "no error";
}

const row = (extra: Partial<MutRow> = {}): MutRow => ({ nr: 1, date: "2026-03-04", kind: "Geld uit", amount: 10, account: "1010", contra: "4308", ...extra });

/** The sheet of `parts` with `from` replaced by `to`. */
function edit(parts: Record<string, Uint8Array>, from: string | RegExp, to: string): Record<string, Uint8Array> {
  const path = "xl/worksheets/sheet1.xml";
  const before = new TextDecoder().decode(parts[path]);
  const after = before.replace(from, to);
  expect(after, "the sheet was changed").not.toBe(before);
  return { ...parts, [path]: new TextEncoder().encode(after) };
}

describe("parseEBoekhoudenMutations", () => {
  it("reads the year, its first and last day, and every mutation as the export lists it", () => {
    const read = parseEBoekhoudenMutations(mutParts());
    expect(read.year).toBe(2026);
    expect(read.from).toBe("2026-01-02");
    expect(read.to).toBe("2026-11-20");
    expect(read.rows).toHaveLength(36);
    expect(read.rows.map((mutation) => mutation.nr)).toEqual(MUT_ROWS.map((mutation) => mutation.nr));
    expect(read.rows[0]).toEqual({
      nr: 16036,
      date: "2026-11-20",
      kind: "Geld uit",
      amountCents: 3100,
      account: "1010",
      contra: ["4308"],
      invoice: "",
      document: "",
    });
    expect(read.rows.find((mutation) => mutation.date === "2026-10-28")).toEqual({
      nr: MUT_ROWS.find((mutation) => mutation.date === "2026-10-28")!.nr,
      date: "2026-10-28",
      kind: "Geld uit",
      amountCents: 58200,
      account: "1010",
      contra: ["4507"],
      invoice: "F-2026-0042",
      document: "bon-ehbo.pdf",
    });
  });

  it("splits a Tegenrekening with several codes, and reads amounts as whole cents", () => {
    const read = parseEBoekhoudenMutations(
      mutParts({
        rows: [
          row({ nr: 3, date: "2026-06-06", kind: "Geld ontv", amount: 692.82, contra: "8010,8012" }),
          row({ nr: 2, date: "2026-03-31", amount: 3.75, account: "1020", contra: "4511, 8030" }),
          row({ nr: 1, date: "2026-01-05", amount: 1234.56, contra: "4306,4307," }),
        ],
      }),
    );
    expect(read.rows.map((mutation) => [mutation.amountCents, mutation.contra])).toEqual([
      [69282, ["8010", "8012"]],
      [375, ["4511", "8030"]],
      [123456, ["4306", "4307"]],
    ]);
  });

  it("reads a date written as text, dd-mm-jjjj, like a date number", () => {
    expect(parseEBoekhoudenMutations(mutParts({ textDates: true }))).toEqual(parseEBoekhoudenMutations(mutParts()));
    expect(serialOf("2026-01-01")).toBe(46023);
    expect(serialOf("2026-11-22")).toBe(46348);
  });

  it("finds the columns by the header, and leaves out empty rows after the mutations", () => {
    const parts = edit(mutParts({ rows: [row()] }), "</sheetData>", '<row r="40"><c r="C40" t="inlineStr"><is><t> </t></is></c></row></sheetData>');
    expect(parseEBoekhoudenMutations(parts).rows).toHaveLength(1);
    const titled = mutParts({ rows: [row()], header: ["NR", "datum", "Soort", "Bedrag", "Rekening", "Tegenrekening"] });
    expect(parseEBoekhoudenMutations(titled).rows[0]).toMatchObject({ nr: 1, invoice: "", document: "" });
  });

  it("refuses a file that is not an overview of mutations", () => {
    expect(codeOf(() => parseEBoekhoudenMutations(mutParts({ title: "Winst & verlies 01-01-2026 t/m 31-12-2026 (38)" })))).toBe("not_eboekhouden_mutations");
    expect(codeOf(() => parseEBoekhoudenMutations(mutParts({ header: ["Code", "Omschrijving", "Verlies", "Winst"] })))).toBe("not_eboekhouden_mutations");
    expect(codeOf(() => parseEBoekhoudenMutations(mutParts({ header: ["Nr", "Datum", "Soort", "Bedrag", "Rekening"] })))).toBe("not_eboekhouden_mutations");
    expect(codeOf(() => parseEBoekhoudenMutations({}))).toBe("not_eboekhouden_mutations");
    const broken = mutParts();
    broken["xl/worksheets/sheet1.xml"] = new TextEncoder().encode("<worksheet><sheetData><row");
    expect(codeOf(() => parseEBoekhoudenMutations(broken))).toBe("not_eboekhouden_mutations");
  });

  it("refuses a mutation whose date or amount cannot be read", () => {
    const one = mutParts({ rows: [row()] });
    expect(codeOf(() => parseEBoekhoudenMutations(edit(one, /<c r="B11" s="3"><v>\d+<\/v><\/c>/, '<c r="B11" t="inlineStr"><is><t>gisteren</t></is></c>')))).toBe(
      "not_eboekhouden_mutations",
    );
    expect(codeOf(() => parseEBoekhoudenMutations(edit(one, /<c r="B11" s="3"><v>\d+<\/v><\/c>/, '<c r="B11" t="inlineStr"><is><t>31-02-2026</t></is></c>')))).toBe(
      "not_eboekhouden_mutations",
    );
    expect(codeOf(() => parseEBoekhoudenMutations(edit(one, '<c r="D11" s="2"><v>10</v></c>', '<c r="D11" t="inlineStr"><is><t>veel</t></is></c>')))).toBe(
      "not_eboekhouden_mutations",
    );
    expect(codeOf(() => parseEBoekhoudenMutations(edit(one, '<c r="D11" s="2"><v>10</v></c>', "")))).toBe("not_eboekhouden_mutations");
  });

  it("refuses mutations of more than one calendar year, or none at all", () => {
    expect(codeOf(() => parseEBoekhoudenMutations(mutParts({ rows: [row({ nr: 2, date: "2026-01-02" }), row({ nr: 1, date: "2025-12-31" })] })))).toBe("not_one_year");
    expect(codeOf(() => parseEBoekhoudenMutations(mutParts({ rows: [] })))).toBe("not_one_year");
  });
});
