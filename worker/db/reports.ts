import { formatAmount } from "../../shared/money";
import { businessDate, formatDateNl, localTime, monthOf, monthRange, weekRange } from "../../shared/time";
import type {
  AdminSale,
  CategoryRow,
  DayReport,
  MonthReport,
  ProductRow,
  Summary,
  Totals,
  WeekReport,
} from "../../shared/types";
import { toCsv } from "../lib/csv";
import { getCashState } from "./cash";
import { listCategories } from "./products";
import type { SaleRow } from "./sales";
import { listOrders, listStock } from "./stock";

// Only payments that went through count. A counter-entry is a sale row with negative amounts on the
// day it was made, so every sum below is simply a sum over the rows of the period.
const IN_PERIOD = "s.status = 'paid' AND s.business_date BETWEEN ?1 AND ?2";
const LINE_TOTAL = "l.unit_price_cents * l.qty";

const TOTALS = `
  COALESCE(SUM(CASE WHEN s.method = 'cash' THEN s.total_cents ELSE 0 END), 0) AS cash_cents,
  COALESCE(SUM(CASE WHEN s.method = 'pin' THEN s.total_cents ELSE 0 END), 0) AS pin_cents,
  COALESCE(SUM(s.total_cents), 0) AS total_cents,
  COALESCE(SUM(CASE WHEN s.reverses_sale_id IS NULL THEN 1 ELSE 0 END), 0) AS sale_count`;

const LINE_SUMS = `
  SUM(l.qty) AS qty,
  SUM(CASE WHEN s.method = 'cash' THEN ${LINE_TOTAL} ELSE 0 END) AS cash_cents,
  SUM(CASE WHEN s.method = 'pin' THEN ${LINE_TOTAL} ELSE 0 END) AS pin_cents,
  SUM(${LINE_TOTAL}) AS total_cents`;

const LINES_IN_PERIOD = `FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE ${IN_PERIOD}`;

type TotalsRow = { cash_cents: number; pin_cents: number; total_cents: number; sale_count: number };
type DayRow = TotalsRow & { business_date: string };
type CategorySumRow = { category_id: string; category_name: string; qty: number; cash_cents: number; pin_cents: number; total_cents: number };
type ProductSumRow = { product_id: string; name: string; category_name: string; qty: number; cash_cents: number; pin_cents: number; total_cents: number };

function toTotals(row: TotalsRow): Totals {
  return { cashCents: row.cash_cents, pinCents: row.pin_cents, totalCents: row.total_cents, saleCount: row.sale_count };
}

function totalsQuery(db: D1Database, first: string, last: string): D1PreparedStatement {
  return db.prepare(`SELECT ${TOTALS} FROM sales s WHERE ${IN_PERIOD}`).bind(first, last);
}

function daysQuery(db: D1Database, first: string, last: string): D1PreparedStatement {
  return db
    .prepare(`SELECT s.business_date, ${TOTALS} FROM sales s WHERE ${IN_PERIOD} GROUP BY s.business_date ORDER BY s.business_date`)
    .bind(first, last);
}

/** Per category and per product, under the names they had when they were sold. */
function breakdownQueries(db: D1Database, first: string, last: string): [D1PreparedStatement, D1PreparedStatement] {
  return [
    db
      .prepare(
        `SELECT l.category_id, l.category_name, ${LINE_SUMS}
         ${LINES_IN_PERIOD}
         GROUP BY l.category_id, l.category_name
         ORDER BY (SELECT c.sort FROM categories c WHERE c.id = l.category_id) IS NULL,
                  (SELECT c.sort FROM categories c WHERE c.id = l.category_id), l.category_name`,
      )
      .bind(first, last),
    db
      .prepare(
        `SELECT l.product_id, l.name, MAX(l.category_name) AS category_name, ${LINE_SUMS}
         ${LINES_IN_PERIOD}
         GROUP BY l.product_id, l.name
         ORDER BY total_cents DESC, l.name`,
      )
      .bind(first, last),
  ];
}

