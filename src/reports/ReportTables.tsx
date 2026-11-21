import type { ReactNode } from "react";
import { formatEuro } from "../../shared/money";
import { formatDateNl } from "../../shared/time";
import type { DayReport, Totals } from "../../shared/types";
import { Section, amount, amountHead, cell, head, table, tableScroll } from "../beheer/parts";

// The tables of a revenue report. Beheer's Rapporten and the kassa's Omzet show the same figures with them.

// On a phone five columns do not fit: the number of sales per day gives way.
const wideOnly = "hidden sm:table-cell";

type Row = { key: string; name: string; qty: number; cashCents: number; pinCents: number; totalCents: number };

function TableSection({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Section title={title} note={note}>
      <div className={tableScroll}>{children}</div>
    </Section>
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

/** Per category and per product. */
export function Breakdowns({ report }: { report: Pick<DayReport, "byCategory" | "byProduct"> }) {
  return (
    <>
      <Breakdown title="Per categorie" first="Categorie" rows={report.byCategory.map((row) => ({ ...row, key: row.categoryId, name: row.categoryName }))} />
      <Breakdown title="Per product" first="Product" rows={report.byProduct.map((row) => ({ ...row, key: row.productId }))} />
    </>
  );
}

type DaysProps = {
  days: ({ date: string } & Totals)[];
  totals: Totals;
  /** The name of the bottom row: "Hele maand", "Hele week". */
  totalLabel: string;
  note?: string;
  /** How a date opens its day: a link in beheer, a button on the kassa. */
  dateCell: (date: string, label: string) => ReactNode;
};

/** One row per day that had sales, and the period's totals under them. */
export function DaysTable({ days, totals, totalLabel, note, dateCell }: DaysProps) {
  return (
    <TableSection title="Per dag" note={note}>
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
          {days.map((day) => (
            <tr key={day.date} className="border-b border-sand">
              <td className={`${cell} whitespace-nowrap`}>{dateCell(day.date, formatDateNl(day.date))}</td>
              <td className={amount}>{formatEuro(day.cashCents)}</td>
              <td className={amount}>{formatEuro(day.pinCents)}</td>
              <td className={amount}>{formatEuro(day.totalCents)}</td>
              <td className={`${amount} ${wideOnly}`}>{day.saleCount}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td className={cell}>{totalLabel}</td>
            <td className={amount}>{formatEuro(totals.cashCents)}</td>
            <td className={amount}>{formatEuro(totals.pinCents)}</td>
            <td className={amount}>{formatEuro(totals.totalCents)}</td>
            <td className={`${amount} ${wideOnly}`}>{totals.saleCount}</td>
          </tr>
        </tfoot>
      </table>
    </TableSection>
  );
}
