import { useState } from "react";
import { Link } from "react-router";
import type { BalanceReport, MultiYearReport, ResultReport } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { Button } from "../../ui/Button";
import { Loaded, PageTitle, Section, amount, amountHead, cell, field, head, table, tableScroll, textLink, today } from "../parts";
import { useAdminData } from "../useAdmin";
import { AccountLinesPanel } from "./AccountLinesPanel";
import { EARLIER_YEARS_ROUTE, FIRST_LEDGER_YEAR, ledgerPath } from "./ledger-api";

const label = "flex flex-col gap-1 font-semibold";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Chosen = { code: string; name: string };

/** A row that opens the account's lines. */
function AccountRow({ code, name, onOpen, children }: Chosen & { onOpen(chosen: Chosen): void; children: React.ReactNode }) {
  return (
    <tr className="border-t border-sand">
      <td className={cell}>
        <button type="button" className="min-h-11 text-left font-semibold underline underline-offset-2" onClick={() => onOpen({ code, name })}>{`${code} ${name}`}</button>
      </td>
      {children}
    </tr>
  );
}

function Total({ name, cents }: { name: string; cents: number }) {
  return (
    <tr className="border-t-2 border-ink/30 font-bold">
      <td className={cell}>{name}</td>
      <td className={amount}>{formatEuro(cents)}</td>
    </tr>
  );
}

function BalanceView() {
  const [date, setDate] = useState(today());
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const valid = DATE.test(date);
  const report = useAdminData<BalanceReport>(valid ? ledgerPath.balance(date) : null);
  return (
    <>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className={label}>
          Peildatum
          <input type="date" className={field} value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>
      {!valid ? (
        <p className="mt-6 text-lg text-ink/70">Kies een datum.</p>
      ) : (
        <Loaded from={report}>
          {(data) => (
            <>
              {(
                [
                  ["Bezittingen", "asset"],
                  ["Schulden", "liability"],
                  ["Eigen vermogen", "equity"],
                ] as const
              ).map(([title, kind]) => (
                <Section key={kind} title={title}>
                  <div className={tableScroll}>
                    <table className={table}>
                      <tbody>
                        {data.rows
                          .filter((row) => row.kind === kind)
                          .map((row) => (
                            <AccountRow key={row.code} code={row.code} name={row.name} onOpen={setChosen}>
                              <td className={amount}>{formatEuro(row.cents)}</td>
                            </AccountRow>
                          ))}
                        {kind === "equity" && (
                          <tr className="border-t border-sand">
                            <td className={cell}>Resultaat nog niet geboekt</td>
                            <td className={amount}>{formatEuro(data.resultCents)}</td>
                          </tr>
                        )}
                        {kind === "asset" && <Total name="Totaal bezittingen" cents={data.assetsCents} />}
                        {kind === "equity" && <Total name="Totaal schulden en eigen vermogen" cents={data.liabilitiesAndEquityCents + data.resultCents} />}
                      </tbody>
                    </table>
                  </div>
                </Section>
              ))}
              {chosen && <AccountLinesPanel code={chosen.code} name={chosen.name} from={`${date.slice(0, 4)}-01-01`} to={date} />}
            </>
          )}
        </Loaded>
      )}
    </>
  );
}

