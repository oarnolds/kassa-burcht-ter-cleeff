// The assortment as last fetched, kept so the kassa starts without a network, and a count of what was
// sold since that fetch, so the stock on the tiles can be kept right between two fetches.

import type { Catalog } from "../../../shared/types";
import { getDb, getMeta } from "./db";

export async function loadCatalog(): Promise<Catalog | null> {
  return (await getMeta<Catalog>("catalog")) ?? null;
}

/** Stores a freshly fetched catalog. Its stock already counts every sale the server has, so the count starts over. */
export async function saveCatalog(catalog: Catalog): Promise<void> {
  const tx = (await getDb()).transaction("meta", "readwrite");
  void tx.store.put(catalog, "catalog");
  void tx.store.put({}, "soldSinceFetch");
  await tx.done;
}

/** Adds sold pieces to the count; a reversal passes negative quantities. */
export async function noteSold(lines: { productId: string; qty: number }[]): Promise<void> {
  const tx = (await getDb()).transaction("meta", "readwrite");
  const sold: Record<string, number> = { ...((await tx.store.get("soldSinceFetch")) as Record<string, number> | undefined) };
  for (const line of lines) {
    const next = (sold[line.productId] ?? 0) + line.qty;
    if (next === 0) delete sold[line.productId];
    else sold[line.productId] = next;
  }
  void tx.store.put(sold, "soldSinceFetch");
  await tx.done;
}

export async function soldSinceFetch(): Promise<Record<string, number>> {
  return (await getMeta<Record<string, number>>("soldSinceFetch")) ?? {};
}
