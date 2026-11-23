import { useState } from "react";
import { type Entry, YEAR_PAGE, type YearChange, type YearExport } from "../../../shared/ledger-types";
import { adminApi } from "../../lib/api";
import { Button } from "../../ui/Button";
import { Problem } from "../parts";
import { useGo } from "../useAdmin";
import { attachmentBytes, ledgerPath } from "./ledger-api";
import { useBusy } from "./useBusy";

/** A read that did not come; `status` 0 is no connection. */
class LoadFailed extends Error {
  constructor(public status: number) {
    super(`load failed with ${status}`);
  }
}

/** A failure with its own sentence for the page. */
class Explained extends Error {}

async function load<T>(path: string): Promise<T> {
  const answer = await adminApi<T>(path);
  if (!answer.ok) throw new LoadFailed(answer.status);
  return answer.data;
}

/** Every page, YEAR_PAGE at a time, until one comes back shorter. */
async function allPages<T>(path: (after: number) => string, last: (item: T) => number, onPage: (count: number) => void = () => {}): Promise<T[]> {
  const all: T[] = [];
  for (let after = 0; ; ) {
    const page = await load<T[]>(path(after));
    all.push(...page);
    onPage(all.length);
    if (page.length < YEAR_PAGE) return all;
    after = last(page.at(-1)!);
  }
}

/** Offers a file to save, as a download of a blob. */
function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Long enough for the browser to have read it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const progressOf = (done: number, total: number) => `Bezig met ${done} van ${total} boekingen …`;

/**
 * "Excel", "PDF" and "Bijlagen (zip)" of a year (spec §13): the Excel file and the zip are made here in the browser
 * from the Worker's pages; the code that writes them (and fflate) comes with import() when a button is pressed. "PDF"
 * opens the afdruk in a new tab, which opens the print dialog ("Bewaar als PDF").
 */
export function YearExportButtons({ year }: { year: number }) {
  const go = useGo();
  const [busy, run] = useBusy();
  const [progress, setProgress] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  /** The year's figures and all its entries, saying how far it is. */
  async function loadEntries(): Promise<{ data: YearExport; entries: Entry[] }> {
    setProgress("Bezig …");
    const data = await load<YearExport>(ledgerPath.yearExport(year));
    setProgress(progressOf(0, data.entryCount));
    const entries = await allPages<Entry>(
      (after) => ledgerPath.yearEntries(year, after),
      (entry) => entry.number,
      (count) => setProgress(progressOf(count, Math.max(count, data.entryCount))),
    );
    return { data, entries };
  }

  const make = (work: () => Promise<void>) =>
    run(async () => {
      setProblem(null);
      setNote(null);
      try {
        await work();
      } catch (error) {
        if (error instanceof LoadFailed && error.status === 401) return go("/beheer/login");
        setProblem(
          error instanceof Explained
            ? error.message
            : error instanceof LoadFailed && error.status === 0
              ? "Geen verbinding. Probeer het opnieuw."
              : "Het jaaroverzicht kon niet worden gemaakt. Probeer het opnieuw.",
        );
      } finally {
        setProgress(null);
      }
    });

  const excel = () =>
    make(async () => {
      const { data, entries } = await loadEntries();
      const changes = await allPages<YearChange>(
        (after) => ledgerPath.yearChanges(year, after),
        (change) => change.id,
      );
      const { buildWorkbook } = await import("./year-export");
      save(await buildWorkbook(data, entries, changes), `jaaroverzicht-${year}.xlsx`);
    });

  const zip = () =>
    make(async () => {
      const { entries } = await loadEntries();
      if (!entries.some((entry) => entry.attachments.length > 0)) return setNote(`Er zijn geen bijlagen in ${year}.`);
      const { AttachmentFetchError, buildAttachmentsZip } = await import("./year-export");
      const blob = await buildAttachmentsZip(
        entries,
        async (id) => {
          const answer = await attachmentBytes(id);
          if (!answer.ok) throw new LoadFailed(answer.status);
          return answer.bytes;
        },
        (done, total) => setProgress(progressOf(done, total)),
      ).catch((error: unknown) => {
        if (!(error instanceof AttachmentFetchError)) throw error;
        throw new Explained(`Bijlage ${error.filename} van boeking ${error.number} kon niet worden opgehaald. Probeer het opnieuw.`);
      });
      save(blob, `bijlagen-${year}.zip`);
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void excel()}>
          Excel
        </Button>
        <Button disabled={busy} onClick={() => window.open(ledgerPath.yearPrint(year, true), "_blank")}>
          PDF
        </Button>
        <Button disabled={busy} onClick={() => void zip()}>
          Bijlagen (zip)
        </Button>
      </div>
      {progress && (
        <p role="status" className="text-ink/70">
          {progress}
        </p>
      )}
      {note && <p>{note}</p>}
      {problem && <Problem>{problem}</Problem>}
    </div>
  );
}
