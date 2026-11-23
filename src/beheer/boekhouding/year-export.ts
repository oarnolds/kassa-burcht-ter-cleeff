// The jaaroverzicht as files (spec §13, §15), made in the browser so the Worker stays within its CPU time: the Excel
// workbook and the zip of the attachments. This module and fflate are loaded with import() only when a button on the
// Jaar page is pressed, so neither the kassa nor the other beheer pages carry them.

import { Zip, ZipPassThrough } from "fflate";
import type { AccountKind, Entry, EntryChange, EntryLine, YearChange, YearExport } from "../../../shared/ledger-types";
import { formatAmount } from "../../../shared/money";
import { businessDate, formatDateNl } from "../../../shared/time";
import { CHECK_NAMES, closedAt } from "./year-labels";
import { type Cell, type Sheet, bold, euro, writeXlsx } from "./xlsx";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A moment as the day it was in the Netherlands, dd-mm-jjjj. */
const dayOf = (iso: string) => formatDateNl(businessDate(iso));

/** A file name as it can stand in a zip on any computer: no folders, no characters Windows refuses, never empty. */
function safeName(filename: string): string {
  const safe = filename
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, "_")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 120);
  return safe || "bijlage";
}

/** The name of an entry's `n`th attachment (from 1) in the zip and in the Excel file: `12-1-bon-goodoo.pdf`. */
export const attachmentName = (number: number, n: number, filename: string): string => `${number}-${n}-${safeName(filename)}`;

/** An attachment that could not be fetched: which one, so the page can say so. */
export class AttachmentFetchError extends Error {
  constructor(
    public number: number,
    public filename: string,
  ) {
    super(`attachment ${number}-${filename} not fetched`);
  }
}

/**
 * The attachments of the year in one zip, each named after its entry (`{number}-{n}-{filename}`), stored as they are
 * (a PDF or photo is compressed already). Fetched a few at a time and written in order; `onProgress` counts the
 * entries with attachments that are done.
 */
export async function buildAttachmentsZip(
  entries: Entry[],
  fetchAttachment: (id: string) => Promise<Uint8Array>,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const withFiles = entries.filter((entry) => entry.attachments.length > 0);
  const files = withFiles.flatMap((entry) => entry.attachments.map((attachment, i) => ({ entry, attachment, n: i + 1 })));
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  const fetchOne = ({ entry, attachment }: (typeof files)[number]) =>
    fetchAttachment(attachment.id).catch(() => {
      throw new AttachmentFetchError(entry.number, attachment.filename);
    });

  // Four on their way at a time; each goes into the zip in its turn.
  const AHEAD = 4;
  const pending = files.slice(0, AHEAD).map(fetchOne);
  pending.forEach((promise) => promise.catch(() => {}));
  let done = 0;
  for (let i = 0; i < files.length; i++) {
    const bytes = await pending[i]!;
    if (i + AHEAD < files.length) {
      const next = fetchOne(files[i + AHEAD]!);
      next.catch(() => {});
      pending.push(next);
    }
    const { entry, attachment, n } = files[i]!;
    const file = new ZipPassThrough(attachmentName(entry.number, n, attachment.filename));
    file.mtime = new Date(attachment.uploadedAt);
    zip.add(file);
    file.push(bytes, true);
    if (n === entry.attachments.length) onProgress?.(++done, withFiles.length);
  }
  zip.end();
  return new Blob(chunks as BlobPart[], { type: "application/zip" });
}

// ---- The workbook ----

/** The heading of every sheet: Voorlopig while the year is open (spec §13), else the year and when it was closed. */
function heading(data: YearExport): Cell[][] {
  if (data.status === "open") return [[bold("Voorlopig")], [`Jaaroverzicht ${data.year}, nog niet afgesloten`], []];
  const closed = closedAt(data.status, data.events);
  return [[bold(`Jaaroverzicht ${data.year}`)], closed ? [`Afgesloten op ${dayOf(closed)}`] : [], []];
}

const KIND_TITLES: [title: string, kind: AccountKind][] = [
  ["Bezittingen", "asset"],
  ["Schulden", "liability"],
  ["Eigen vermogen", "equity"],
];

