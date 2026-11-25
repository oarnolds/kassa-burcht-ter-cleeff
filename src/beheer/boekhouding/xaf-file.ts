// "2026 uit e-Boekhouden inlezen": reads the auditfile in the browser and lays it onto the app's accounts. The page
// loads this module with import() only when a file is chosen, so the reader stays out of every bundle until then.

import type { LedgerAccount } from "../../../shared/ledger-types";
import { parseXaf, XafError, type XafFile } from "../../../shared/xaf";
import { mapXaf, type XafPlan } from "../../../shared/xaf-map";
import { readText } from "./bank-file";

/**
 * What the file holds on the app's accounts, and the file itself, to lay it out again when the penningmeester gives
 * an unknown account a place; or why it cannot be read.
 */
export async function readXafFile(
  file: File,
  accounts: LedgerAccount[],
  options: { kassaSince: string | null; choices: Record<string, string> },
): Promise<{ ok: true; plan: XafPlan; file: XafFile } | { ok: false; error: "not_auditfile" | "unbalanced" | "not_2026" }> {
  let read: XafFile;
  try {
    read = parseXaf(await readText(file));
  } catch (error) {
    if (error instanceof XafError) return { ok: false, error: error.message as "not_auditfile" | "unbalanced" | "not_2026" };
    throw error;
  }
  return { ok: true, plan: mapXaf(read, accounts, options), file: read };
}
