import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { DayReport, MonthReport, WeekReport } from "../shared/types";
import { ingestItems } from "../worker/db/sales";
import { api, asAdmin, asDevice, cashSale, resetData } from "./helpers";

let cookie: string;
let token: string;

// 27 July 2026 is a Monday, 2 August the Sunday of the same week.
beforeEach(async () => {
  await resetData();
  ({ cookie } = await asAdmin());
  const device = await asDevice();
  token = device.token;
  const on = (soldAt: string, qty: number) =>
    cashSale({ soldAt, totalCents: 110 * qty, lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty }] });
  const sales = [
    on("2026-07-26T10:00:00.000Z", 9), // the Sunday before: not this week
    on("2026-07-27T08:00:00.000Z", 1),
    on("2026-07-30T10:00:00.000Z", 2),
    on("2026-07-30T11:00:00.000Z", 1),
    on("2026-08-02T15:00:00.000Z", 3),
    on("2026-08-03T08:00:00.000Z", 7), // the Monday after: not this week
  ];
  await ingestItems(env.DB, device.deviceId, sales, new Date("2026-08-03T08:05:00.000Z"));
});

const kassa = (path: string) => api(path, { token });

it("gives the kassa the same day report as beheer", async () => {
  const forKassa = await (await kassa("/api/kassa/reports/day?date=2026-07-30")).json<DayReport>();
  expect(forKassa.totals).toEqual({ cashCents: 330, pinCents: 0, totalCents: 330, saleCount: 2 });
  expect(forKassa).toEqual(await (await api("/api/admin/reports/day?date=2026-07-30", { cookie })).json<DayReport>());
});

it("gives the kassa a week from Monday to Sunday, with its days", async () => {
  const week = await (await kassa("/api/kassa/reports/week?date=2026-07-30")).json<WeekReport>();
  expect(week.first).toBe("2026-07-27");
  expect(week.last).toBe("2026-08-02");
  expect(week.totals).toEqual({ cashCents: 770, pinCents: 0, totalCents: 770, saleCount: 4 });
  expect(week.days).toEqual([
    { date: "2026-07-27", cashCents: 110, pinCents: 0, totalCents: 110, saleCount: 1 },
    { date: "2026-07-30", cashCents: 330, pinCents: 0, totalCents: 330, saleCount: 2 },
    { date: "2026-08-02", cashCents: 330, pinCents: 0, totalCents: 330, saleCount: 1 },
  ]);
  expect(week.byCategory).toEqual([{ categoryId: "ijs", categoryName: "IJs", qty: 7, cashCents: 770, pinCents: 0, totalCents: 770 }]);
  expect(week.byProduct).toEqual([{ productId: "aardbeitje", name: "Aardbeitje", categoryName: "IJs", qty: 7, cashCents: 770, pinCents: 0, totalCents: 770 }]);
  // The same week whichever of its days is asked for.
  expect(await (await kassa("/api/kassa/reports/week?date=2026-08-02")).json()).toEqual(week);
});

it("keeps the month report of beheer as it was", async () => {
  const month = await (await api("/api/admin/reports/month?month=2026-07", { cookie })).json<MonthReport>();
  expect(month.totals).toEqual({ cashCents: 1430, pinCents: 0, totalCents: 1430, saleCount: 4 });
  expect(month.days.map((day) => day.date)).toEqual(["2026-07-26", "2026-07-27", "2026-07-30"]);
});

it("shows the reports only to a paired kassa, and only for a real date", async () => {
  expect((await api("/api/kassa/reports/day?date=2026-07-30")).status).toBe(401);
  expect((await api("/api/kassa/reports/week?date=2026-07-30")).status).toBe(401);
  expect((await kassa("/api/kassa/reports/day?date=2026-02-30")).status).toBe(400);
  expect((await kassa("/api/kassa/reports/week")).status).toBe(400);
});

it("gives the kassa no downloads", async () => {
  expect((await kassa("/api/kassa/reports/month.csv?month=2026-07&kind=days")).status).toBe(404);
  expect((await kassa("/api/admin/reports/month.csv?month=2026-07&kind=days")).status).toBe(401);
  expect((await kassa("/api/admin/export.json")).status).toBe(401);
});