function balanceSheet(data: YearExport): Sheet {
  const begin = new Map(data.opening.rows.map((row) => [row.code, row.cents]));
  const end = new Map(data.closing.rows.map((row) => [row.code, row.cents]));
  const rows: Cell[][] = [...heading(data), [bold("Rekening"), bold("Naam"), bold(formatDateNl(data.opening.date)), bold(formatDateNl(data.closing.date))]];
  for (const [title, kind] of KIND_TITLES) {
    rows.push([bold(title)]);
    for (const account of data.accounts) {
      if (account.kind !== kind || (!begin.has(account.code) && !end.has(account.code))) continue;
      rows.push([account.code, account.name, euro(begin.get(account.code) ?? 0), euro(end.get(account.code) ?? 0)]);
    }
    if (kind === "asset") rows.push([null, bold("Totaal bezittingen"), euro(data.opening.assetsCents, true), euro(data.closing.assetsCents, true)]);
  }
  rows.push([null, "Resultaat nog niet geboekt", euro(data.opening.resultCents), euro(data.closing.resultCents)]);
  rows.push([
    null,
    bold("Totaal schulden en eigen vermogen"),
    euro(data.opening.liabilitiesAndEquityCents + data.opening.resultCents, true),
    euro(data.closing.liabilitiesAndEquityCents + data.closing.resultCents, true),
  ]);
  return { name: "Balans", widths: [10, 44, 16, 16], rows };
}

function resultSheet(data: YearExport): Sheet {
  const { result } = data;
  const rows: Cell[][] = [...heading(data), [bold("Rekening"), bold("Naam"), bold(String(data.year)), bold(String(data.year - 1))]];
  const previous = result.previousResultCents !== null;
  for (const [title, kind] of [
    ["Opbrengsten", "income"],
    ["Kosten", "expense"],
  ] as const) {
    const ofKind = result.rows.filter((row) => row.kind === kind);
    rows.push([bold(title)]);
    for (const row of ofKind) rows.push([row.code, row.name, euro(row.cents), euro(row.previousCents)]);
    const total = ofKind.reduce((sum, row) => sum + row.cents, 0);
    const totalBefore = ofKind.reduce((sum, row) => sum + (row.previousCents ?? 0), 0);
    rows.push([null, bold(`Totaal ${title.toLowerCase()}`), euro(total, true), euro(previous ? totalBefore : null, true)]);
  }
  rows.push([null, bold("Resultaat"), euro(result.resultCents, true), euro(result.previousResultCents, true)]);
  return { name: "Winst en verlies", widths: [10, 44, 16, 16], rows };
}

function entriesSheet(data: YearExport, entries: Entry[], accountName: (code: string) => string): Sheet {
  const rows: Cell[][] = [...heading(data), ["Nummer", "Datum", "Omschrijving", "Rekening", "Bedrag", "Notitie", "Bijlagen"].map(bold)];
  for (const entry of entries) {
    const files = entry.attachments.map((attachment, i) => attachmentName(entry.number, i + 1, attachment.filename)).join(", ");
    const start: Cell[] = [entry.number, formatDateNl(entry.date), entry.description];
    if (entry.lines.length === 0) rows.push([...start, null, null, null, files]);
    entry.lines.forEach((line, i) => rows.push([...start, `${line.accountCode} ${accountName(line.accountCode)}`, euro(line.amountCents), line.note, i === 0 ? files : null]));
  }
  return { name: "Boekingen", widths: [9, 12, 44, 40, 14, 24, 44], rows };
}

/**
 * Per account its lines of the year with a running balance (debit positive, as in Boekingen), the balance at the
 * start first. The year's opening entry is that start, so it is not a line of its own; an income or expense account
 * starts the year at zero.
 */
function ledgerSheet(data: YearExport, entries: Entry[]): Sheet {
  const start = new Map(data.opening.rows.map((row) => [row.code, row.kind === "asset" ? row.cents : 0 - row.cents]));
  const isOpening = (entry: Entry) => entry.source === "opening" && entry.sourceRef === String(data.year);
  const linesOf = new Map<string, { entry: Entry; line: EntryLine }[]>();
  for (const entry of entries) {
    if (isOpening(entry)) continue;
    for (const line of entry.lines) linesOf.set(line.accountCode, [...(linesOf.get(line.accountCode) ?? []), { entry, line }]);
  }
  const rows: Cell[][] = [...heading(data), ["Datum", "Nummer", "Omschrijving", "Bedrag", "Saldo"].map(bold)];
  for (const account of data.accounts) {
    const lines = (linesOf.get(account.code) ?? []).sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.number - b.entry.number);
    let balance = start.get(account.code) ?? 0;
    if (balance === 0 && lines.length === 0) continue;
    rows.push([bold(`${account.code} ${account.name}`)]);
    rows.push([formatDateNl(data.opening.date), null, "Beginbalans", null, euro(balance)]);
    for (const { entry, line } of lines) {
      balance += line.amountCents;
      rows.push([formatDateNl(entry.date), entry.number, entry.description, euro(line.amountCents), euro(balance)]);
    }
    rows.push([]);
  }
  return { name: "Grootboek", widths: [12, 9, 44, 14, 14], rows };
}