function toCategoryRows(rows: CategorySumRow[]): CategoryRow[] {
  return rows.map((row) => ({
    categoryId: row.category_id,
    categoryName: row.category_name,
    qty: row.qty,
    cashCents: row.cash_cents,
    pinCents: row.pin_cents,
    totalCents: row.total_cents,
  }));
}

function toProductRows(rows: ProductSumRow[]): ProductRow[] {
  return rows.map((row) => ({
    productId: row.product_id,
    name: row.name,
    categoryName: row.category_name,
    qty: row.qty,
    cashCents: row.cash_cents,
    pinCents: row.pin_cents,
    totalCents: row.total_cents,
  }));
}

export async function dayReport(db: D1Database, date: string): Promise<DayReport> {
  const [totals, byCategory, byProduct] = await db.batch([totalsQuery(db, date, date), ...breakdownQueries(db, date, date)]);
  return {
    date,
    totals: toTotals(totals!.results[0] as TotalsRow),
    byCategory: toCategoryRows(byCategory!.results as CategorySumRow[]),
    byProduct: toProductRows(byProduct!.results as ProductSumRow[]),
  };
}

/** A run of days: the totals, each day that had sales, and the breakdowns. */
async function periodReport(db: D1Database, first: string, last: string): Promise<Pick<MonthReport, "totals" | "days" | "byCategory" | "byProduct">> {
  const [totals, days, byCategory, byProduct] = await db.batch([
    totalsQuery(db, first, last),
    daysQuery(db, first, last),
    ...breakdownQueries(db, first, last),
  ]);
  return {
    totals: toTotals(totals!.results[0] as TotalsRow),
    days: (days!.results as DayRow[]).map((row) => ({ date: row.business_date, ...toTotals(row) })),
    byCategory: toCategoryRows(byCategory!.results as CategorySumRow[]),
    byProduct: toProductRows(byProduct!.results as ProductSumRow[]),
  };
}

export async function monthReport(db: D1Database, month: string): Promise<MonthReport> {
  const { first, last } = monthRange(month);
  return { month, ...(await periodReport(db, first, last)) };
}

/** The week (Monday to Sunday) that `date` falls in. */
export async function weekReport(db: D1Database, date: string): Promise<WeekReport> {
  const { first, last } = weekRange(date);
  return { first, last, ...(await periodReport(db, first, last)) };
}

/** The figures on the beheer start page. */
export async function summary(db: D1Database, now: Date): Promise<Summary> {
  const date = businessDate(now.toISOString());
  const month = monthOf(date);
  const { first, last } = monthRange(month);
  const [[today, thisMonth], cash, stock, openOrders] = await Promise.all([
    db.batch([totalsQuery(db, date, date), totalsQuery(db, first, last)]),
    getCashState(db),
    listStock(db),
    listOrders(db, "open"),
  ]);
  return {
    today: { date, ...toTotals(today!.results[0] as TotalsRow) },
    month: { month, ...toTotals(thisMonth!.results[0] as TotalsRow) },
    cashExpectedCents: cash.expectedCents,
    reorderCount: stock.filter((item) => item.belowReorder).length,
    openOrderCount: openOrders.length,
  };
}

