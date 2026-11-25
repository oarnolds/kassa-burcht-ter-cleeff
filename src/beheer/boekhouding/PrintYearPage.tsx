import { type ReactNode, useEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router";
import type { AccountKind, YearExport } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { Button } from "../../ui/Button";
import { Loaded, PageTitle, Section, amount, amountHead, cell, head, table, tableScroll } from "../parts";
import { useAdminData } from "../useAdmin";
import { ledgerPath } from "./ledger-api";
import { closedAt, dayMonthYear, dayOf } from "./year-labels";

const BALANCE_KINDS: [title: string, kind: AccountKind][] = [
  ["Bezittingen", "asset"],
  ["Schulden", "liability"],
  ["Eigen vermogen", "equity"],
];

const euroCell = (cents: number | null) => <td className={amount}>{cents === null ? "" : formatEuro(cents)}</td>;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <tr>
        <th colSpan={3} scope="colgroup" className="px-1.5 pt-4 pb-1 text-left text-sm font-bold text-ink/70 sm:px-3">
          {title}
        </th>
      </tr>
      {children}
    </>
  );
}

function TotalRow({ name, cents }: { name: string; cents: [number | null, number | null] }) {
  return (
    <tr className="border-t-2 border-ink/30 font-bold">
      <td className={cell}>{name}</td>
      {euroCell(cents[0])}
      {euroCell(cents[1])}
    </tr>
  );
}

/** The balance on 1 January and on 31 December, side by side. */
function Balance({ data }: { data: YearExport }) {
  const begin = new Map(data.opening.rows.map((row) => [row.code, row.cents]));
  const end = new Map(data.closing.rows.map((row) => [row.code, row.cents]));
  return (
    <Section title="Balans">
      <div className={tableScroll}>
        <table className={table}>
          <thead>
            <tr>
              <th className={head}>Rekening</th>
              <th className={amountHead}>{dayMonthYear(data.opening.date)}</th>
              <th className={amountHead}>{dayMonthYear(data.closing.date)}</th>
            </tr>
          </thead>
          <tbody>
            {BALANCE_KINDS.map(([title, kind]) => (
              <Group key={kind} title={title}>
                {data.accounts
                  .filter((account) => account.kind === kind && (begin.has(account.code) || end.has(account.code)))
                  .map((account) => (
                    <tr key={account.code} className="border-t border-sand">
                      <td className={cell}>{`${account.code} ${account.name}`}</td>
                      {euroCell(begin.get(account.code) ?? 0)}
                      {euroCell(end.get(account.code) ?? 0)}
                    </tr>
                  ))}
                {kind === "asset" && <TotalRow name="Totaal bezittingen" cents={[data.opening.assetsCents, data.closing.assetsCents]} />}
              </Group>
            ))}
            <tr className="border-t border-sand">
              <td className={cell}>Resultaat nog niet geboekt</td>
              {euroCell(data.opening.resultCents)}
              {euroCell(data.closing.resultCents)}
            </tr>
            <TotalRow
              name="Totaal schulden en eigen vermogen"
              cents={[data.opening.liabilitiesAndEquityCents + data.opening.resultCents, data.closing.liabilitiesAndEquityCents + data.closing.resultCents]}
            />
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** The result of the year next to the year before. */
function Result({ data }: { data: YearExport }) {
  const { result } = data;
  const hasPrevious = result.previousResultCents !== null;
  return (
    <Section title="Winst en verlies">
      <div className={tableScroll}>
        <table className={table}>
          <thead>
            <tr>
              <th className={head}>Rekening</th>
              <th className={amountHead}>{String(data.year)}</th>
              <th className={amountHead}>{String(data.year - 1)}</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Opbrengsten", "income"],
                ["Kosten", "expense"],
              ] as const
            ).map(([title, kind]) => {
              const rows = result.rows.filter((row) => row.kind === kind);
              const total = rows.reduce((sum, row) => sum + row.cents, 0);
              const totalBefore = rows.reduce((sum, row) => sum + (row.previousCents ?? 0), 0);
              return (
                <Group key={kind} title={title}>
                  {rows.map((row) => (
                    <tr key={row.code} className="border-t border-sand">
                      <td className={cell}>{`${row.code} ${row.name}`}</td>
                      {euroCell(row.cents)}
                      {euroCell(row.previousCents)}
                    </tr>
                  ))}
                  <TotalRow name={`Totaal ${title.toLowerCase()}`} cents={[total, hasPrevious ? totalBefore : null]} />
                </Group>
              );
            })}
            <TotalRow name="Resultaat" cents={[result.resultCents, result.previousResultCents]} />
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** Opens the print dialog once, as soon as the overview is on screen. */
function PrintOnce({ when }: { when: boolean }) {
  const done = useRef(false);
  useEffect(() => {
    if (!when || done.current) return;
    done.current = true;
    window.print();
  }, [when]);
  return null;
}

/**
 * The jaaroverzicht on paper (spec §13): the balance at the start and the end of the year and the result next to the
 * year before; "Bewaar als PDF" in the print dialog makes the PDF. An open year says Voorlopig. Opened by the PDF
 * button with `?print=1`, it opens the print dialog itself. The menus and the button stay off the paper.
 */
export function PrintYearPage() {
  const { year: param = "" } = useParams();
  const [search] = useSearchParams();
  const year = /^\d{4}$/.test(param) ? Number(param) : null;
  const overview = useAdminData<YearExport>(year === null ? null : ledgerPath.yearExport(year));
  if (year === null) return <PageTitle>Dit jaar bestaat niet</PageTitle>;
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle>{`Jaaroverzicht ${year}`}</PageTitle>
        <Button className="print:hidden" onClick={() => window.print()}>
          Afdrukken
        </Button>
      </div>
      <Loaded from={overview}>
        {(data) => {
          const closed = closedAt(data.status, data.events);
          return (
            <>
              {data.status === "open" ? (
                <p className="mt-1 text-xl font-bold text-redbrown">Voorlopig</p>
              ) : (
                closed && <p className="mt-1 text-ink/70">{`Afgesloten op ${dayOf(closed)}`}</p>
              )}
              {data.notes.map((note) => (
                <p key={note} className="mt-1 text-ink/70">
                  {note}
                </p>
              ))}
              <Balance data={data} />
              <Result data={data} />
              <PrintOnce when={search.get("print") === "1"} />
            </>
          );
        }}
      </Loaded>
    </div>
  );
}
