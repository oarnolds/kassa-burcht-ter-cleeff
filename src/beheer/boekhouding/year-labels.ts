// Words and dates the Jaar page, its afdruk and the Excel file share. Small on purpose: the Excel code itself is
// loaded only when its button is pressed.

import type { YearCheck } from "../../../shared/ledger-types";
import { businessDate } from "../../../shared/time";

/** What each check looks at; the Worker says what it found. */
export const CHECK_NAMES: Record<YearCheck["key"], string> = {
  bank_lines: "Alle bankregels geboekt",
  bank_balances: "Saldo's gelijk aan de bank",
  cash: "Kas gelijk aan de kassa",
  mollie: "Mollie gelijk aan het saldo bij Mollie",
  depreciation: "Afschrijving geboekt",
  in_transit: "Kruisposten (1080) op nul",
  assets: "0130 en 0135 gelijk aan de lijst toestellen",
};

/** `d-m-jjjj` of a `YYYY-MM-DD` day: 15-1-2028. */
export const dayMonthYear = (date: string): string => {
  const [year, month, day] = date.split("-");
  return `${Number(day)}-${Number(month)}-${year}`;
};

/** The day of a moment in the Netherlands, as d-m-jjjj. */
export const dayOf = (iso: string): string => dayMonthYear(businessDate(iso));

/** The moment a year was last closed, from its closing and reopening; null while it is open. */
export const closedAt = (status: "open" | "closed", events: { at: string; kind: "closed" | "reopened" }[]): string | null =>
  status === "closed" ? (events.findLast((event) => event.kind === "closed")?.at ?? null) : null;
