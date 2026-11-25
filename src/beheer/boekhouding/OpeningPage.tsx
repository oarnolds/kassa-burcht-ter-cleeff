import { Link } from "react-router";
import { formatEuro } from "../../../shared/money";
import type { LedgerAccount } from "../../../shared/ledger-types";
import { Loaded, PageTitle, Section, textLink } from "../parts";
import { useAdminData } from "../useAdmin";
import { EBOEKHOUDEN_ROUTE, FIRST_LEDGER_YEAR, ledgerPath, type Opening } from "./ledger-api";

function OpeningView({ accounts, opening }: { accounts: LedgerAccount[]; opening: Opening }) {
  const names = new Map(accounts.map((account) => [account.code, account.name]));
  const lines = [...opening.lines].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  if (lines.length === 0 && opening.equityCents === 0) {
    return (
      <Section title="Bezittingen en schulden">
        <p className="px-2 text-lg sm:px-3">
          <strong>Nog niet ingelezen</strong>.{" "}
          <Link to={EBOEKHOUDEN_ROUTE} className={textLink}>
            {`${FIRST_LEDGER_YEAR} uit e-Boekhouden inlezen`}
          </Link>
        </p>
      </Section>
    );
  }
  return (
    <>
      <Section
        title="Bezittingen en schulden"
        note={`Uit het auditbestand van e-Boekhouden; 0130 en 0135 uit de toestellenlijst. Opnieuw inlezen kan bij ${FIRST_LEDGER_YEAR} uit e-Boekhouden inlezen.`}
      >
        <ul className="px-2 sm:px-3">
          {lines.map((line) => (
            <li key={line.accountCode} className="flex flex-wrap items-center justify-between gap-2 border-t border-sand py-2 first:border-t-0">
              <span className="text-lg">
                <span className="tabular-nums">{line.accountCode}</span> {names.get(line.accountCode) ?? ""}
              </span>
              <span className="text-lg tabular-nums">{formatEuro(line.amountCents)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 px-2 text-ink/70 sm:px-3">1030 Mollie begint op nul: e-Boekhouden boekte een uitbetaling als omzet toen die op ING binnenkwam.</p>
      </Section>
      <Section title="Uitkomst">
        <div className="flex flex-col gap-3 px-2 sm:px-3">
          <p className="flex flex-wrap justify-between gap-2 text-lg">
            <span className="font-semibold">Eigen vermogen (uitgerekend)</span>
            <strong className="tabular-nums">{formatEuro(opening.equityCents)}</strong>
          </p>
          {opening.eBoekhoudenEquityCents !== null && (
            <>
              <p className="flex flex-wrap justify-between gap-2 text-lg">
                <span className="font-semibold">Eigen vermogen in e-Boekhouden (ter vergelijking)</span>
                <span className="tabular-nums">{formatEuro(opening.eBoekhoudenEquityCents)}</span>
              </p>
              <p className="flex flex-wrap justify-between gap-2 text-lg">
                <span>Verschil met e-Boekhouden</span>
                <strong className="tabular-nums">{formatEuro(opening.eBoekhoudenEquityCents - opening.equityCents)}</strong>
              </p>
            </>
          )}
        </div>
      </Section>
    </>
  );
}

/** The balance on 1 January of the first year, read from e-Boekhouden's auditfile and the toestellen list: only shown here. */
export function OpeningPage() {
  const accounts = useAdminData<LedgerAccount[]>(ledgerPath.accounts);
  const opening = useAdminData<Opening>(ledgerPath.opening(FIRST_LEDGER_YEAR));
  return (
    <div>
      <PageTitle>{`Beginbalans 1 januari ${FIRST_LEDGER_YEAR}`}</PageTitle>
      <Loaded from={accounts}>{(list) => <Loaded from={opening}>{(data) => <OpeningView accounts={list} opening={data} />}</Loaded>}</Loaded>
    </div>
  );
}
