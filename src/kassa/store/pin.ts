// A pin payment as the iPad sees it. The server starts it at Mollie; the iPad asks every second how it
// stands. A receipt stays on the iPad for as long as the kassa is not done with it, so that a payment whose
// outcome could not be learned (no connection, a closed kassa) is found again and never silently lost.

import type { PinSaleInput } from "../../../shared/schemas";
import type { PinOutcome, PinStatus } from "../../../shared/types";
import { kassaApi, type ApiResult } from "../../lib/api";
import { getMeta, getPinDb } from "./db";

export const POLL_MS = 1000; // spec §11: the iPad asks every second
export const POLL_TIMEOUT_MS = 5000; // one question may take this long
export const LOST_MS = 10_000; // no answer for this long: the outcome is unknown
export const WAIT_LIMIT_MS = 120_000; // still running after this long: the outcome is unknown
export const UNSENT_MS = 20_000; // the server answers, but its start has not reached Mollie after this long

/** A receipt being paid by pin, as it is sent to the server. */
export type PinReceipt = PinSaleInput;

/**
 * A receipt the kassa is not done with. `parked`: the outcome of its payment is not known yet.
 * `failed`: the payment did not go through and the beheerder has not seen that yet.
 * `cashTaken`: the beheerder rang it up as cash in the meantime.
 */
export type Parked = PinReceipt & { parked: boolean; failed: boolean; cashTaken: boolean };

export type PinEnd =
  | { kind: "paid" }
  | { kind: "failed"; outcome: Exclude<PinOutcome, "paid">; reason: string | null }
  // lost: no answer from the server for a while. unsent: the server answers, but its start does not reach Mollie.
  // slow: the payment is on the terminal, but has no outcome yet.
  | { kind: "unknown"; why: "lost" | "unsent" | "slow" };

export type PinProgress = { sent: boolean; testUrl: string | null; cancelFailed: boolean };
export type PinRun = { done: Promise<PinEnd>; cancel(): void };

const STORE = "pin";

/** Changes one stored receipt in a single step; a receipt that is not there stays away. */
async function change(id: string, patch: Partial<Parked>): Promise<void> {
  const tx = (await getPinDb()).transaction(STORE, "readwrite");
  const row = (await tx.store.get(id)) as Parked | undefined;
  if (row) await tx.store.put({ ...row, ...patch });
  await tx.done;
}

async function forget(id: string): Promise<void> {
  await (await getPinDb()).delete(STORE, id);
}

function ask(path: string, token: string, more: { method?: string; json?: unknown; timeoutMs: number }): Promise<ApiResult<PinStatus>> {
  return kassaApi<PinStatus>(path, token, more);
}

/** Starts the payment and follows it to its end. The receipt is kept on the iPad for as long as its outcome is not known. */
export function runPin(receipt: PinReceipt, onProgress: (progress: PinProgress) => void): PinRun {
  const statusPath = `/api/kassa/pin/${encodeURIComponent(receipt.id)}`;
  let answered = false; // the server has answered the start: from now on it knows this sale
  let cancelWanted = false;
  let cancelAnswered = false;
  let wake: (() => void) | null = null;

  const cancelPending = () => answered && cancelWanted && !cancelAnswered;

  /** Waits a second, or less when the beheerder cancels in the meantime. */
  const pause = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, POLL_MS);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    }).finally(() => {
      wake = null;
    });

  async function follow(): Promise<PinEnd> {
    // Stored first: should the kassa be closed while the customer pays, the next start finds this receipt.
    // A full or broken storage does not stop the payment.
    try {
      await (await getPinDb()).put(STORE, { ...receipt, parked: false, failed: false, cashTaken: false } satisfies Parked);
    } catch {
      // go on without it
    }
    const token = await getMeta<string>("deviceToken").catch(() => undefined);
    if (!token) return { kind: "failed", outcome: "start_failed", reason: "unauthorized" };

    const started = Date.now();
    let lastAnswer = started;
    let cancelFailed = false;
    let everSent = false;
    for (;;) {
      const cancelling = cancelPending();
      const answer = cancelling
        ? await ask(`${statusPath}/cancel`, token, { method: "POST", timeoutMs: POLL_TIMEOUT_MS })
        : answered
          ? await ask(statusPath, token, { timeoutMs: POLL_TIMEOUT_MS })
          : // The same start again for as long as it had no answer: the server takes the same id only once.
            await ask("/api/kassa/pin", token, { method: "POST", json: receipt, timeoutMs: LOST_MS });

      if (answer.ok) {
        answered = true;
        lastAnswer = Date.now();
        const { outcome, reason, sent, testUrl } = answer.data;
        if (sent) everSent = true;
        if (outcome === "paid") return { kind: "paid" };
        if (outcome !== null) return { kind: "failed", outcome, reason };
        if (cancelling) {
          // The server asked Mollie, and the payment is still running: it could not be cancelled any more.
          cancelAnswered = true;
          cancelFailed = true;
        }
        onProgress({ sent, testUrl, cancelFailed });
      } else if (!answered && answer.status >= 400 && answer.status < 500) {
        // The server refused the start: nothing was started.
        return { kind: "failed", outcome: "start_failed", reason: answer.error };
      }
      // Anything else is no answer: no connection, a server in trouble, or a server that no longer knows us.
      const now = Date.now();
      if (now - lastAnswer >= LOST_MS) return { kind: "unknown", why: "lost" };
      // The beheerder cannot cancel a start that has not reached Mollie: park it, so that cash is one tap away.
      if (answered && !everSent && now - started >= UNSENT_MS) return { kind: "unknown", why: "unsent" };
      if (now - started >= WAIT_LIMIT_MS) return { kind: "unknown", why: "slow" };
      // A cancel asked for while this round was under way goes out at once. One that got no answer waits
      // a second, like any other question.
      if (cancelPending() && !cancelling) continue;
      await pause();
    }
  }

  const done = follow().then(async (end) => {
    try {
      if (end.kind === "unknown") await change(receipt.id, { parked: true });
      else await forget(receipt.id);
    } catch {
      // The outcome stands, whatever the storage does.
    }
    return end;
  });

  return {
    done,
    cancel() {
      // Before the server knows the sale there is nothing to cancel there.
      if (!answered || cancelWanted) return;
      cancelWanted = true;
      wake?.();
    },
  };
}

