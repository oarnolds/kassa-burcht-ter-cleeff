// A made-up "Mutaties" export of e-Boekhouden, as the parts of the unzipped .xlsx. Laid out like the real one: the
// vereniging's name and address on top, the export date in A5, the title "Mutaties (n)" in A8, the header in row 10,
// then one row per mutation, newest first: Nr and Bedrag as numbers, Datum as an Excel serial number with a date
// style, the rest as shared strings. Every name, number and amount here is invented.

export type MutRow = {
  nr: number;
  /** `YYYY-MM-DD`. */
  date: string;
  kind: string;
  amount: number;
  account: string;
  /** As e-Boekhouden writes it: one code, or the codes of every line separated by a comma. */
  contra: string;
  invoice?: string;
  document?: string;
};

export type MutOptions = {
  /** The title in A8; by default "Mutaties ({number of rows})". */
  title?: string;
  header?: string[];
  rows?: MutRow[];
  /** Datum as text `dd-mm-jjjj` instead of a serial number. */
  textDates?: boolean;
};

export const MUT_HEADER = ["Nr", "Datum", "Soort", "Bedrag", "Rekening", "Tegenrekening", "Factuur", "Boekstuk"];

type Spec = Omit<MutRow, "nr">;
const out = (date: string, amount: number, contra: string, account = "1010"): Spec => ({ date, kind: "Geld uit", amount, account, contra });
const inn = (date: string, amount: number, contra: string, account = "1010"): Spec => ({ date, kind: "Geld ontv", amount, account, contra });
const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"];

/**
 * A year shaped like the real one (2026, January to 20 November), numbered in date order and listed newest first:
 * - 4308 energy 31,00 on the 20th of every month: "elke maand";
 * - 4310 waste 502,00 in April, July and October: "per kwartaal";
 * - 4507 a one-off 582,00 in October: "één keer";
 * - 4301 rent 1153, 208, 1153, 1182 and 1182 in January, February, April, July and October: "zoals 2026";
 * - 8010,8012 four takings together (500,00 + 692,82 + 1500,00 + 1000,00): a group of two accounts;
 * - 4511,8030 the bank's costs less interest, 3,75 at the end of every quarter: a group, debit;
 * - 4306,4307 one invoice of 45,00: both are 4306 now;
 * - 8004 an invoice sent (Fact verst 1300 → 8004) of 250,00 and its payment (Factbet ontv 1010 → 1300);
 * - 4309 a refund of 12,40 (Geld ontv on a cost account);
 * - 4999 a code no account has (30,00) and 8810 one more (8,00);
 * - two Memoriaal rows, one between balance accounts (ignored) and one with 4601 (skipped);
 * - a transfer between own accounts (ignored).
 */
const SPECS: Spec[] = [
  ...months.map((month) => out(`2026-${month}-20`, 31, "4308")),
  ...["04", "07", "10"].map((month) => out(`2026-${month}-15`, 502, "4310")),
  { ...out("2026-10-28", 582, "4507"), invoice: "F-2026-0042", document: "bon-ehbo.pdf" },
  out("2026-01-02", 1153, "4301"),
  out("2026-02-02", 208, "4301"),
  out("2026-04-02", 1153, "4301"),
  out("2026-07-02", 1182, "4301"),
  out("2026-10-02", 1182, "4301"),
  inn("2026-05-05", 500, "8010,8012"),
  inn("2026-06-06", 692.82, "8010,8012"),
  inn("2026-07-07", 1500, "8010,8012"),
  inn("2026-08-08", 1000, "8010,8012"),
  out("2026-03-31", 3.75, "4511,8030", "1020"),
  out("2026-06-30", 3.75, "4511,8030", "1020"),
  out("2026-09-30", 3.75, "4511,8030", "1020"),
  out("2026-08-01", 45, "4306,4307"),
  { date: "2026-07-15", kind: "Fact verst", amount: 250, account: "1300", contra: "8004", invoice: "2026-07" },
  { date: "2026-07-20", kind: "Factbet ontv", amount: 250, account: "1010", contra: "1300", invoice: "2026-07" },
  inn("2026-09-12", 12.4, "4309"),
  out("2026-04-10", 30, "4999"),
  inn("2026-03-01", 8, "8810"),
  { date: "2026-09-30", kind: "Memoriaal", amount: 75, account: "1080", contra: "1000" },
  { date: "2026-03-31", kind: "Memoriaal", amount: 400, account: "0135", contra: "4601" },
  out("2026-02-14", 500, "1020"),
];

