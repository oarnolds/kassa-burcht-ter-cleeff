// The kassa's own storage on the iPad (IndexedDB). It holds what must survive a closed tab or a flat
// battery: sales that still have to be sent, sales the server refused, receipts whose pin payment is not
// settled yet, and a few values by key.
//
// Two databases. `kassa` stays at version 1, as fase 1 made it: should fase 2 ever be rolled back, the
// fase 1 app must still open it, or the kassa stays blank, cash included. What came later lives beside it.

import { openDB, type IDBPDatabase } from "idb";

const connections = new Map<string, Promise<IDBPDatabase>>();

function open(name: string, version: number, upgrade: (db: IDBPDatabase) => void): Promise<IDBPDatabase> {
  const open = connections.get(name);
  if (open) return open;
  const forget = () => {
    if (connections.get(name) === opening) connections.delete(name);
  };
  const opening: Promise<IDBPDatabase> = openDB(name, version, { upgrade, terminated: forget });
  connections.set(name, opening);
  opening.then((db) => {
    // Someone wants to replace or remove the database: step aside, and open it afresh on the next use.
    db.addEventListener("versionchange", () => {
      db.close();
      forget();
    });
  }, forget);
  return opening;
}

/** Sales to send, refused sales, and values by key. */
export function getDb(): Promise<IDBPDatabase> {
  return open("kassa", 1, (db) => {
    db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
    db.createObjectStore("rejected", { keyPath: "id" });
    db.createObjectStore("meta");
  });
}

/** Receipts whose pin payment the kassa is not done with. */
export function getPinDb(): Promise<IDBPDatabase> {
  return open("kassa-pin", 1, (db) => {
    db.createObjectStore("pin", { keyPath: "id" });
  });
}

/** Meta keys in use: `deviceToken`, `catalog`, `soldSinceFetch`. */
export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await getDb()).get("meta", key) as Promise<T | undefined>;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await getDb()).put("meta", value, key);
}
