// Which Mollie terminal the kassa sends its pin payments to, and what beheer sees of Mollie.

import type { PinMode, PinSettings } from "../../shared/types";
import type { Mollie } from "../lib/mollie";

const ID_KEY = "mollie_terminal_id";
const MODE_KEY = "mollie_terminal_mode";

/** A pin request the kassa or beheer cannot carry out, with the status the route answers. */
export class PinError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

type SettingRow = { key: string; value: string };

/** Reads the terminal choice. A statement of its own, so that the catalog can fetch it in its one round trip. */
export function terminalChoiceQuery(db: D1Database): D1PreparedStatement {
  return db.prepare("SELECT key, value FROM settings WHERE key IN (?1, ?2)").bind(ID_KEY, MODE_KEY);
}

/**
 * The terminal that was chosen with a key of this mode. A terminal chosen with the test key is Mollie's
 * simulated one: it does not exist for real payments, so with the live key it counts as not chosen.
 */
export function chosenFrom(rows: SettingRow[], mode: PinMode): string | null {
  const value = (key: string) => rows.find((row) => row.key === key)?.value ?? null;
  return value(MODE_KEY) === mode ? value(ID_KEY) : null;
}

export async function chosenTerminal(db: D1Database, mode: PinMode): Promise<string | null> {
  return chosenFrom((await terminalChoiceQuery(db).all<SettingRow>()).results, mode);
}

/** Stores the choice after checking it against Mollie's own list; null clears it. */
export async function chooseTerminal(db: D1Database, mollie: Mollie, terminalId: string | null): Promise<void> {
  if (terminalId === null) {
    await db.prepare("DELETE FROM settings WHERE key IN (?1, ?2)").bind(ID_KEY, MODE_KEY).run();
    return;
  }
  const listed = await mollie.listTerminals();
  if (!listed.ok) throw new PinError(listed.failure === "unauthorized" ? "unauthorized" : "unreachable", 503);
  const terminal = listed.data.find((candidate) => candidate.id === terminalId);
  if (!terminal) throw new PinError("unknown_terminal", 409);
  if (terminal.status !== "active") throw new PinError("terminal_not_active", 409);
  const put = "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
  // Both rows or neither: an id stored with the wrong mode would send test payments to a real terminal.
  await db.batch([db.prepare(put).bind(ID_KEY, terminalId), db.prepare(put).bind(MODE_KEY, mollie.mode)]);
}

export async function pinSettings(db: D1Database, mollie: Mollie | null): Promise<PinSettings> {
  if (!mollie) return { mode: null, terminalId: null, terminals: [], problem: "no_key" };
  const [terminalId, listed] = await Promise.all([chosenTerminal(db, mollie.mode), mollie.listTerminals()]);
  if (!listed.ok) return { mode: mollie.mode, terminalId, terminals: [], problem: listed.failure === "unauthorized" ? "unauthorized" : "unreachable" };
  return { mode: mollie.mode, terminalId, terminals: listed.data, problem: null };
}
