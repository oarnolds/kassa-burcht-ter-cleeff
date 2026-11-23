import { useState } from "react";
import { Link } from "react-router";
import type { LedgerOverview, NightlyReport, NightlyStep } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { businessDate, formatDateNl, localTime } from "../../../shared/time";
import { Button } from "../../ui/Button";
import { Loaded, PageTitle, Problem, Section, textLink, today } from "../parts";
import { useAdminData } from "../useAdmin";
import { ledgerPath, useLedgerWrites } from "./ledger-api";

const STEP_NAMES: Record<NightlyStep, string> = { kassa: "kassa", ing: "ING", mollie: "Mollie" };

/** "Vannacht bijgewerkt om 02:00" for a run between midnight and six this morning, else the day; then each step that failed. */
function lastRun(report: NightlyReport): string {
  const time = localTime(report.at);
  const night = businessDate(report.at) === today() && time < "06:00";
  const [year, month, day] = businessDate(report.at).split("-");
  const when = night ? `Vannacht bijgewerkt om ${time}` : `Bijgewerkt op ${Number(day)}-${Number(month)}-${year} om ${time}`;
  const failed = (Object.keys(STEP_NAMES) as NightlyStep[])
    .filter((step) => report.steps[step] !== undefined && report.steps[step] !== "ok" && report.steps[step] !== "skipped")
    .map((step) => ` (${STEP_NAMES[step]} niet gelukt)`);
  return when + failed.join("");
}

/** The button that brings the books up to date now, and when that last happened. */
function Update({ last, reload }: { last: NightlyReport | null; reload: () => void }) {
  const writes = useLedgerWrites();
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState<NightlyReport | null>(null);
  const [problem, setProblem] = useState(false);
  const run = async () => {
    setRunning(true);
    setProblem(false);
    const answer = await writes.syncNow();
    setRunning(false);
    if (!answer.ok) return setProblem(true);
    setRan(answer.data);
    reload();
  };
  const shown = ran ?? last;
  return (
    <div className="flex flex-col items-start gap-2 px-2 sm:px-3">
      <Button onClick={() => void run()} disabled={running}>
        Nu bijwerken
      </Button>
      {problem && <Problem>Bijwerken is niet gelukt. Probeer het opnieuw.</Problem>}
      {shown && <p className="text-ink/70">{lastRun(shown)}</p>}
    </div>
  );
}

/** The first page of the boekhouding: what waits, where the money is, how the year is going. */
export function OverviewPage() {
  const overview = useAdminData<LedgerOverview>(ledgerPath.overview);
  return (
    <div>
      <PageTitle>Overzicht</PageTitle>
      <Loaded from={overview}>
        {(o) => (
          <>
            <Update last={o.lastNightly} reload={overview.reload} />
            <Section title="Te boeken">
              <p className="flex flex-wrap items-baseline gap-x-4 px-2 text-lg sm:px-3">
                <Link className={`${textLink} inline-flex min-h-11 items-center`} to="/beheer/boekhouding/te-boeken">{`Te boeken: ${o.openLines}`}</Link>
                {o.waitingLines > 0 && <span className="text-ink/70">{o.waitingLines === 1 ? "1 wacht op Mollie" : `${o.waitingLines} wachten op Mollie`}</span>}
              </p>
            </Section>
            <Section title="Geldrekeningen">
              <ul className="px-2 sm:px-3">
                {o.moneyAccounts.map((account) => (
                  <li key={account.accountCode} aria-label={account.name} className="flex flex-col gap-1 border-t border-sand py-3 first:border-t-0">
                    <span className="text-lg font-semibold">{account.name}</span>
                    <span className="flex flex-wrap justify-between gap-x-4">
                      <span>Saldo in de boekhouding</span>
                      <strong className="tabular-nums">{formatEuro(account.ledgerCents)}</strong>
                    </span>
                    {account.bank && (
                      <span className="flex flex-wrap justify-between gap-x-4">
                        <span>{`Saldo bij de bank op ${formatDateNl(account.bank.date)}`}</span>
                        <strong className="tabular-nums">{formatEuro(account.bank.balanceCents)}</strong>
                      </span>
                    )}
                    {account.differenceCents !== null && account.differenceCents !== 0 && (
                      <span className="font-semibold text-redbrown">{`verschil ${formatEuro(account.differenceCents)}`}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="Dit jaar">
              <p className="flex flex-wrap justify-between gap-2 px-2 text-lg sm:px-3">
                <span>{`Resultaat ${today().slice(0, 4)} tot nu toe`}</span>
                <strong className="tabular-nums">{formatEuro(o.resultYearCents)}</strong>
              </p>
              {o.cashDifferenceCents !== 0 && (
                <p className="mt-3 px-2 font-semibold text-redbrown sm:px-3">{`Kas wijkt ${formatEuro(Math.abs(o.cashDifferenceCents))} af van wat er volgens de kassa in het kluisje hoort`}</p>
              )}
            </Section>
          </>
        )}
      </Loaded>
    </div>
  );
}
