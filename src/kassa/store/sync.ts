// Keeps the iPad and the server in step: sends waiting sales and fetches the assortment.

import type { OutboxItem } from "../../../shared/schemas";
import type { Catalog, ItemResult } from "../../../shared/types";
import { kassaApi } from "../../lib/api";
import { saveCatalog } from "./catalog";
import { getMeta } from "./db";
import { flush, pendingCount, rejectedCount, type SendResult } from "./outbox";

export type SyncState = { online: boolean; pending: number; rejected: number; paired: boolean };

const EVERY_MS = 30_000;

/**
 * Starts the background work. It sends on `kick()`, when the connection comes back and every 30 seconds.
 * It fetches the catalog every 30 seconds, after sending and when the page becomes visible — but only while
 * nothing is waiting, so that the stock on the tiles counts every sale exactly once.
 * A 401 means this iPad was unpaired: it stops calling, and what is waiting stays.
 */
export function startSync(onState: (state: SyncState) => void, onCatalog: (catalog: Catalog) => void): { stop(): void; kick(): void } {
  let stopped = false;
  let state: SyncState = { online: navigator.onLine, pending: 0, rejected: 0, paired: true };

  const tell = (patch: Partial<SyncState>) => {
    if (stopped) return;
    state = { ...state, ...patch };
    onState(state);
  };
  const counts = async () => ({ pending: await pendingCount(), rejected: await rejectedCount() });
  /** What an answer says about the connection and the pairing. */
  const reached = (status: number): Partial<SyncState> =>
    status === 0 ? { online: false } : status === 401 ? { online: true, paired: false } : { online: true };

  async function send(items: OutboxItem[]): Promise<SendResult> {
    const token = await getMeta<string>("deviceToken");
    if (!token) return { ok: false, reason: "unauthorized" };
    const answer = await kassaApi<{ results: ItemResult[] }>("/api/kassa/sales", token, { method: "POST", json: { items } });
    if (answer.ok) return { ok: true, results: answer.data.results };
    return { ok: false, reason: answer.status === 0 ? "offline" : answer.status === 401 ? "unauthorized" : "server" };
  }

  async function sendWaiting(): Promise<boolean> {
    const outcome = await flush(send);
    const status = outcome.stopped === "offline" ? 0 : outcome.stopped === "unauthorized" ? 401 : 200;
    // An empty queue was not sent anywhere, so it says nothing about the connection.
    const talked = outcome.sent + outcome.rejected > 0 || outcome.stopped !== undefined;
    tell({ ...(await counts()), ...(talked ? reached(status) : {}) });
    return outcome.stopped === undefined;
  }

  async function fetchCatalog(): Promise<void> {
    if ((await pendingCount()) > 0) return;
    const token = await getMeta<string>("deviceToken");
    if (!token) return tell({ paired: false });
    const answer = await kassaApi<Catalog>("/api/kassa/catalog", token);
    if (stopped) return;
    if (!answer.ok) return tell(reached(answer.status));
    // A sale made while the answer was on its way is not in this stock yet: wait for the next round.
    if ((await pendingCount()) === 0) {
      await saveCatalog(answer.data);
      if (!stopped) onCatalog(answer.data);
    }
    tell({ online: true });
  }

  async function round(): Promise<void> {
    if (!state.paired) return tell(await counts());
    if (await sendWaiting()) await fetchCatalog();
  }

  let busy = false;
  let again = false;
  async function work(): Promise<void> {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        await round();
      } while (again && !stopped);
    } catch (error) {
      // Storage or the page went away under us. The next round tries again.
      if (!stopped) console.error("kassa sync", error);
    } finally {
      busy = false;
    }
  }

  const onOnline = () => void work();
  const onOffline = () => tell({ online: false });
  const onVisible = () => {
    if (document.visibilityState === "visible") void work();
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(() => void work(), EVERY_MS);
  void work();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    },
    kick() {
      void work();
    },
  };
}
