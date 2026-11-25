import { useState } from "react";
import { Link } from "react-router";
import type { LedgerOverview, MoneyAccount, NightlyReport } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { formatDateNl, localTime } from "../../../shared/time";
import { Button } from "../../ui/Button";
import { Loaded, PageTitle, Problem, Section, count, textLink, today } from "../parts";
import { useAdminData } from "../useAdmin";
import { ConsentWarning } from "./ConsentWarning";
import { cashText, dayOf, failedSteps, notUpdatedText, ranTonight, waitingText } from "./ledger-alerts";
import { ledgerPath, useLedgerWrites } from "./ledger-api";

/** "Vannacht bijgewerkt om 02:00" for a run between midnight and six this morning, else the day. */
function lastRun(report: NightlyReport): string {
  const time = localTime(report.at);
  return ranTonight(report) ? `Vannacht bijgewerkt om ${time}` : `Bijgewerkt op ${dayOf(report.at)} om ${time}`;
}

const red = "font-semibold text-redbrown";

/** Until when ING may be read, while ING betaal takes its lines from Enable Banking and the consent still holds. */
function ingUntil(o: LedgerOverview, account: MoneyAccount): string | null {
  if (account.accountCode !== "1010" || account.source !== "enable_banking" || !o.consent || o.consent.daysLeft < 0) return null;
  return `ING gekoppeld tot ${dayOf(o.consent.validUntil)}`;
}

/** The button that brings the books up to date now, when that last happened, each step that failed, and a run that stopped happening. */
function Update({ last, notUpdatedSince, reload }: { last: NightlyReport | null; notUpdatedSince: string | null; reload: () => void }) {
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
      {failedSteps(shown).map((text) => (
        <p key={text} className={red}>
          {text}
        </p>
      ))}
      {!ran && notUpdatedSince && <p className={red}>{notUpdatedText(notUpdatedSince)}</p>}
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
            <ConsentWarning overview={o} />
            {!o.eboekhoudenDone && (
              <p className="px-2 sm:px-3">
                <Link className={`${textLink} inline-flex min-h-11 items-center`} to="/beheer/boekhouding/eboekhouden-2026">
                  {waitingText}
                </Link>
              </p>
            )}
            <Update last={o.lastNightly} notUpdatedSince={o.notUpdatedSince} reload={overview.reload} />
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
                    {account.accountCode === "1030" && o.mollieInTransitCents > 0 && (
                      <span className="text-ink/70">{`Onderweg naar ING ${formatEuro(o.mollieInTransitCents)}`}</span>
                    )}
                    {account.differenceCents !== null && account.differenceCents !== 0 && (
                      <span className="flex flex-wrap gap-x-2">
                        <span className={red}>{`verschil ${formatEuro(account.differenceCents)}`}</span>
                        {(o.toBookByAccount[account.accountCode] ?? 0) > 0 && (
                          <span className="text-ink/70">{`waarvan nog te boeken: ${count(o.toBookByAccount[account.accountCode]!, "regel", "regels")}`}</span>
                        )}
                      </span>
                    )}
                    {ingUntil(o, account) && <span className="text-ink/70">{ingUntil(o, account)}</span>}
                  </li>
                ))}
              </ul>
              {o.mollieDifferenceCents !== null && o.mollieDifferenceCents !== 0 && (
                <p className="mt-1 px-2 sm:px-3">
                  <Link className={`${textLink} inline-flex min-h-11 items-center`} to="/beheer/boekhouding/mollie">
                    {`Mollie wijkt ${formatEuro(Math.abs(o.mollieDifferenceCents))} af van de boekhouding`}
                  </Link>
                </p>
              )}
            </Section>
            <Section title="Dit jaar">
              <p className="flex flex-wrap justify-between gap-2 px-2 text-lg sm:px-3">
                <span>{`Resultaat ${today().slice(0, 4)} tot nu toe`}</span>
                <strong className="tabular-nums">{formatEuro(o.resultYearCents)}</strong>
              </p>
              {o.cashDifferenceCents !== 0 && <p className={`mt-3 px-2 sm:px-3 ${red}`}>{cashText(o.cashDifferenceCents)}</p>}
            </Section>
          </>
        )}
      </Loaded>
    </div>
  );
}