/** The rows of the made-up year, newest first, as the export lists them. */
export const MUT_ROWS: MutRow[] = SPECS.map((spec, i) => ({ spec, i }))
  .sort((a, b) => a.spec.date.localeCompare(b.spec.date) || a.i - b.i)
  .map(({ spec }, i) => ({ nr: 16001 + i, ...spec }))
  .reverse();

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const bytes = (text: string) => new TextEncoder().encode(text);

/** Excel's day number: 1 January 2026 is 46023. */
export const serialOf = (date: string): number => (Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
const dutch = (date: string) => date.split("-").reverse().join("-");

/** The parts of the .xlsx, by their path in the zip. */
export function mutParts(options: MutOptions = {}): Record<string, Uint8Array> {
  const list = options.rows ?? MUT_ROWS;
  const title = options.title ?? `Mutaties (${list.length})`;
  const header = options.header ?? MUT_HEADER;

  const strings: string[] = [];
  const text = (ref: string, value: string) => {
    let index = strings.indexOf(value);
    if (index < 0) index = strings.push(value) - 1;
    return `<c r="${ref}" s="1" t="s"><v>${index}</v></c>`;
  };
  const number = (ref: string, value: number, style = 2) => `<c r="${ref}" s="${style}"><v>${value}</v></c>`;

  const rows: string[] = [];
  const row = (n: number, cells: string[]) => rows.push(`<row r="${n}" spans="1:8">${cells.join("")}</row>`);
  row(1, [text("A1", "Speeltuinvereniging De Voorbeeldtuin")]);
  row(2, [text("A2", "Voorbeeldlaan 1")]);
  row(3, [text("A3", "9999 ZZ Voorbeeld")]);
  row(5, [text("A5", "Datum: 24-11-2026")]);
  row(8, [text("A8", title)]);
  row(10, header.map((name, i) => text(`${"ABCDEFGH"[i]}10`, name)));
  let n = 11;
  for (const line of list) {
    const cells = [
      number(`A${n}`, line.nr, 0),
      options.textDates ? text(`B${n}`, dutch(line.date)) : number(`B${n}`, serialOf(line.date), 3),
      text(`C${n}`, line.kind),
      number(`D${n}`, line.amount),
      text(`E${n}`, line.account),
      text(`F${n}`, line.contra),
    ];
    if (line.invoice) cells.push(text(`G${n}`, line.invoice));
    if (line.document) cells.push(text(`H${n}`, line.document));
    row(n++, cells);
  }

  const parts: Record<string, string> = {
    "[Content_Types].xml": `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `${XML}<Relationships xmlns="${PACKAGE}"><Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${XML}<workbook xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId3"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML}<Relationships xmlns="${PACKAGE}"><Relationship Id="rId1" Type="${RELATIONSHIPS}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${RELATIONSHIPS}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="${RELATIONSHIPS}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><dimension ref="A1:H${n - 1}"/><sheetData>${rows.join("")}</sheetData></worksheet>`,
    "xl/sharedStrings.xml": `${XML}<sst xmlns="${MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${strings
      .map((value) => `<si><t xml:space="preserve">${escape(value)}</t></si>`)
      .join("")}</sst>`,
  };
  return Object.fromEntries(Object.entries(parts).map(([path, content]) => [path, bytes(content)]));
}
