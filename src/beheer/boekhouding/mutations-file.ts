// "Mutatieoverzicht inlezen": unzips the .xlsx in the browser and reads it. The Begroting page loads this module with
// import() only when a file is chosen, so fflate and the reader stay out of every bundle until then.

import { unzipSync } from "fflate";
import { EbMutationsError, type EbMutations, parseEBoekhoudenMutations } from "../../../shared/eboekhouden-mutations";

/** A year of mutations is some tens of kilobytes; anything this large is something else. */
const MAX_BYTES = 10 * 1024 * 1024;
/** Only the workbook's XML parts are unzipped: no images, no printer settings. */
const WANTED = /^xl\/.*\.(xml|rels)$/;

export type ReadMutations = { ok: true; mutations: EbMutations } | { ok: false; error: "not_eboekhouden_mutations" | "not_one_year" };

/** The year's mutations; or why the file cannot be read. */
export async function readMutationsFile(file: File): Promise<ReadMutations> {
  if (file.size > MAX_BYTES) return { ok: false, error: "not_eboekhouden_mutations" };
  let parts: Record<string, Uint8Array>;
  try {
    parts = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (entry) => WANTED.test(entry.name) });
  } catch {
    return { ok: false, error: "not_eboekhouden_mutations" };
  }
  try {
    return { ok: true, mutations: parseEBoekhoudenMutations(parts) };
  } catch (error) {
    if (error instanceof EbMutationsError) return { ok: false, error: error.message as "not_eboekhouden_mutations" | "not_one_year" };
    throw error;
  }
}
