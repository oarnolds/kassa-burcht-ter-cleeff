// "W&V uit e-Boekhouden inlezen": unzips the .xlsx in the browser and reads it. The page Eerdere jaren loads this
// module with import() only when a file is chosen, so fflate and the reader stay out of every bundle until then.

import { unzipSync } from "fflate";
import { EbResultError, mapToAccounts, parseEBoekhoudenResult, type EbMapped, type EbResult } from "../../../shared/eboekhouden-result";
import type { LedgerAccount } from "../../../shared/ledger-types";

/** A winst-en-verliesrekening is a few kilobytes; anything this large is something else. */
const MAX_BYTES = 10 * 1024 * 1024;
/** Only the workbook's XML parts are unzipped: no images, no printer settings. */
const WANTED = /^xl\/.*\.(xml|rels)$/;

export type ReadFile = { ok: true; result: EbResult; mapped: EbMapped } | { ok: false; error: "not_eboekhouden_result" | "not_whole_year" };

/** The year, its rows and where they go on the app's accounts; or why the file cannot be read. */
export async function readEBoekhoudenFile(file: File, accounts: LedgerAccount[]): Promise<ReadFile> {
  if (file.size > MAX_BYTES) return { ok: false, error: "not_eboekhouden_result" };
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (entry) => WANTED.test(entry.name) });
  } catch {
    return { ok: false, error: "not_eboekhouden_result" };
  }
  try {
    const result = parseEBoekhoudenResult(parts);
    return { ok: true, result, mapped: mapToAccounts(result, accounts) };
  } catch (error) {
    if (error instanceof EbResultError) return { ok: false, error: error.message as "not_eboekhouden_result" | "not_whole_year" };
    throw error;
  }
}