function ResultView() {
  const [from, setFrom] = useState(`${today().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today());
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const valid = DATE.test(from) && DATE.test(to) && from <= to;
  const report = useAdminData<ResultReport>(valid ? ledgerPath.result(from, to) : null);
  const before = String(Number(from.slice(0, 4)) - 1);
  const cellOf = (cents: number | null) => <td className={amount}>{cents === null ? "" : formatEuro(cents)}</td>;
  return (
    <>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className={label}>
          Van
          <input type="date" className={field} value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className={label}>
          Tot
          <input type="date" className={field} value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
      {!valid ? (
        <p className="mt-6 text-lg text-ink/70">Kies een begin- en een einddatum, het begin niet na het einde.</p>
      ) : (
        <Loaded from={report}>
          {(data) => (
            <>
              <Section title="Winst en verlies">
                <div className={tableScroll}>
                  <table className={table}>
                    <thead>
                      <tr>
                        <th className={head}>Rekening</th>
                        <th className={amountHead}>Dit jaar</th>
                        <th className={amountHead}>{before}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ["Opbrengsten", "income"],
                          ["Kosten", "expense"],
                        ] as const
                      ).map(([title, kind]) => (
                        <FragmentRows key={kind} title={title}>
                          {data.rows
                            .filter((row) => row.kind === kind)
                            .map((row) => (
                              <AccountRow key={row.code} code={row.code} name={row.name} onOpen={setChosen}>
                                {cellOf(row.cents)}
                                {cellOf(row.previousCents)}
                              </AccountRow>
                            ))}
                        </FragmentRows>
                      ))}
                      <tr className="border-t-2 border-ink/30 font-bold">
                        <td className={cell}>Resultaat</td>
                        {cellOf(data.resultCents)}
                        {cellOf(data.previousResultCents)}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Section>
              {chosen && <AccountLinesPanel code={chosen.code} name={chosen.name} from={from} to={to} />}
            </>
          )}
        </Loaded>
      )}
    </>
  );
}

/**
 * The result per account with a column per year: the earlier years read from e-Boekhouden (marked so in the header)
 * next to every year of the books. Only the result: an earlier year has no balance in the app.
 */
function MultiYearView() {
  const report = useAdminData<MultiYearReport>(ledgerPath.multiYear);
  const cellOf = (cents: number | null, key: number) => (
    <td key={key} className={amount}>
      {cents === null ? "" : formatEuro(cents)}
    </td>
  );
  return (
    <Loaded from={report}>
      {(data) => (
        <Section title="Winst en verlies per jaar" note={`De jaren vóór ${FIRST_LEDGER_YEAR} komen uit e-Boekhouden en zijn alleen om te vergelijken.`}>
          <div className={tableScroll}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={head}>Rekening</th>
                  {data.years.map((year) => (
                    <th key={year} className={`${amountHead} align-bottom`}>
                      {year < FIRST_LEDGER_YEAR ? (
                        <>
                          {`${year} `}
                          <span className="block text-xs font-normal">uit e-Boekhouden</span>
                        </>
                      ) : (
                        year
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Opbrengsten", "income"],
                    ["Kosten", "expense"],
                  ] as const
                ).map(([title, kind]) => (
                  <FragmentRows key={kind} title={title} span={data.years.length + 1}>
                    {data.rows
                      .filter((row) => row.kind === kind)
                      .map((row) => (
                        <tr key={row.code} className="border-t border-sand">
                          <td className={cell}>{`${row.code} ${row.name}`}</td>
                          {row.cents.map((cents, i) => cellOf(cents, data.years[i]!))}
                        </tr>
                      ))}
                  </FragmentRows>
                ))}
                <tr className="border-t-2 border-ink/30 font-bold">
                  <td className={cell}>Resultaat</td>
                  {data.results.map((cents, i) => cellOf(cents, data.years[i]!))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 px-2 text-ink/70 sm:px-3">
            {"Een eerder jaar erbij: "}
            <Link to={EARLIER_YEARS_ROUTE} className={textLink}>
              Eerdere jaren
            </Link>
          </p>
        </Section>
      )}
    </Loaded>
  );
}

function FragmentRows({ title, span = 3, children }: { title: string; span?: number; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <th colSpan={span} scope="colgroup" className="px-1.5 pt-4 pb-1 text-left text-sm font-bold text-ink/70 sm:px-3">
          {title}
        </th>
      </tr>
      {children}
    </>
  );
}

/** The balance on a date, the result over a period with a way into the lines of an account, and the result per year. */
export function ReportsLedgerPage() {
  const [view, setView] = useState<"balance" | "result" | "years">("balance");
  return (
    <div>
      <PageTitle>Rapporten</PageTitle>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant={view === "balance" ? "primary" : "secondary"} aria-pressed={view === "balance"} onClick={() => setView("balance")}>
          Balans
        </Button>
        <Button variant={view === "result" ? "primary" : "secondary"} aria-pressed={view === "result"} onClick={() => setView("result")}>
          Winst en verlies
        </Button>
        <Button variant={view === "years" ? "primary" : "secondary"} aria-pressed={view === "years"} onClick={() => setView("years")}>
          Meerjarenoverzicht
        </Button>
      </div>
      {view === "balance" ? <BalanceView /> : view === "result" ? <ResultView /> : <MultiYearView />}
    </div>
  );
}