/** The receipts that are parked or failed, oldest first. */
export async function listParked(): Promise<Parked[]> {
  const rows = (await (await getPinDb()).getAll(STORE)) as Parked[];
  return rows.filter((row) => row.parked || row.failed).sort((a, b) => a.soldAt.localeCompare(b.soldAt));
}

/** On start: every receipt that is neither parked nor failed belonged to a kassa that was closed while it waited. They are parked. */
export async function parkLeftovers(): Promise<void> {
  const tx = (await getPinDb()).transaction(STORE, "readwrite");
  for (const row of (await tx.store.getAll()) as Parked[]) {
    if (!row.parked && !row.failed) await tx.store.put({ ...row, parked: true });
  }
  await tx.done;
}

export async function markCashTaken(id: string): Promise<void> {
  await change(id, { cashTaken: true });
}

/** The beheerder has seen that this payment did not go through: the receipt is forgotten. */
export async function dismissFailed(id: string): Promise<void> {
  await forget(id);
}

let resolving: Promise<{ paid: Parked[]; failed: Parked[] }> | null = null;

/**
 * Asks the server about every parked receipt. `paid`: forgotten. `failed`: kept as failed until `dismissFailed`.
 * A call made while a round is running joins that round, so that no outcome is reported twice.
 */
export function resolveParked(): Promise<{ paid: Parked[]; failed: Parked[] }> {
  resolving ??= resolve().finally(() => {
    resolving = null;
  });
  return resolving;
}

async function resolve(): Promise<{ paid: Parked[]; failed: Parked[] }> {
  const paid: Parked[] = [];
  const failed: Parked[] = [];
  const waiting = (await listParked()).filter((row) => row.parked);
  if (waiting.length === 0) return { paid, failed };
  const token = await getMeta<string>("deviceToken");
  if (!token) return { paid, failed };
  for (const row of waiting) {
    const answer = await ask(`/api/kassa/pin/${encodeURIComponent(row.id)}`, token, { timeoutMs: POLL_TIMEOUT_MS });
    if (answer.ok && answer.data.outcome === "paid") {
      await forget(row.id);
      paid.push(row);
    } else if ((answer.ok && answer.data.outcome !== null) || (!answer.ok && answer.status === 404 && answer.error === "no_pin_sale")) {
      // It did not go through, or the server never got the start. With cash taken the customer has paid: nothing to tell.
      if (row.cashTaken) {
        await forget(row.id);
      } else {
        const seen: Parked = { ...row, parked: false, failed: true };
        await change(row.id, { parked: false, failed: true });
        failed.push(seen);
      }
    }
    // Still running, or no answer: it stays parked and is asked about again.
  }
  return { paid, failed };
}
