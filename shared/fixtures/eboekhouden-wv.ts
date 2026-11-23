// A made-up "Winst & verlies" export of e-Boekhouden, as the parts of the unzipped .xlsx. Laid out like the real
// one: the vereniging's name and address on top, the period in A8, the header in row 10, one row per account
// (the old code as text), 9999 Eindresultaat, "Saldo winst" without a code and a last row of formulas. Every name
// and amount here is invented.

export type WvRow = { code: string; name: string; verlies?: number; winst?: number };

export type WvSaldo = { label: string; verlies?: number; winst?: number };

export type WvOptions = {
  title?: string;
  header?: [string, string, string, string];
  rows?: WvRow[];
  saldo?: WvSaldo | null;
  /** Texts as inline strings (the names as `t="str"`) instead of shared strings. */
  inline?: boolean;
  /** Where the workbook's relationship puts the sheet, under `xl/`. */
  sheetPath?: string;
};

export const WV_TITLE = "Winst & verlies 01-01-2025 t/m 31-12-2025 (38)";

export const WV_ROWS: WvRow[] = [
  { code: "4301", name: "Huur", verlies: 1200 },
  { code: "4302", name: "Onderhoud gebouw", verlies: 4528.98 },
  { code: "4303", name: "Onderhoud inventaris", verlies: 310.5 },
  { code: "4760", name: "Verzekeringen", verlies: 845.25 },
  { code: "4810", name: "Kamer van Koophandel", verlies: 75.15 },
  { code: "4311", name: "Overige huisvestingskosten", verlies: 60 },
  { code: "8000", name: "Contributie", winst: 2500 },
  { code: "8002", name: "Contributie gezinnen", winst: 1250.5 },
  { code: "8012", name: "Winkelverkoop-Toegang pin", winst: 9876.54 },
  { code: "8025", name: "Donaties/schenkingen", verlies: 250 },
  { code: "9999", name: "Eindresultaat", winst: 100 },
];

/** e-Boekhouden's own balancing figure for WV_ROWS: Winst minus Verlies, 9999 included. */
export const WV_SALDO: WvSaldo = { label: "Saldo winst", verlies: 6457.16 };

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const bytes = (text: string) => new TextEncoder().encode(text);

/** The parts of the .xlsx, by their path in the zip. */
export function wvParts(options: WvOptions = {}): Record<string, Uint8Array> {
  const title = options.title ?? WV_TITLE;
  const header = options.header ?? ["Code", "Omschrijving", "Verlies", "Winst"];
  const list = options.rows ?? WV_ROWS;
  const saldo = options.saldo === undefined ? WV_SALDO : options.saldo;
  const sheetPath = options.sheetPath ?? "worksheets/sheet1.xml";

  const strings: string[] = [];
  const text = (ref: string, value: string, asStr = false) => {
    if (options.inline) {
      return asStr
        ? `<c r="${ref}" s="1" t="str"><v>${escape(value)}</v></c>`
        : `<c r="${ref}" s="1" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
    }
    strings.push(value);
    return `<c r="${ref}" s="1" t="s"><v>${strings.length - 1}</v></c>`;
  };
  const number = (ref: string, value: number) => `<c r="${ref}" s="2"><v>${value}</v></c>`;
  const formula = (ref: string, sum: string, value: number) => `<c r="${ref}" s="3"><f>${sum}</f><v>${value}</v></c>`;

  const rows: string[] = [];
  const row = (n: number, cells: string[]) => rows.push(`<row r="${n}" spans="1:4">${cells.join("")}</row>`);
  row(1, [text("A1", "Speeltuinvereniging De Voorbeeldtuin")]);
  row(2, [text("A2", "Voorbeeldlaan 1")]);
  row(3, [text("A3", "9999 ZZ Voorbeeld")]);
  row(5, [text("A5", "Datum: 24-11-2026")]);
  row(8, [text("A8", title)]);
  row(10, header.map((name, i) => text(`${"ABCD"[i]}10`, name)));
  let n = 11;
  let verlies = 0;
  let winst = 0;
  for (const line of list) {
    const cells = [text(`A${n}`, line.code), text(`B${n}`, line.name, true)];
    if (line.verlies !== undefined) cells.push(number(`C${n}`, line.verlies));
    if (line.winst !== undefined) cells.push(number(`D${n}`, line.winst));
    verlies += line.verlies ?? 0;
    winst += line.winst ?? 0;
    row(n++, cells);
  }
  if (saldo) {
    const cells = [text(`B${n}`, saldo.label)];
    if (saldo.verlies !== undefined) cells.push(number(`C${n}`, saldo.verlies));
    if (saldo.winst !== undefined) cells.push(number(`D${n}`, saldo.winst));
    verlies += saldo.verlies ?? 0;
    winst += saldo.winst ?? 0;
    row(n++, cells);
  }
  row(n, [formula(`C${n}`, `SUM(C11:C${n - 1})`, Math.round(verlies * 100) / 100), formula(`D${n}`, `SUM(D11:D${n - 1})`, Math.round(winst * 100) / 100)]);

  const parts: Record<string, string> = {
    "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/${sheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `${XML}<Relationships xmlns="${PACKAGE}"><Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML}<workbook xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><sheets><sheet name="Winst &amp; verlies" sheetId="1" r:id="rId3"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML}<Relationships xmlns="${PACKAGE}"><Relationship Id="rId1" Type="${RELATIONSHIPS}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${RELATIONSHIPS}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="${RELATIONSHIPS}/worksheet" Target="${sheetPath}"/></Relationships>`,
    [`xl/${sheetPath}`]: `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><dimension ref="A1:D${n}"/><sheetData>${rows.join("")}</sheetData></worksheet>`,
  };
  if (!options.inline) {
    parts["xl/sharedStrings.xml"] = `${XML}<sst xmlns="${MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((value) => `<si><t xml:space="preserve">${escape(value)}</t></si>`)
      .join("")}</sst>`;
  }
  return Object.fromEntries(Object.entries(parts).map(([path, content]) => [path, bytes(content)]));
}
