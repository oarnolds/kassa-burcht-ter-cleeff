// "Downloaden als Excel" on the Begroting page: the grid of a year's budget as an .xlsx file. This module and fflate
// are loaded with import() only when the button is pressed.

import type { Budget } from "../../../shared/budget";
import type { LedgerAccount } from "../../../shared/ledger-types";
import { MONTH_SHORT, budgetGrid, sourceText, type GridRow } from "./budget-grid";
import { type Cell, bold, euro, writeXlsx } from "./xlsx";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The budget of a year as one sheet: a row per account, a column per month and the year, grouped with totals. */
export function budgetWorkbook(budget: Budget, accounts: LedgerAccount[]): Blob {
  const grid = budgetGrid(budget.lines, accounts);
  const line = (row: GridRow): Cell[] => [`${row.account.code} ${row.account.name}`, ...row.months.map((cents) => euro(cents))];
  const total = (name: string, months: number[]): Cell[] => [bold(name), ...months.map((cents) => euro(cents, true))];
  const source = sourceText(budget.source);
  const rows: Cell[][] = [
    [bold(`Begroting ${budget.year}`)],
    ...(source ? [[source]] : []),
    [],
    [bold("Rekening"), ...MONTH_SHORT.map(bold), bold("Totaal")],
    [bold("Opbrengsten")],
    ...grid.income.map(line),
    total("Totaal opbrengsten", grid.incomeTotal),
    [],
    [bold("Kosten")],
    ...grid.costs.map(line),
    total("Totaal kosten", grid.costsTotal),
    [],
    total("Resultaat", grid.result),
  ];
  const sheet = { name: `Begroting ${budget.year}`, widths: [44, ...MONTH_SHORT.map(() => 11), 13], rows };
  return new Blob([writeXlsx([sheet]) as BlobPart], { type: XLSX_TYPE });
}
