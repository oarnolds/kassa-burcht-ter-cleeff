// What the boekhouding has to say when something needs attention, for its own Overzicht and for beheer's first
// page. Small on purpose: beheer's first page loads it, the boekhouding's pages themselves load later (R38).

import type { NightlyReport, NightlyStep } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { businessDate, localTime } from "../../../shared/time";
import { today } from "../parts";

const STEP_NAMES: Record<NightlyStep, string> = { kassa: "Kassa", ing: "ING", mollie: "Mollie" };

/** An ISO moment as its day in Amsterdam, d-m-jjjj: "5-3-2027". */
export function dayOf(iso: string): string {
  const [year, month, day] = businessDate(iso).split("-");
  return `${Number(day)}-${Number(month)}-${year}`;
}

/** A run between midnight and six this morning: the nightly one. */
export const ranTonight = (report: NightlyReport): boolean => businessDate(report.at) === today() && localTime(report.at) < "06:00";

/** "ING is vannacht niet gelukt: ing_cut_short", for each step of the last run that failed, in the order they run. */
export function failedSteps(report: NightlyReport | null): string[] {
  if (!report) return [];
  const when = ranTonight(report) ? "vannacht" : `op ${dayOf(report.at)} om ${localTime(report.at)}`;
  return (Object.keys(STEP_NAMES) as NightlyStep[]).flatMap((step) => {
    const outcome = report.steps[step];
    return outcome === undefined || outcome === "ok" || outcome === "skipped" ? [] : [`${STEP_NAMES[step]} is ${when} niet gelukt: ${outcome}`];
  });
}

/** The nightly run stopped happening. */
export const notUpdatedText = (since: string): string => `De boekhouding is sinds ${dayOf(since)} ${localTime(since)} niet bijgewerkt`;

/** The kluisje in the books against what the kassa says belongs in it. */
export const cashText = (cents: number): string => `Kas wijkt ${formatEuro(Math.abs(cents))} af van wat er volgens de kassa in het kluisje hoort`;

/** The auditfile of e-Boekhouden is not read in yet, so the app books nothing by itself. */
export const waitingText = "Lees eerst 2026 in uit e-Boekhouden (Instellingen → Eenmalig). Tot dan boekt de app niets zelf.";

/** Every warning of the overview beyond the lines to book, the balances and ING's consent, in that order. */
export function ledgerAlerts(o: { eboekhoudenDone: boolean; lastNightly: NightlyReport | null; notUpdatedSince: string | null; cashDifferenceCents: number }): string[] {
  return [
    ...(o.eboekhoudenDone ? [] : [waitingText]),
    ...failedSteps(o.lastNightly),
    ...(o.notUpdatedSince ? [notUpdatedText(o.notUpdatedSince)] : []),
    ...(o.cashDifferenceCents !== 0 ? [cashText(o.cashDifferenceCents)] : []),
  ];
}
