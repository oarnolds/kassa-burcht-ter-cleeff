import { Link } from "react-router";
import type { LedgerOverview } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { formatDateNl } from "../../../shared/time";
import { Loaded, PageTitle, Section, textLink, today } from "../parts";
import { useAdminData } from "../useAdmin";
import { ledgerPath } from "./ledger-api";

/** The first page of the boekhouding: what waits, where the money is, how the year is going. */
export function OverviewPage() {
  const overview = useAdminData<LedgerOverview>(ledgerPath.overview);
  return (
    <div>
      <PageTitle>Overzicht</PageTitle>
      <Loaded from={overview}>
        {(o) => (
          <>
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
