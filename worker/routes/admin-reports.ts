import { Hono } from "hono";
import { dayReport, monthDaysCsv, monthReport, monthSalesCsv, summary } from "../db/reports";
import type { AppEnv } from "../env";
import { parseDate, parseMonth } from "../lib/params";

/** Beheer: the figures. Mounted behind `requireAdmin`. */
export const adminReports = new Hono<AppEnv>();

adminReports.get("/summary", async (c) => c.json(await summary(c.env.DB, new Date())));

adminReports.get("/reports/day", async (c) => {
  const date = parseDate(c.req.query("date"));
  if (!date) return c.json({ error: "invalid" }, 400);
  return c.json(await dayReport(c.env.DB, date));
});

adminReports.get("/reports/month", async (c) => {
  const month = parseMonth(c.req.query("month"));
  if (!month) return c.json({ error: "invalid" }, 400);
  return c.json(await monthReport(c.env.DB, month));
});

adminReports.get("/reports/month.csv", async (c) => {
  const month = parseMonth(c.req.query("month"));
  const kind = c.req.query("kind");
  if (!month || (kind !== "days" && kind !== "sales")) return c.json({ error: "invalid" }, 400);
  const csv = kind === "days" ? await monthDaysCsv(c.env.DB, month) : await monthSalesCsv(c.env.DB, month);
  const filename = `kassa-${month}-${kind === "days" ? "dagen" : "verkopen"}.csv`;
  return c.body(csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
});
