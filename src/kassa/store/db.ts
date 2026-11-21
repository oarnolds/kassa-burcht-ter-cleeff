// The kassa's own storage on the iPad (IndexedDB). It holds what must survive a closed tab or a flat
// battery: sales that still have to be sent, sales the server refused, receipts whose pin payment is not
// settled yet, and a few values by key.

import { openDB, type IDBPDatabase } from "idb";

const NAME = "kassa";
const VERSION = 2;

let connection: Promise<IDBPDatabase> | null = null;

export function getDb(): Promise<IDBPDatabase> {
  if (connection) return connection;
  const forget = () => {
    if (connection === opening) connection = null;
  };
  const opening: Promise<IDBPDatabase> = openDB(NAME, VERSION, {
    // Each step adds to what an older kassa already has: what waits on the iPad is never thrown away.
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
        db.createObjectStore("rejected", { keyPath: "id" });
        db.createObjectStore("meta");
      }
      if (oldVersion < 2) db.createObjectStore("pin", { keyPath: "id" });
    },
    terminated: forget,
  });
  connection = opening;
  opening.then((db) => {
    // Someone wants to replace or remove the database: step aside, and open it afresh on the next use.
    db.addEventListener("versionchange", () => {
      db.close();
      forget();
    });
  }, forget);
  return opening;
}

/** Meta keys in use: `deviceToken`, `catalog`, `soldSinceFetch`. */
export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await getDb()).get("meta", key) as Promise<T | undefined>;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await getDb()).put("meta", value, key);
}
