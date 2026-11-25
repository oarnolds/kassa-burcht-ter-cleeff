import { strFromU8, unzipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { AttachmentFetchError, buildAttachmentsZip, buildWorkbook } from "./year-export";
import { yearChanges, yearData, yearEntries } from "./ledger-test-data";

// The jaaroverzicht as files, made in the browser (spec §15): the Excel workbook and the zip of the attachments.

const SHEETS = ["Balans", "Winst en verlies", "Boekingen", "Grootboek", "Speeltoestellen", "Controles", "Wijzigingen"];

type Value = string | number | null;
type Cell = { value: Value; style: number };

const unescape = (text: string) =>
  text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
const columnOf = (letters: string) => [...letters].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;

/** The cells of a worksheet by reference (`A1`), as Excel reads them: inline text or a number. */
function cellsOf(xml: string): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const [, ref, attrs, inner = ""] of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
    const style = Number(/ s="(\d+)"/.exec(attrs!)?.[1] ?? 0);
    const value = / t="inlineStr"/.test(attrs!) ? unescape(/<t[^>]*>(.*?)<\/t>/s.exec(inner)![1]!) : Number(/<v>(.*?)<\/v>/.exec(inner)![1]);
    cells.set(ref!, { value, style });
  }
  return cells;
}

/** The rows of a worksheet as lists of values, an empty cell `null`, nothing after the last value. */
function rowsOf(xml: string): Value[][] {
  const rows: Value[][] = [];
  for (const [ref, cell] of cellsOf(xml)) {
    const [, letters, digits] = /^([A-Z]+)(\d+)$/.exec(ref)!;
    const row = (rows[Number(digits) - 1] ??= []);
    const column = columnOf(letters!);
    while (row.length < column) row.push(null);
    row[column] = cell.value;
  }
  return Array.from(rows, (row) => row ?? []);
}

