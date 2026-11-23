import { useId, useState } from "react";
import { Link } from "react-router";
import type { LedgerYear, YearCheck } from "../../../shared/ledger-types";
import { businessDate } from "../../../shared/time";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { Loaded, PageTitle, Problem, Section, field, pillLink, textLink, today } from "../parts";
import { useAdminData } from "../useAdmin";
import { explainWrite, ledgerPath, useLedgerWrites } from "./ledger-api";
import { useBusy } from "./useBusy";

/** `d-m-jjjj` of a `YYYY-MM-DD` day: 15-1-2028. */
const dayMonthYear = (date: string): string => {
  const [year, month, day] = date.split("-");
  return `${Number(day)}-${Number(month)}-${year}`;
};
/** The day of a moment in the Netherlands, as d-m-jjjj. */
const dayOf = (iso: string): string => dayMonthYear(businessDate(iso));

/** What each check looks at; the Worker says what it found. */
const CHECK_NAMES: Record<YearCheck["key"], string> = {
  bank_lines: "Alle bankregels geboekt",
  bank_balances: "Saldo's gelijk aan de bank",
  cash: "Kas gelijk aan de kassa",
  mollie: "Mollie gelijk aan het saldo bij Mollie",
  depreciation: "Afschrijving geboekt",
  in_transit: "Kruisposten (1080) op nul",
  assets: "0130 en 0135 gelijk aan de lijst toestellen",
};

const label = "flex flex-col gap-1 font-semibold";

