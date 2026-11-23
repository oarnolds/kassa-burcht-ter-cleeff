import { CamtError, parseCamt053, type CamtStatement } from "../../../shared/camt";

/** The most lines one request may carry; the Worker refuses more. */
export const MAX_LINES = 2000;

/**
 * A statement as one or more requests of at most `max` lines. A day is never split over two requests; only the
 * first request carries the opening balance and only the last the closing balance.
 */
export function chunkStatement(statement: CamtStatement, max = MAX_LINES): CamtStatement[] {
  if (statement.lines.length <= max) return [statement];
  const days = new Map<string, CamtStatement["lines"]>();
  for (const line of statement.lines) days.set(line.bookingDate, [...(days.get(line.bookingDate) ?? []), line]);
  const groups: CamtStatement["lines"][] = [];
  for (const date of [...days.keys()].sort()) {
    const day = days.get(date)!;
    const last = groups.at(-1);
    if (last && last.length + day.length <= max) last.push(...day);
    else groups.push([...day]);
  }
  return groups.map((lines, index) => ({
    account: statement.account,
    opening: index === 0 ? statement.opening : null,
    closing: index === groups.length - 1 ? statement.closing : null,
    lines,
  }));
}

/** The text of a file the person picked. */
export function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** The statements in a CAMT.053 file, or why they cannot be read. */
export async function readStatements(file: File): Promise<{ ok: true; statements: CamtStatement[] } | { ok: false }> {
  try {
    return { ok: true, statements: parseCamt053(await readText(file)) };
  } catch (error) {
    if (error instanceof CamtError || error instanceof DOMException) return { ok: false };
    throw error;
  }
}