async function unzip(blob: Blob): Promise<Record<string, Uint8Array>> {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

/** The workbook's sheets by name, as XML text. */
async function sheetsOf(blob: Blob): Promise<{ files: Record<string, Uint8Array>; names: string[]; sheet(name: string): string }> {
  const files = await unzip(blob);
  const workbook = strFromU8(files["xl/workbook.xml"]!);
  const names = [...workbook.matchAll(/<sheet name="([^"]*)"/g)].map((match) => unescape(match[1]!));
  return { files, names, sheet: (name) => strFromU8(files[`xl/worksheets/sheet${names.indexOf(name) + 1}.xml`]!) };
}

it("writes every sheet, with Voorlopig for an open year", async () => {
  const closed = await buildWorkbook(yearData(), yearEntries(), yearChanges());
  expect(closed.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const book = await sheetsOf(closed);
  expect(book.names).toEqual(SHEETS);
  for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml"]) expect(book.files[part]).toBeDefined();
  const types = strFromU8(book.files["[Content_Types].xml"]!);
  SHEETS.forEach((_, i) => expect(types).toContain(`PartName="/xl/worksheets/sheet${i + 1}.xml"`));
  expect(strFromU8(book.files["_rels/.rels"]!)).toContain('Target="xl/workbook.xml"');
  for (const name of SHEETS) expect(cellsOf(book.sheet(name)).get("A1")).toEqual({ value: "Jaaroverzicht 2027", style: expect.any(Number) });
  expect(rowsOf(book.sheet("Balans"))[1]).toEqual(["Afgesloten op 04-02-2028"]);

  const balans = rowsOf(book.sheet("Balans"));
  expect(balans).toContainEqual(["Rekening", "Naam", "01-01-2027", "31-12-2027"]);
  expect(balans).toContainEqual(["0130", "Speeltoestellen en inventaris", 9496, 9496]);
  expect(balans).toContainEqual(["0135", "Afschrijving speeltoestellen en inventaris", -9021.2, -9221.2]);
  expect(balans).toContainEqual(["1010", "ING betaalrekening", 5000, 5098]);
  expect(balans).toContainEqual([null, "Totaal bezittingen", 5474.8, 5372.8]);
  expect(balans).toContainEqual(["1700", "Nog te betalen", 300, 300]);
  expect(balans).toContainEqual([null, "Resultaat nog niet geboekt", 0, -102]);
  expect(balans).toContainEqual([null, "Totaal schulden en eigen vermogen", 5474.8, 5372.8]);

  const result = rowsOf(book.sheet("Winst en verlies"));
  expect(result).toContainEqual(["Rekening", "Naam", "2027", "2026"]);
  expect(result).toContainEqual(["8012", "Entree", 120, 110]);
  expect(result).toContainEqual(["8030", "Rente", 3, 0]);
  expect(result).toContainEqual([null, "Totaal opbrengsten", 123, 110]);
  expect(result).toContainEqual([null, "Totaal kosten", 225, 218]);
  expect(result).toContainEqual([null, "Resultaat", -102, -108]);

  const entries = book.sheet("Boekingen");
  const entryRows = rowsOf(entries);
  expect(entryRows).toContainEqual(["Nummer", "Datum", "Omschrijving", "Rekening", "Bedrag", "Notitie", "Bijlagen"]);
  expect(entryRows).toContainEqual([12, "01-03-2027", "Factuur Goodoo", "4514 Diversen", 25, "schroeven", "12-1-bon-goodoo.pdf, 12-2-foto.jpg"]);
  expect(entryRows).toContainEqual([12, "01-03-2027", "Factuur Goodoo", "1010 ING betaalrekening", -25]);
  expect(entryRows).toContainEqual([13, "31-12-2027", "Rente", "1010 ING betaalrekening", 3, null, "13-1-rente_overzicht_2027.pdf"]);
  expect(entryRows).toContainEqual([2, "01-02-2027", "Entree & ijs <zomer>", "1010 ING betaalrekening", 120]);
  // Text is escaped; amounts are numbers in euros with two decimals, in the format #,##0.00.
  expect(entries).toContain("Entree &amp; ijs &lt;zomer&gt;");
  expect(entries).toContain("<v>-25.00</v>");
  const styles = strFromU8(book.files["xl/styles.xml"]!);
  expect(styles).toMatch(/<numFmt numFmtId="(\d+)" formatCode="#,##0.00"\/>/);
  const amountFormat = /<numFmt numFmtId="(\d+)" formatCode="#,##0.00"\/>/.exec(styles)![1];
  const formats = [.../<cellXfs[^>]*>(.*?)<\/cellXfs>/s.exec(styles)![1]!.matchAll(/<xf [^>]*?\/?>/g)].map((match) => match[0]);
  const amountCell = [...cellsOf(entries).values()].find((cell) => cell.value === -25)!;
  expect(formats[amountCell.style]).toContain(`numFmtId="${amountFormat}"`);
  // The header row is bold.
  const fonts = [.../<fonts[^>]*>(.*?)<\/fonts>/s.exec(styles)![1]!.matchAll(/<font>(.*?)<\/font>/gs)].map((match) => match[1]);
  const headerCell = [...cellsOf(entries).values()].find((cell) => cell.value === "Omschrijving")!;
  const font = Number(/fontId="(\d+)"/.exec(formats[headerCell.style]!)![1]);
  expect(fonts[font]).toContain("<b/>");

  const ledger = rowsOf(book.sheet("Grootboek"));
  const at = (title: string) => ledger.findIndex((row) => row[0] === title);
  expect(ledger.slice(at("1010 ING betaalrekening"), at("1010 ING betaalrekening") + 5)).toEqual([
    ["1010 ING betaalrekening"],
    ["01-01-2027", null, "Beginbalans", null, 5000],
    ["01-02-2027", 2, "Entree & ijs <zomer>", 120, 5120],
    ["01-03-2027", 12, "Factuur Goodoo", -25, 5095],
    ["31-12-2027", 13, "Rente", 3, 5098],
  ]);
  expect(ledger.slice(at("8012 Entree"), at("8012 Entree") + 3)).toEqual([["8012 Entree"], ["01-01-2027", null, "Beginbalans", null, 0], ["01-02-2027", 2, "Entree & ijs <zomer>", -120, -120]]);
  // The opening entry is the Beginbalans, not a line of its own.
  expect(ledger.some((row) => row[1] === 1)).toBe(false);

  const assets = rowsOf(book.sheet("Speeltoestellen"));
  expect(assets).toContainEqual(["Naam", "Aanschafdatum", "Aanschafwaarde", "Restwaarde", "Levensduur (jaren)", "Afgeschreven", "Boekwaarde", "Afgevoerd op"]);
  expect(assets).toContainEqual(["Straaljager", "01-01-2008", 9496, 0, 20, 9221.2, 274.8]);
  expect(assets).toContainEqual(["Afschrijving 2027"]);
  expect(assets).toContainEqual(["Straaljager", 200]);
  expect(assets).toContainEqual(["Geboekt"]);

  const checks = rowsOf(book.sheet("Controles"));
  expect(checks).toContainEqual(["Alle bankregels geboekt", "ok", "Alle bankregels van 2027 zijn geboekt"]);
  expect(checks).toContainEqual(["Saldo's gelijk aan de bank", "niet ok", "ING betaalrekening: boekhouding € 5.098,00, bank € 5.090,00 op 31-12-2027"]);
  expect(checks).toContainEqual(["15-01-2028", "Afgesloten", "Rente volgt"]);
  expect(checks).toContainEqual(["03-02-2028", "Heropend", "Kascommissie vond een fout"]);
  expect(checks).toContainEqual(["04-02-2028", "Afgesloten"]);

  const changes = rowsOf(book.sheet("Wijzigingen"));
  expect(changes).toContainEqual(["Datum", "Boeking", "Wat ervoor stond", "Wat erna", "Notitie"]);
  const right = "01-03-2027 Factuur Goodoo: 4514 25,00 (schroeven); 1010 -25,00";
  expect(changes).toContainEqual(["02-03-2027", 12, "01-03-2027 Factuur Goodo: 4514 24,00; 1010 -24,00", right]);
  expect(changes).toContainEqual(["05-03-2027", 12, right, right, "bijlage verborgen: oud.pdf"]);

  // An open year says so at the top of every sheet.
  const open = await sheetsOf(await buildWorkbook(yearData({ status: "open", events: [] }), yearEntries(), []));
  expect(open.names).toEqual(SHEETS);
  for (const name of SHEETS) expect(cellsOf(open.sheet(name)).get("A1")!.value).toBe("Voorlopig");
  expect(rowsOf(open.sheet("Balans"))[1]).toEqual(["Jaaroverzicht 2027, nog niet afgesloten"]);
  expect(rowsOf(open.sheet("Wijzigingen"))).toContainEqual(["Geen wijzigingen"]);
});

it("puts the notes on top of the Excel and the PDF", async () => {
  const notes = ["Boekingen tot en met 24-11-2027 komen uit elders; hun bijlagen staan daar.", "Tot 21-11-2027 staat het op twee rekeningen."];
  const book = await sheetsOf(await buildWorkbook(yearData({ notes }), yearEntries(), yearChanges()));
  // On the first sheet each note has its own row, above the heading; the rest follows below, a blank row between.
  expect(rowsOf(book.sheet("Balans")).slice(0, 7)).toEqual([[notes[0]], [notes[1]], [], ["Jaaroverzicht 2027"], ["Afgesloten op 04-02-2028"], [], ["Rekening", "Naam", "01-01-2027", "31-12-2027"]]);
  // The other sheets stay as they were.
  for (const name of SHEETS.slice(1)) expect(cellsOf(book.sheet(name)).get("A1")!.value).toBe("Jaaroverzicht 2027");
});

it("names each attachment after its entry number", async () => {
  const fetched: string[] = [];
  const progress = vi.fn();
  const zip = await buildAttachmentsZip(
    yearEntries(),
    async (id) => {
      fetched.push(id);
      return new TextEncoder().encode(`inhoud van ${id}`);
    },
    progress,
  );
  expect(zip.type).toBe("application/zip");
  const files = await unzip(zip);
  expect(Object.keys(files)).toEqual(["12-1-bon-goodoo.pdf", "12-2-foto.jpg", "13-1-rente_overzicht_2027.pdf"]);
  expect(strFromU8(files["12-2-foto.jpg"]!)).toBe("inhoud van a2");
  expect(strFromU8(files["13-1-rente_overzicht_2027.pdf"]!)).toBe("inhoud van a3");
  expect(fetched).toEqual(["a1", "a2", "a3"]);
  // Counted in entries with attachments.
  expect(progress.mock.calls).toEqual([
    [1, 2],
    [2, 2],
  ]);

  // An attachment that does not come stops the zip, saying which one.
  const failing = buildAttachmentsZip(yearEntries(), async (id) => {
    if (id === "a3") throw new Error("404");
    return new Uint8Array([1]);
  });
  await expect(failing).rejects.toBeInstanceOf(AttachmentFetchError);
  await expect(failing).rejects.toMatchObject({ number: 13, filename: "rente/overzicht:2027.pdf" });
});
