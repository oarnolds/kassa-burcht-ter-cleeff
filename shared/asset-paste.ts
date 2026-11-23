// Reading the overview "Vaste activa {jaar}" that the penningmeester copies from e-Boekhouden (spec §12, De start).
// Runs in the browser, so he sees what was read before anything is sent.

import { parseEuro } from "./money";

export type PastedAsset = { name: string; purchaseDate: string; costCents: number; writtenOffCents: number; lifeYears: number };

/** The columns read, counted from 0: name, purchase date, cost per 31-12, written off up to and including 31-12, years. */
const NAME = 0;
const PURCHASED = 1;
const COST = 4;
const WRITTEN_OFF = 9;
const YEARS = 11;

/** The life in years the app accepts, as for a toestel made in beheer. */
export const MAX_LIFE_YEARS = 50;

/** `d-m-jjjj` as `YYYY-MM-DD`, or null when it is not a day that exists. */
function readDate(text: string): string | null {
  const match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text);
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** "1.234,56", "€ 1.234,56" or "-1.234,56" in cents, or null. */
function readAmount(text: string): number | null {
  const cleaned = text.replace(/[€\s]/g, "");
  const negative = /^[-−]/.test(cleaned);
  const cents = parseEuro(negative ? cleaned.slice(1) : cleaned);
  return cents === null ? null : negative ? -cents : cents;
}

/** A whole number of years from 1 to MAX_LIFE_YEARS, or null. Also for what is typed in beheer. */
export function readLifeYears(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const years = Number(trimmed);
  return years >= 1 && years <= MAX_LIFE_YEARS ? years : null;
}

/** Tabs between the columns, as e-Boekhouden copies them; without a tab, two or more spaces. */
const cellsOf = (line: string): string[] => (line.includes("\t") ? line.split("\t") : line.trim().split(/[ \u00a0]{2,}/)).map((cell) => cell.trim());

function readRow(line: string): PastedAsset | null {
  const cells = cellsOf(line);
  const name = cells[NAME] ?? "";
  const purchaseDate = readDate(cells[PURCHASED] ?? "");
  const costCents = readAmount(cells[COST] ?? "");
  const writtenOff = readAmount(cells[WRITTEN_OFF] ?? "");
  const lifeYears = readLifeYears(cells[YEARS] ?? "");
  if (name === "" || purchaseDate === null || costCents === null || costCents < 0 || writtenOff === null || lifeYears === null) return null;
  // e-Boekhouden may show what was written off as a minus; it is always the part of the cost that is gone.
  return { name, purchaseDate, costCents, writtenOffCents: Math.abs(writtenOff), lifeYears };
}

/** The table "Vaste activa {jaar}" copied from e-Boekhouden: tab-separated, dates d-m-jjjj, amounts 1.234,56. Header, group and total rows are skipped. */
export function parseAssetPaste(text: string): { assets: PastedAsset[]; skipped: string[] } {
  const assets: PastedAsset[] = [];
  const skipped: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const asset = readRow(line);
    if (asset) assets.push(asset);
    else skipped.push(line.trimEnd());
  }
  return { assets, skipped };
}
