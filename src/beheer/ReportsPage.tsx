import { Link, useSearchParams } from "react-router";
import { formatDateNl, monthOf } from "../../shared/time";
import type { DayReport, MonthReport } from "../../shared/types";
import { Button } from "../ui/Button";
import { Breakdowns, DaysTable } from "../reports/ReportTables";
import { Card, Loaded, PageTitle, TotalsBlock, field, pillLink, textLink, today } from "./parts";
import { useAdminData } from "./useAdmin";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const monthName = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" });

function shiftMonth(month: string, by: number): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, number! - 1 + by, 1)).toISOString().slice(0, 7);
}

function MonthView({ month }: { month: string }) {
  const [, setParams] = useSearchParams();
  const report = useAdminData<MonthReport>(`/api/admin/reports/month?month=${month}`);
  const open = (to: string) => setParams({ maand: to });
  const csv = (kind: string) => `/api/admin/reports/month.csv?month=${month}&kind=${kind}`;

  return (
    <>
      <PageTitle>Rapporten</PageTitle>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Button aria-label="Vorige maand" className="text-2xl leading-none" onClick={() => open(shiftMonth(month, -1))}>
          ‹
        </Button>
        <label className="flex flex-col gap-1 font-semibold">
          Maand
          {/* Not every browser has a month picker; where it is a plain text field, a complete `jjjj-mm` opens that month. */}
          <input
            key={month}
            className={field}
            type="month"
            placeholder="jjjj-mm"
            defaultValue={month}
            onChange={(event) => {
              if (MONTH.test(event.target.value)) open(event.target.value);
            }}
          />
        </label>
        <Button aria-label="Volgende maand" className="text-2xl leading-none" disabled={month >= monthOf(today())} onClick={() => open(shiftMonth(month, 1))}>
          ›
        </Button>
      </div>

      <Loaded from={report}>
        {(r) => (
          <>
            <Card className="mt-6" title={monthName.format(new Date(`${r.month}-01T00:00:00Z`))}>
              <TotalsBlock totals={r.totals} />
            </Card>
            {r.days.length === 0 ? (
              <p className="mt-6 text-lg text-ink/70">Geen verkopen in deze maand.</p>
            ) : (
              <>
                <DaysTable
                  days={r.days}
                  totals={r.totals}
                  totalLabel="Hele maand"
                  note="Leg de kolom Pin naast de uitbetalingen van Mollie."
                  dateCell={(date, label) => (
                    <Link className={textLink} to={`/beheer/rapporten?dag=${date}`}>
                      {label}
                    </Link>
                  )}
                />
                <Breakdowns report={r} />
              </>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <a className={pillLink} href={csv("days")} download>
                Download dagtotalen (CSV)
              </a>
              <a className={pillLink} href={csv("sales")} download>
                Download losse verkopen (CSV)
              </a>
            </div>
          </>
        )}
      </Loaded>
    </>
  );
}

function DayView({ date }: { date: string }) {
  const report = useAdminData<DayReport>(`/api/admin/reports/day?date=${date}`);
  return (
    <>
      <PageTitle>{formatDateNl(date)}</PageTitle>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link className={pillLink} to={`/beheer/rapporten?maand=${monthOf(date)}`}>
          Terug naar de maand
        </Link>
        <Link className={pillLink} to={`/beheer/verkopen?datum=${date}`}>
          Bekijk de verkopen van deze dag
        </Link>
      </div>
      <Loaded from={report}>
        {(r) => (
          <>
            <Card className="mt-6" title="Dagtotaal">
              <TotalsBlock totals={r.totals} />
            </Card>
            {r.byProduct.length === 0 ? <p className="mt-6 text-lg text-ink/70">Geen verkopen op deze dag.</p> : <Breakdowns report={r} />}
          </>
        )}
      </Loaded>
    </>
  );
}

/** Revenue for the bookkeeping: a month with its days, or one day, per category and per product. */
export function ReportsPage() {
  const [params] = useSearchParams();
  const day = params.get("dag");
  if (day && DATE.test(day)) return <DayView date={day} />;
  const asked = params.get("maand");
  return <MonthView month={asked && MONTH.test(asked) ? asked : monthOf(today())} />;
}
