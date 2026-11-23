import { Link } from "react-router";
import { formatEuro } from "../../shared/money";
import { formatDateNl } from "../../shared/time";
import type { LedgerOverview } from "../../shared/ledger-types";
import type { PinAttention, Summary } from "../../shared/types";
import { Card, Loaded, PageTitle, TotalsBlock, count, pillLink, textLink } from "./parts";
import { ledgerPath } from "./boekhouding/ledger-api";
import { useAdminData } from "./useAdmin";

const attentionText = ({ kind, date, totalCents }: PinAttention): string =>
  kind === "pending"
    ? `Pinbetaling van ${formatEuro(totalCents)} wacht op bevestiging (${formatDateNl(date)})`
    : `Mogelijk dubbel betaald: ${formatEuro(totalCents)} (${formatDateNl(date)})`;

/** One line when the boekhouding wants attention; nothing when all is well or when it cannot be read. */
function LedgerLine() {
  const { data } = useAdminData<LedgerOverview>(ledgerPath.overview);
  if (!data) return null;
  const toBook = data.openLines + data.waitingLines;
  const off = data.moneyAccounts.find((account) => account.differenceCents !== null && account.differenceCents !== 0);
  const text = toBook > 0 ? `Boekhouding: ${toBook} te boeken` : off ? `Saldo wijkt af bij ${off.name}` : null;
  if (!text) return null;
  return (
    <p className="mt-3">
      <Link className={`${textLink} inline-flex min-h-11 items-center text-lg`} to="/beheer/boekhouding">
        {text}
      </Link>
    </p>
  );
}

/** The first page of beheer: how today and this month stand, what should be in the cash box, what to order. */
export function DashboardPage() {
  const summary = useAdminData<Summary>("/api/admin/summary");
  return (
    <>
      <PageTitle>Overzicht</PageTitle>
      <LedgerLine />
      <Loaded from={summary}>
        {(s) => (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {s.pinAttention.length > 0 && (
              <Card title="Pin: let op" className="border-2 border-redbrown sm:col-span-2">
                <ul className="flex flex-col gap-1 text-lg">
                  {s.pinAttention.map((entry, index) => (
                    <li key={index}>
                      <Link className={`${textLink} inline-flex min-h-11 items-center`} to={`/beheer/verkopen?datum=${entry.date}`}>
                        {attentionText(entry)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card title="Vandaag">
              <TotalsBlock totals={s.today} />
              <p className="mt-3">
                <Link className={textLink} to={`/beheer/verkopen?datum=${s.today.date}`}>
                  {`Bekijk de verkopen van ${formatDateNl(s.today.date)}`}
                </Link>
              </p>
            </Card>
            <Card title="Deze maand">
              <TotalsBlock totals={s.month} />
              <p className="mt-3">
                <Link className={textLink} to={`/beheer/rapporten?maand=${s.month.month}`}>
                  Bekijk het maandrapport
                </Link>
              </p>
            </Card>
            <Card title="In het kluisje hoort">
              <p className="text-4xl font-bold tabular-nums">{formatEuro(s.cashExpectedCents)}</p>
              <p className="mt-1 text-lg text-ink/70">Contant sinds de laatste afdracht.</p>
              <p className="mt-3">
                <Link className={pillLink} to="/beheer/kluisje">
                  Afdracht vastleggen
                </Link>
              </p>
            </Card>
            <Card title="Voorraad">
              <p className={`text-2xl font-bold ${s.reorderCount > 0 ? "text-redbrown" : ""}`}>{`${s.reorderCount} bijbestellen`}</p>
              <p className="mt-1 text-lg text-ink/70">{`${count(s.openOrderCount, "levering", "leveringen")} onderweg`}</p>
              <p className="mt-3">
                <Link className={textLink} to="/beheer/voorraad">
                  Naar de voorraad
                </Link>
              </p>
            </Card>
          </div>
        )}
      </Loaded>
    </>
  );
}
