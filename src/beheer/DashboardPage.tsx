import { Link } from "react-router";
import { formatEuro } from "../../shared/money";
import { formatDateNl } from "../../shared/time";
import type { Summary } from "../../shared/types";
import { Card, Loaded, PageTitle, TotalsBlock, count, pillLink, textLink } from "./parts";
import { useAdminData } from "./useAdmin";

/** The first page of beheer: how today and this month stand, what should be in the cash box, what to order. */
export function DashboardPage() {
  const summary = useAdminData<Summary>("/api/admin/summary");
  return (
    <>
      <PageTitle>Overzicht</PageTitle>
      <Loaded from={summary}>
        {(s) => (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
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
