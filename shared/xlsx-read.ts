// Reading an Excel file (.xlsx) that e-Boekhouden exports, from the parts of the unzipped file (the caller unzips
// it): the first sheet as rows of cells. Both readers of e-Boekhouden's exports use this (the winst-en-verliesrekening
// and the mutaties). DOMParser is only touched when a part is read, so the Worker typecheck can include this file.

// The Worker typecheck has no DOM library, so the few DOM members used here are described by hand.
type El = {
  localName: string;
  textContent: string | null;
  parentElement: El | null;
  children: ArrayLike<El>;
  getAttribute(name: string): string | null;
  getAttributeNS(ns: string, name: string): string | null;
  getElementsByTagNameNS(ns: string, name: string): ArrayLike<El>;
};
type XmlDoc = { documentElement: El | null; getElementsByTagName(name: string): ArrayLike<unknown> };

/** A sheet, ready to be read into rows. */
export type SheetXml = { sheet: El; strings: string[] };

/** What a cell holds: text, or the number it stores. */
export type Value = string | number;

const RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** The root element of an XML part, or null when the part is missing or not XML. */
function part(files: Record<string, Uint8Array>, path: string): El | null {
  const bytes = files[path];
  if (!bytes) return null;
  const Parser = (globalThis as unknown as { DOMParser: new () => { parseFromString(s: string, type: string): XmlDoc } }).DOMParser;
  const doc = new Parser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  return doc.documentElement;
}

const all = (el: El, name: string): El[] => Array.from(el.getElementsByTagNameNS("*", name));
const childrenNamed = (el: El, name: string): El[] => Array.from(el.children).filter((child) => child.localName === name);

/** The text of a string item (`si` or `is`): its runs joined, the phonetic hints (`rPh`) left out. */
const runsOf = (el: El): string =>
  all(el, "t")
    .filter((t) => t.parentElement?.localName !== "rPh")
    .map((t) => t.textContent ?? "")
    .join("");

/** `worksheets/sheet1.xml` from `xl/workbook.xml` lies at `xl/worksheets/sheet1.xml`; `/xl/…` is from the root. */
const resolve = (target: string): string => (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);

/** Column A is 0, B is 1, …; null without letters. */
function columnOf(ref: string | null): number | null {
  const letters = ref === null ? null : /^([A-Z]+)/i.exec(ref);
  if (!letters) return null;
  let index = 0;
  for (const letter of letters[1]!.toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** What a cell holds: text, or the number it stores. Formulas, errors and booleans are left out. */
function valueOf(cell: El, strings: string[]): Value | null {
  if (childrenNamed(cell, "f").length > 0) return null;
  const v = childrenNamed(cell, "v")[0]?.textContent ?? null;
  switch (cell.getAttribute("t")) {
    case "s":
      return v === null ? null : (strings[Number(v)] ?? null);
    case "inlineStr": {
      const is = childrenNamed(cell, "is")[0];
      return is ? runsOf(is) : null;
    }
    case "str":
      return v;
    case "b":
    case "e":
      return null;
    default:
      return v === null || v.trim() === "" ? null : Number(v);
  }
}

/** The sheet as rows of cells by column, in the order of the sheet. */
export function grid({ sheet, strings }: SheetXml): Map<number, Value>[] {
  const rows: Map<number, Value>[] = [];
  for (const row of all(sheet, "row")) {
    const cells = new Map<number, Value>();
    let column = -1;
    for (const cell of childrenNamed(row, "c")) {
      column = columnOf(cell.getAttribute("r")) ?? column + 1;
      const value = valueOf(cell, strings);
      if (value !== null) cells.set(column, value);
    }
    rows.push(cells);
  }
  return rows;
}

/** A cell as trimmed text; an empty cell is "". */
export const textOf = (value: Value | undefined): string => (value === undefined ? "" : String(value).trim());

/** The first sheet of the workbook, through the workbook's relationships; null when the file is not a workbook. */
export function firstSheet(files: Record<string, Uint8Array>): SheetXml | null {
  const workbook = part(files, "xl/workbook.xml");
  const rels = part(files, "xl/_rels/workbook.xml.rels");
  const first = workbook ? all(workbook, "sheet")[0] : undefined;
  if (!rels || !first) return null;
  const id = first.getAttributeNS(RELATIONSHIPS, "id") ?? first.getAttribute("r:id");
  const relations = all(rels, "Relationship");
  const target = relations.find((relation) => relation.getAttribute("Id") === id)?.getAttribute("Target");
  const sheet = target ? part(files, resolve(target)) : null;
  if (!sheet) return null;
  const sharedTarget = relations.find((relation) => (relation.getAttribute("Type") ?? "").endsWith("/sharedStrings"))?.getAttribute("Target");
  const shared = part(files, sharedTarget ? resolve(sharedTarget) : "xl/sharedStrings.xml");
  return { sheet, strings: shared ? all(shared, "si").map(runsOf) : [] };
}
