// A small writer of Excel files (.xlsx): SpreadsheetML in a zip, with text written into each cell (inline strings),
// amounts as numbers in euros with the format #,##0.00, and bold for headings. Enough for the jaaroverzicht, and
// readable without the app. Loaded only with the Excel button (see year-export.ts).

import { strToU8, zipSync } from "fflate";

/**
 * A cell: text, a plain number (an entry's number, years), an amount in cents, or nothing. `bold` for headings and
 * totals.
 */
export type Cell = string | number | null | { text: string; bold: true } | { cents: number; bold?: boolean };
export type Sheet = { name: string; widths: number[]; rows: Cell[][] };

export const bold = (text: string): Cell => ({ text, bold: true });
export const euro = (cents: number | null, isBold = false): Cell => (cents === null ? null : { cents, bold: isBold });

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** The styles a cell can have; their order is that of `cellXfs` below. */
const STYLE = { plain: 0, bold: 1, amount: 2, boldAmount: 3 } as const;
const AMOUNT_FORMAT = 164; // the first id free for an own number format

const STYLES = `${XML}<styleSheet xmlns="${MAIN}">
<numFmts count="1"><numFmt numFmtId="${AMOUNT_FORMAT}" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="${AMOUNT_FORMAT}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="${AMOUNT_FORMAT}" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Text as XML allows it: the five special characters escaped, control characters (not allowed in XML) left out. */
function escape(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** A, B, …, Z, AA, AB, … for column 0, 1, … */
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Cents as euros with two decimals, written exactly: 949600 → 9496.00, -5 → -0.05. */
function euros(cents: number): string {
  const whole = Math.abs(Math.round(cents));
  return `${cents < 0 ? "-" : ""}${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, "0")}`;
}

function cellXml(cell: Cell, ref: string): string {
  if (cell === null) return "";
  if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
  if (typeof cell === "string") return cell === "" ? "" : inline(ref, cell, STYLE.plain);
  if ("text" in cell) return inline(ref, cell.text, STYLE.bold);
  return `<c r="${ref}" s="${cell.bold ? STYLE.boldAmount : STYLE.amount}"><v>${euros(cell.cents)}</v></c>`;
}

const inline = (ref: string, text: string, style: number) =>
  `<c r="${ref}"${style === STYLE.plain ? "" : ` s="${style}"`} t="inlineStr"><is><t xml:space="preserve">${escape(text)}</t></is></c>`;

function sheetXml(sheet: Sheet): string {
  const cols = sheet.widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join("");
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row.map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`)).join("");
      return cells === "" ? "" : `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `${XML}<worksheet xmlns="${MAIN}"><sheetFormatPr defaultRowHeight="15"/>${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${rows}</sheetData></worksheet>`;
}

/** The workbook as the bytes of an .xlsx file, its sheets in this order. */
export function writeXlsx(sheets: Sheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join("") +
        "</Types>",
    ),
    "_rels/.rels": strToU8(
      `${XML}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}"><Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `${XML}<workbook xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><sheets>` +
        sheets.map((sheet, i) => `<sheet name="${escape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        "</sheets></workbook>",
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `${XML}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${RELATIONSHIPS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="${RELATIONSHIPS}/styles" Target="styles.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(STYLES),
  };
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet));
  });
  return zipSync(files);
}
