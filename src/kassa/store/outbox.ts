// Sales wait here until the server has them. Nothing leaves the queue before the server has answered for it.

import type { OutboxItem } from "../../../shared/schemas";
import type { ItemResult } from "../../../shared/types";
import { getDb } from "./db";

export type SendResult = { ok: true; results: ItemResult[] } | { ok: false; reason: "offline" | "unauthorized" | "server" };

export type FlushOutcome = { sent: number; rejected: number; remaining: number; stopped?: "offline" | "unauthorized" | "server" };

type Row = { seq: number; item: OutboxItem };

/** The server takes at most this many items in one request. */
const BATCH = 50;

export async function enqueue(item: OutboxItem): Promise<void> {
  await (await getDb()).add("outbox", { item });
}

export async function pendingCount(): Promise<number> {
  return (await getDb()).count("outbox");
}

export async function rejectedCount(): Promise<number> {
  return (await getDb()).count("rejected");
}

/** A sale or reversal the server refused: kept on the iPad until someone has passed it on. */
export type Rejected = { id: string; item: OutboxItem; reason: string; at: string };

/** What the server refused, in the order it was rung up. */
export async function listRejected(): Promise<Rejected[]> {
  const rows = (await (await getDb()).getAll("rejected")) as Rejected[];
  return rows.sort((a, b) => a.item.soldAt.localeCompare(b.item.soldAt));
}

/** Forgets a refused item: its details have been passed on to the penningmeester. */
export async function dismissRejected(id: string): Promise<void> {
  await (await getDb()).delete("rejected", id);
}

let running: Promise<FlushOutcome> | null = null;

/**
 * Sends what is waiting, oldest first. An accepted or already known item leaves the queue; a refused one is
 * set aside so it cannot hold up the rest. When the server cannot be reached nothing is removed.
 * A call made while a flush is running joins that flush.
 */
export function flush(send: (items: OutboxItem[]) => Promise<SendResult>): Promise<FlushOutcome> {
  running ??= run(send).finally(() => {
    running = null;
  });
  return running;
}

async function run(send: (items: OutboxItem[]) => Promise<SendResult>): Promise<FlushOutcome> {
  const db = await getDb();
  let sent = 0;
  let rejected = 0;
  for (;;) {
    const rows = (await db.getAll("outbox", undefined, BATCH)) as Row[];
    if (rows.length === 0) return { sent, rejected, remaining: 0 };

    const answer = await send(rows.map((row) => row.item));
    if (!answer.ok) return { sent, rejected, remaining: await db.count("outbox"), stopped: answer.reason };

    const results = new Map(answer.results.map((result) => [result.id, result]));
    const tx = db.transaction(["outbox", "rejected"], "readwrite");
    let answered = 0;
    for (const row of rows) {
      const result = results.get(row.item.id);
      if (!result) continue; // no answer for this one: it stays and goes along next time
      answered++;
      if (result.status === "rejected") {
        rejected++;
        void tx.objectStore("rejected").put({ id: row.item.id, item: row.item, reason: result.reason ?? "invalid", at: new Date().toISOString() });
      } else {
        sent++;
      }
      void tx.objectStore("outbox").delete(row.seq);
    }
    await tx.done;
    // A server that answers for none of the items would otherwise be asked again and again.
    if (answered === 0) return { sent, rejected, remaining: await db.count("outbox"), stopped: "server" };
  }
}