function assetsSheet(data: YearExport): Sheet {
  const rows: Cell[][] = [
    ...heading(data),
    ["Naam", "Aanschafdatum", "Aanschafwaarde", "Restwaarde", "Levensduur (jaren)", "Afgeschreven", "Boekwaarde", "Afgevoerd op"].map(bold),
  ];
  for (const asset of data.assets) {
    rows.push([
      asset.name,
      asset.purchaseDate === null ? null : formatDateNl(asset.purchaseDate),
      euro(asset.costCents),
      euro(asset.residualCents),
      asset.lifeYears,
      euro(asset.writtenOffCents),
      euro(asset.bookValueCents),
      asset.disposedOn === null ? null : formatDateNl(asset.disposedOn),
    ]);
  }
  const plan = data.depreciation;
  rows.push([], [bold(`Afschrijving ${plan.year}`)]);
  for (const row of plan.rows) rows.push([row.name, euro(row.cents)]);
  if (plan.rows.length > 0) rows.push([bold("Totaal"), euro(plan.totalCents, true)]);
  rows.push([
    !plan.booked
      ? plan.rows.length === 0
        ? "Niets af te schrijven"
        : "Nog niet geboekt"
      : plan.upToDate
        ? "Geboekt"
        : "Geboekt, maar de bedragen zijn sindsdien veranderd",
  ]);
  return { name: "Speeltoestellen", widths: [36, 14, 16, 14, 18, 16, 16, 14], rows };
}

function checksSheet(data: YearExport): Sheet {
  const rows: Cell[][] = [...heading(data), ["Controle", "Uitkomst", "Gevonden"].map(bold)];
  for (const check of data.checks) rows.push([CHECK_NAMES[check.key], check.ok ? "ok" : "niet ok", check.detail]);
  rows.push([], [bold("Afsluiten en heropenen")]);
  if (data.events.length === 0) rows.push([`${data.year} is nog niet afgesloten`]);
  else rows.push(["Datum", "Wat", "Toelichting"].map(bold));
  for (const event of data.events) rows.push([dayOf(event.at), event.kind === "closed" ? "Afgesloten" : "Heropend", event.note]);
  return { name: "Controles", widths: [44, 12, 90], rows };
}

/** What an entry held at a moment, on one line: `01-03-2027 Factuur Goodoo: 4514 25,00 (schroeven); 1010 -25,00`. */
function described(content: EntryChange["after"] | null): string | null {
  if (content === null) return null;
  const lines = content.lines.map((line) => `${line.accountCode} ${formatAmount(line.amountCents)}${line.note ? ` (${line.note})` : ""}`).join("; ");
  return `${formatDateNl(content.date)} ${content.description}: ${lines || "leeg"}`;
}

function changesSheet(data: YearExport, changes: YearChange[]): Sheet {
  const rows: Cell[][] = [...heading(data), ["Datum", "Boeking", "Wat ervoor stond", "Wat erna", "Notitie"].map(bold)];
  for (const change of changes) rows.push([dayOf(change.at), change.number, described(change.before), described(change.after), change.note]);
  if (changes.length === 0) rows.push(["Geen wijzigingen"]);
  return { name: "Wijzigingen", widths: [12, 9, 60, 60, 30], rows };
}

/**
 * The jaaroverzicht as an Excel file (spec §13): the balance at the start and the end, the result next to the year
 * before, every entry with its number, per account its lines, the toestellen, the checks with the closing and
 * reopening, and the changes. An open year says Voorlopig at the top of every sheet.
 */
export async function buildWorkbook(data: YearExport, entries: Entry[], changes: YearChange[]): Promise<Blob> {
  const names = new Map(data.accounts.map((account) => [account.code, account.name]));
  const byNumber = [...entries].sort((a, b) => a.number - b.number);
  const sheets = [
    balanceSheet(data),
    resultSheet(data),
    entriesSheet(data, byNumber, (code) => names.get(code) ?? ""),
    ledgerSheet(data, byNumber),
    assetsSheet(data),
    checksSheet(data),
    changesSheet(data, changes),
  ];
  return new Blob([writeXlsx(sheets) as BlobPart], { type: XLSX_TYPE });
}