/** Every sale and counter-entry of one day, in the order they were made. */
export async function listSales(db: D1Database, date: string): Promise<AdminSale[]> {
  const [sales, lines] = await db.batch([
    db
      .prepare(
        `SELECT s.*, EXISTS (SELECT 1 FROM sales r WHERE r.reverses_sale_id = s.id) AS reversed
         FROM sales s WHERE ${IN_PERIOD} ORDER BY s.sold_at, s.id`,
      )
      .bind(date, date),
    db
      .prepare(`SELECT l.sale_id, l.name, l.category_name, l.unit_price_cents, l.qty ${LINES_IN_PERIOD} ORDER BY l.id`)
      .bind(date, date),
  ]);
  const lineRows = lines!.results as { sale_id: string; name: string; category_name: string; unit_price_cents: number; qty: number }[];
  return (sales!.results as (SaleRow & { reversed: number })[]).map((sale) => ({
    id: sale.id,
    method: sale.method,
    totalCents: sale.total_cents,
    soldAt: sale.sold_at,
    soldAtLocal: localTime(sale.sold_at),
    businessDate: sale.business_date,
    late: sale.late === 1,
    reversed: sale.reversed === 1,
    reversesSaleId: sale.reverses_sale_id,
    reversalReason: sale.reversal_reason,
    lines: lineRows
      .filter((line) => line.sale_id === sale.id)
      .map((line) => ({ name: line.name, categoryName: line.category_name, unitPriceCents: line.unit_price_cents, qty: line.qty })),
  }));
}

/** One row per day with a column per category, and a totals row: the month as the bookkeeping wants it. */
export async function monthDaysCsv(db: D1Database, month: string): Promise<string> {
  const { first, last } = monthRange(month);
  const [categories, [totals, days, perDayCategory]] = await Promise.all([
    listCategories(db),
    db.batch([
      totalsQuery(db, first, last),
      daysQuery(db, first, last),
      db
        .prepare(
          `SELECT s.business_date, l.category_id, SUM(${LINE_TOTAL}) AS total_cents
           ${LINES_IN_PERIOD} GROUP BY s.business_date, l.category_id`,
        )
        .bind(first, last),
    ]),
  ]);
  const cell = new Map<string, number>();
  const monthTotal = new Map<string, number>();
  for (const row of perDayCategory!.results as { business_date: string; category_id: string; total_cents: number }[]) {
    cell.set(`${row.business_date}|${row.category_id}`, row.total_cents);
    monthTotal.set(row.category_id, (monthTotal.get(row.category_id) ?? 0) + row.total_cents);
  }
  const amounts = (row: TotalsRow) => [formatAmount(row.cash_cents), formatAmount(row.pin_cents), formatAmount(row.total_cents), row.sale_count];
  return toCsv([
    ["datum", "contant", "pin", "totaal", "aantal_verkopen", ...categories.map((category) => category.name)],
    ...(days!.results as DayRow[]).map((day) => [
      formatDateNl(day.business_date),
      ...amounts(day),
      ...categories.map((category) => formatAmount(cell.get(`${day.business_date}|${category.id}`) ?? 0)),
    ]),
    ["totaal", ...amounts(totals!.results[0] as TotalsRow), ...categories.map((category) => formatAmount(monthTotal.get(category.id) ?? 0))],
  ]);
}

/** One row per line of every sale and counter-entry of the month. */
export async function monthSalesCsv(db: D1Database, month: string): Promise<string> {
  const { first, last } = monthRange(month);
  const { results } = await db
    .prepare(
      `SELECT s.id, s.business_date, s.sold_at, s.method, s.reverses_sale_id, l.name, l.category_name, l.qty, l.unit_price_cents
       ${LINES_IN_PERIOD} ORDER BY s.sold_at, s.id, l.id`,
    )
    .bind(first, last)
    .all<{
      id: string;
      business_date: string;
      sold_at: string;
      method: "cash" | "pin";
      reverses_sale_id: string | null;
      name: string;
      category_name: string;
      qty: number;
      unit_price_cents: number;
    }>();
  return toCsv([
    ["datum", "tijd", "bon", "betaalwijze", "product", "categorie", "aantal", "stukprijs", "regeltotaal", "teruggedraaid_van"],
    ...results.map((row) => [
      formatDateNl(row.business_date),
      localTime(row.sold_at),
      row.id.slice(0, 8),
      row.method === "cash" ? "contant" : "pin",
      row.name,
      row.category_name,
      row.qty,
      formatAmount(row.unit_price_cents),
      formatAmount(row.unit_price_cents * row.qty),
      row.reverses_sale_id?.slice(0, 8) ?? "",
    ]),
  ]);
}
