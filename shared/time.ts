// Timestamps are stored as UTC ISO strings. Days and months follow Dutch time.

const ZONE = "Europe/Amsterdam";

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parts(iso: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of partsFormat.formatToParts(new Date(iso))) out[part.type] = part.value;
  return out;
}

/** The Amsterdam calendar day of a moment, as `YYYY-MM-DD`. */
export function businessDate(iso: string): string {
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The Amsterdam wall-clock time of a moment, as `HH:MM`. */
export function localTime(iso: string): string {
  const p = parts(iso);
  return `${p.hour}:${p.minute}`;
}

/** `YYYY-MM` of a `YYYY-MM-DD` date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** First and last day of a `YYYY-MM` month. */
export function monthRange(month: string): { first: string; last: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** `DD-MM-YYYY` of a `YYYY-MM-DD` date. */
export function formatDateNl(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}-${month}-${year}`;
}
