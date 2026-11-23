import { Link } from "react-router";
import type { AccountLines } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { formatDateNl } from "../../../shared/time";
import { Loaded, Section, amount, amountHead, cell, head, table, tableScroll, textLink } from "../parts";
import { useAdminData } from "../useAdmin";
import { entryRoute, ledgerPath } from "./ledger-api";

/** The lines on one account in a period, under a report. */
export function AccountLinesPanel({ code, name, from, to }: { code: string; name: string; from: string; to: string }) {
  const lines = useAdminData<AccountLines>(ledgerPath.accountLines(code, from, to));
  return (
    <Loaded from={lines}>
      {(data) => (
        <Section title={`${code} ${name}, ${formatDateNl(from)} t/m ${formatDateNl(to)}`}>
          <div className={tableScroll}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={head}>Nr</th>
                  <th className={head}>Datum</th>
                  <th className={head}>Omschrijving</th>
                  <th className={amountHead}>Bedrag</th>
                  <th className={amountHead}>Stand</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-sand">
                  <td className={cell} colSpan={4}>
                    Begin
                  </td>
                  <td className={amount}>{formatEuro(data.openingCents)}</td>
                </tr>
                {data.lines.map((line, index) => (
                  <tr key={index} className="border-t border-sand">
                    <td className={`${cell} tabular-nums`}>{line.number}</td>
                    <td className={`${cell} whitespace-nowrap tabular-nums`}>{formatDateNl(line.date)}</td>
                    <td className={cell}>
                      <Link className={`${textLink} inline-flex min-h-11 items-center`} to={entryRoute(line.entryId)}>
                        {line.description}
                      </Link>
                    </td>
                    <td className={amount}>{formatEuro(line.amountCents)}</td>
                    <td className={amount}>{formatEuro(line.runningCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </Loaded>
  );
}
