// All amounts are integer cents. Display uses the Dutch notation.

const NBSP = String.fromCharCode(0xa0);

function split(cents: number): { negative: boolean; euros: number; rest: string } {
  const abs = Math.abs(Math.round(cents));
  return { negative: cents < 0, euros: Math.floor(abs / 100), rest: String(abs % 100).padStart(2, "0") };
}

function grouped(euros: number): string {
  return String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** `€ 1.234,56`, with a non-breaking space; a negative amount is `-€ 3,60`. */
export function formatEuro(cents: number): string {
  const { negative, euros, rest } = split(cents);
  return `${negative ? "-" : ""}€${NBSP}${grouped(euros)},${rest}`;
}

/** Like formatEuro, but a whole amount loses its cents: `€ 10`. */
export function formatEuroShort(cents: number): string {
  const { negative, euros, rest } = split(cents);
  const tail = rest === "00" ? "" : `,${rest}`;
  return `${negative ? "-" : ""}€${NBSP}${grouped(euros)}${tail}`;
}

/** A bare amount for CSV files: `12,30`, no euro sign, no thousands separator. */
export function formatAmount(cents: number): string {
  const { negative, euros, rest } = split(cents);
  return `${negative ? "-" : ""}${euros},${rest}`;
}

/**
 * Reads what a person types as an amount and returns cents, or null when it is not an amount.
 * A comma or a dot is the decimal sign (at most two decimals). A dot groups thousands only
 * when a decimal comma follows it.
 */
export function parseEuro(text: string): number | null {
  const cleaned = text.replace(/[€\s]/g, "");
  let euros: string;
  let decimals = "";
  let match: RegExpExecArray | null;
  if ((match = /^(\d{1,3}(?:\.\d{3})+),(\d{1,2})$/.exec(cleaned))) {
    euros = match[1].replace(/\./g, "");
    decimals = match[2];
  } else if ((match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(cleaned))) {
    euros = match[1];
    decimals = match[2] ?? "";
  } else {
    return null;
  }
  const cents = Number(euros) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}
