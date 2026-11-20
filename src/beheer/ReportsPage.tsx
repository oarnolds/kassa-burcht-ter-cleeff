import { useId } from "react";
import { Link, useSearchParams } from "react-router";
import { formatEuro } from "../../shared/money";
import { formatDateNl, monthOf } from "../../shared/time";
import type { DayReport, MonthReport } from "../../shared/types";
import { Button } from "../ui/Button";
import { Card, Loaded, PageTitle, TotalsBlock, field, pillLink, textLink, today } from "./parts";
import { useAdminData } from "./useAdmin";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const monthName = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" });

function shiftMonth(month: string, by: number): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, number! - 1 + by, 1)).toISOString().slice(0, 7);
}

const table = "w-full border-collapse text-sm sm:text-base";
const head = "px-1.5 py-2 text-left text-sm font-semibold text-ink/70 sm:px-3";
const cell = "px-1.5 py-2 sm:px-3";
// On a phone five columns do not fit: the number of sales per day gives way.
const wideOnly = "hidden sm:table-cell";
const amount = `${cell} text-right whitespace-nowrap tabular-nums`;
const amountHead = `${head} text-right`;

type Row = { key: string; name: string; qty: number; cashCents: number; pinCents: number; totalCents: number };

/** A titled table, wide enough tables scroll sideways on a phone. */
function TableSection({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-6 rounded-2xl bg-white p-3 shadow-sm sm:p-5">
      <h2 id={id} className="px-2 text-lg font-bold sm:px-3">
        {title}
      </h2>
      {note && <p className="px-2 text-ink/70 sm:px-3">{note}</p>}
      <div className="mt-2 overflow-x-auto">{children}</div>
    </section>
  );
}

/** Sales split by category or by product: how many, and how much in contant and in pin. */
function Breakdown({ title, first, rows }: { title: string; first: string; rows: Row[] }) {
  const sum = (pick: (row: Row) => number) => rows.reduce((total, row) => total + pick(row), 0);
  return (
    <TableSection title={title}>
      <table className={table}>
        <thead>
          <tr className="border-b-2 border-sand">
            <th className={head}>{first}</th>
            <th className={amountHead}>Aantal</th>
            <th className={amountHead}>Contant</th>
            <th className={amountHead}>Pin</th>
            <th className={amountHead}>Totaal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-sand">
              <td className={cell}>{row.name}</td>
              <td className={amount}>{row.qty}</td>
              <td className={amount}>{formatEuro(row.cashCents)}</td>
              <td className={amount}>{formatEuro(row.pinCents)}</td>
              <td className={amount}>{formatEuro(row.totalCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className={cell}>Samen</td>
            <td className={amount}>{sum((row) => row.qty)}</td>
            <td className={amount}>{formatEuro(sum((row) => row.cashCents))}</td>
            <td className={amount}>{formatEuro(sum((row) => row.pinCents))}</td>
            <td className={amount}>{formatEuro(sum((row) => row.totalCents))}</td>
          </tr>
        </tfoot>
      </table>
    </TableSection>
  );
}

function Breakdowns({ report }: { report: Pick<DayReport, "byCategory" | "byProduct"> }) {
  return (
    <>
      <Breakdown title="Per categorie" first="Categorie" rows={report.byCategory.map((row) => ({ ...row, key: row.categoryId, name: row.categoryName }))} />
      <Breakdown title="Per product" first="Product" rows={report.byProduct.map((row) => ({ ...row, key: row.productId }))} />
    </>
  );
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
                <TableSection title="Per dag" note="Leg de kolom Pin naast de uitbetalingen van Mollie.">
                  <table className={table}>
                    <thead>
                      <tr className="border-b-2 border-sand">
                        <th className={head}>Datum</th>
                        <th className={amountHead}>Contant</th>
                        <th className={amountHead}>Pin</th>
                        <th className={amountHead}>Totaal</th>
                        <th className={`${amountHead} ${wideOnly}`}>Verkopen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.days.map((day) => (
                        <tr key={day.date} className="border-b border-sand">
                          <td className={`${cell} whitespace-nowrap`}>
                            <Link className={textLink} to={`/beheer/rapporten?dag=${day.date}`}>
                              {formatDateNl(day.date)}
                            </Link>
                          </td>
                          <td className={amount}>{formatEuro(day.cashCents)}</td>
                          <td className={amount}>{formatEuro(day.pinCents)}</td>
                          <td className={amount}>{formatEuro(day.totalCents)}</td>
                          <td className={`${amount} ${wideOnly}`}>{day.saleCount}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-bold">
                        <td className={cell}>Hele maand</td>
                        <td className={amount}>{formatEuro(r.totals.cashCents)}</td>
                        <td className={amount}>{formatEuro(r.totals.pinCents)}</td>
                        <td className={amount}>{formatEuro(r.totals.totalCents)}</td>
                        <td className={`${amount} ${wideOnly}`}>{r.totals.saleCount}</td>
                      </tr>
                    </tfoot>
                  </table>
                </TableSection>
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