function CheckList({ year, checks }: { year: number; checks: YearCheck[] }) {
  return (
    <ul aria-label={`Controles ${year}`} className="flex flex-col">
      {checks.map((check) => (
        <li key={check.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-sand py-2 first:border-t-0">
          <span className="font-semibold">{CHECK_NAMES[check.key]}</span>
          {check.required && <span className="rounded-full bg-sand px-2 text-sm font-semibold">verplicht</span>}
          {check.ok ? <span className="text-lg font-bold text-green-dark">✓</span> : <span className="text-redbrown">{check.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * The checks of an open year and "Jaar afsluiten", from 1 January of the next year and once the years before it are
 * closed (`earlierOpen`, R34). Refused while a required check fails; when another one fails, a toelichting is needed
 * (it goes into the jaaroverzicht). Asked once more before it is sent: after closing nothing in the year changes.
 */
function OpenYear({ year, earlierOpen, onClosed }: { year: number; earlierOpen: number | null; onClosed(): void }) {
  const checks = useAdminData<YearCheck[]>(ledgerPath.yearChecks(year));
  const api = useLedgerWrites();
  const toast = useToast();
  const [busy, run] = useBusy();
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const hint = useId();
  const ended = today() >= `${year + 1}-01-01`;

  const close = (needsNote: boolean) =>
    run(async () => {
      setProblem(null);
      if (!window.confirm(`${year} afsluiten? Daarna verandert er niets meer in ${year}.`)) return;
      const answer = await api.closeYear(year, needsNote ? note.trim() : null);
      if (!answer.ok) {
        setProblem(explainWrite(answer.status, answer.error));
        checks.reload();
        return;
      }
      toast.show("Afgesloten.");
      onClosed();
    });

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-bold">Controles</h3>
      <Loaded from={checks}>
        {(list) => {
          const requiredFails = list.some((check) => check.required && !check.ok);
          const needsNote = list.some((check) => !check.required && !check.ok);
          return (
            <>
              <CheckList year={year} checks={list} />
              {!ended && <p className="text-ink/70">{`Afsluiten kan vanaf 1-1-${year + 1}.`}</p>}
              {ended && earlierOpen !== null && <p className="font-semibold">{`Sluit eerst ${earlierOpen} af.`}</p>}
              {ended && requiredFails && <p className="font-semibold">{`Boek eerst alle bankregels van ${year}; daarna kan het jaar dicht.`}</p>}
              {ended && needsNote && (
                <>
                  <p id={hint} className="text-ink/70">
                    Niet alles klopt. Schrijf waarom het jaar toch dicht kan; dat komt in het jaaroverzicht.
                  </p>
                  <label className={label}>
                    Toelichting
                    <textarea aria-describedby={hint} maxLength={1000} className={`${field} min-h-24 py-2 font-normal`} value={note} onChange={(event) => setNote(event.target.value)} />
                  </label>
                </>
              )}
              {ended && (
                <div>
                  <Button variant="primary" disabled={busy || earlierOpen !== null || requiredFails || (needsNote && note.trim() === "")} onClick={() => void close(needsNote)}>
                    Jaar afsluiten
                  </Button>
                </div>
              )}
            </>
          );
        }}
      </Loaded>
      {problem && <Problem>{problem}</Problem>}
    </div>
  );
}

/** "Heropenen" of the newest closed year, with a reason: it is open again until it is closed once more. */
function Reopen({ year, onReopened }: { year: number; onReopened(): void }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [busy, run] = useBusy();
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const reopen = () =>
    run(async () => {
      setProblem(null);
      const answer = await api.reopenYear(year, reason.trim());
      if (!answer.ok) return setProblem(explainWrite(answer.status, answer.error));
      toast.show("Heropend.");
      onReopened();
    });

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-bold">Heropenen</h3>
      <p className="text-ink/70">Vond de kascommissie een fout? Heropen het jaar met de reden, verbeter het en sluit het daarna opnieuw af.</p>
      <label className={label}>
        Reden
        <input type="text" maxLength={1000} className={field} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <div>
        <Button disabled={busy || reason.trim().length < 3} onClick={() => void reopen()}>
          Heropenen
        </Button>
      </div>
      {problem && <Problem>{problem}</Problem>}
    </div>
  );
}

function YearBlock({ year, earlierOpen, reopenable, onChanged }: { year: LedgerYear; earlierOpen: number | null; reopenable: boolean; onChanged(): void }) {
  const status = year.status === "open" ? "open" : year.closedAt ? `afgesloten op ${dayOf(year.closedAt)}` : "afgesloten";
  return (
    <Section title={String(year.year)} note={status}>
      <div className="flex flex-col gap-5 px-2 sm:px-3">
        {year.status === "open" && <OpenYear year={year.year} earlierOpen={earlierOpen} onClosed={onChanged} />}
        {reopenable && <Reopen year={year.year} onReopened={onChanged} />}
        {year.events.length > 0 && (
          <div className="flex flex-col gap-1">
            <h3 className="font-bold">Geschiedenis</h3>
            <ul aria-label={`Geschiedenis ${year.year}`} className="flex flex-col gap-1">
              {year.events.map((event, index) => (
                <li key={index}>{`${event.kind === "closed" ? "Afgesloten" : "Heropend"} op ${dayOf(event.at)}${event.note ? `: ${event.note}` : ""}`}</li>
              ))}
            </ul>
          </div>
        )}
        <p>
          <Link to={`/beheer/boekhouding/jaar/${year.year}/afdruk`} className={textLink}>
            Jaaroverzicht
          </Link>
        </p>
      </div>
    </Section>
  );
}

/** Jaar: per year its status, the checks and "Jaar afsluiten", reopening the newest closed year, and the history. */
export function YearPage() {
  const years = useAdminData<LedgerYear[]>(ledgerPath.years);
  return (
    <div>
      <PageTitle>Jaar</PageTitle>
      <p className="mt-3 flex flex-wrap gap-3">
        <Link to="/beheer/boekhouding/beginbalans" className={pillLink}>
          Beginbalans
        </Link>
        <Link to="/beheer/boekhouding/vergelijking" className={pillLink}>
          Vergelijkingscijfers 2026
        </Link>
        <Link to="/beheer/boekhouding/toestellen" className={pillLink}>
          Toestellen (afschrijving)
        </Link>
      </p>
      <Loaded from={years}>
        {(list) => {
          const closed = list.filter((year) => year.status === "closed").map((year) => year.year);
          const newestClosed = closed.length === 0 ? null : Math.max(...closed);
          // The years are closed in order (R34): the first open year comes before any later one.
          const firstOpen = list.find((year) => year.status === "open")?.year ?? null;
          // The newest year first: that is where the work is.
          return [...list].reverse().map((year) => (
            <YearBlock
              key={year.year}
              year={year}
              earlierOpen={firstOpen !== null && firstOpen < year.year ? firstOpen : null}
              reopenable={year.year === newestClosed}
              onChanged={years.reload}
            />
          ));
        }}
      </Loaded>
    </div>
  );
}
