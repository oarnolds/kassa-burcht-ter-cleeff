import type { NightlyReport, NightlyStep } from "../shared/ledger-types";
import type { Env } from "./env";
import { fetchIng } from "./db/bank-consent";
import { syncKassa } from "./db/kassa-ledger";
import { LedgerError } from "./db/ledger";
import { setLedgerSetting } from "./db/ledger-settings";
import { syncMolliePayments, syncSettlements } from "./db/mollie-ledger";

/** In `ledger_settings`: how the last run went, as JSON. */
export const NIGHTLY_KEY = "ledger_nightly_last";

/** A step answers "ok" or "skipped", or the code of what went wrong (or throws). */
export type StepRunner = (env: Env, now: Date) => Promise<"ok" | "skipped" | string>;

const ORDER: NightlyStep[] = ["kassa", "ing", "mollie"];

/** Mollie's payments, then its payouts (which books a payout line on ING that waited): the first failure, else ok. */
async function mollie(env: Env, now: Date): Promise<"ok" | "skipped" | string> {
  const outcomes = [await syncMolliePayments(env, now), await syncSettlements(env, now)];
  return outcomes.find((outcome) => outcome !== "ok" && outcome !== "skipped") ?? (outcomes.includes("ok") ? "ok" : "skipped");
}

/** The steps of the nightly run. */
const STEPS: Record<NightlyStep, StepRunner> = {
  kassa: async (env, now) => {
    await syncKassa(env.DB, now);
    return "ok";
  },
  ing: fetchIng,
  mollie,
};

/**
 * Brings the boekhouding up to date: each step on its own, so that one failing leaves the others running.
 * A refusal of the ledger gives its code, any other failure "error" (the message goes to the log, never a secret).
 * How it went is stored in `ledger_settings` and returned.
 */
export async function runNightly(env: Env, now: Date, steps: Record<NightlyStep, StepRunner> = STEPS): Promise<NightlyReport> {
  const report: NightlyReport = { at: now.toISOString(), steps: {} };
  for (const step of ORDER) {
    try {
      report.steps[step] = await steps[step](env, now);
    } catch (error) {
      report.steps[step] = error instanceof LedgerError ? error.code : "error";
      console.error(`nightly step ${step} failed:`, error instanceof Error ? error.message : "unknown error");
    }
  }
  await setLedgerSetting(env.DB, NIGHTLY_KEY, JSON.stringify(report), now);
  return report;
}
