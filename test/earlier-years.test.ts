import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { EntryLine } from "../shared/ledger-types";
import { createEntry } from "../worker/db/ledger";
import { comparisonYears, multiYearReport, setComparison } from "../worker/db/ledger-reports";
import { api, asAdmin, meteredDb, resetData } from "./helpers";

let cookie: string;
beforeEach(async () => {
  await resetData();
  // These tests lay 2027 next to the earlier years, as when it was the first year: the seed also holds an empty 2026.
  await env.DB.prepare("DELETE FROM ledger_years WHERE year = 2026").run();
  cookie = (await asAdmin()).cookie;
});

const NOW = new Date("2028-03-01T12:00:00.000Z");
const move = (debit: string, credit: string, cents: number): EntryLine[] => [
  { accountCode: debit, amountCents: cents, note: null, assetId: null },
  { accountCode: credit, amountCents: -cents, note: null, assetId: null },
];
const book = (date: string, lines: EntryLine[]) => createEntry(env.DB, { date, description: "Boeking", source: "manual", lines }, NOW);
const base = "/api/admin/boekhouding";

it("lists every year with comparison figures, with its income, costs and result", async () => {
  expect(await (await api(`${base}/comparison/years`, { cookie })).json()).toEqual([]);
  await setComparison(env.DB, 2025, [
    { accountCode: "8000", amountCents: 375050 },
    { accountCode: "8025", amountCents: -25000 },
    { accountCode: "4302", amountCents: 483948 },
  ]);
  await setComparison(env.DB, 2024, [{ accountCode: "4301", amountCents: 120000 }]);
  const answer = await api(`${base}/comparison/years`, { cookie });
  expect(answer.status).toBe(200);
  expect(await answer.json()).toEqual([
    { year: 2024, incomeCents: 0, costsCents: 120000, resultCents: -120000 },
    { year: 2025, incomeCents: 350050, costsCents: 483948, resultCents: 350050 - 483948 },
  ]);
  const metered = meteredDb(env.DB);
  await comparisonYears(metered.db);
  expect(metered.calls()).toBe(1);
});

it("lays the earlier years from e-Boekhouden next to the app's years, the closing entry left out", async () => {
  await setComparison(env.DB, 2025, [
    { accountCode: "8010", amountCents: 50000 },
    { accountCode: "4301", amountCents: 120000 },
    { accountCode: "8025", amountCents: -2500 },
  ]);
  await book("2027-03-10", move("1010", "8010", 70000));
  await book("2027-04-10", move("4308", "1010", 30000));
  await book("2027-05-10", move("1010", "1011", 99999)); // money between own accounts: not in the result
  await createEntry(env.DB, { date: "2027-12-31", description: "Afsluiting", source: "closing", lines: [...move("8010", "1400", 70000), ...move("1400", "4308", 30000)] }, NOW);

  const answer = await api(`${base}/reports/years`, { cookie });
  expect(answer.status).toBe(200);
  expect(await answer.json()).toEqual({
    years: [2025, 2027],
    rows: [
      { code: "4301", name: "Huur", kind: "expense", cents: [120000, null] },
      { code: "4308", name: "Energie", kind: "expense", cents: [null, 30000] },
      { code: "8010", name: "Verhuur", kind: "income", cents: [50000, 70000] },
      { code: "8025", name: "Donaties", kind: "income", cents: [-2500, null] },
    ],
    results: [50000 - 2500 - 120000, 70000 - 30000],
  });
});

it("shows a ledger year with nothing on it yet as empty, and no earlier years when none were read", async () => {
  expect(await multiYearReport(env.DB)).toEqual({ years: [2027], rows: [], results: [null] });
});

it("reads every year in one call to the database, however many there are", async () => {
  await setComparison(env.DB, 2025, [{ accountCode: "8010", amountCents: 100 }]);
  await book("2027-03-10", move("1010", "8010", 700));
  const few = meteredDb(env.DB);
  expect((await multiYearReport(few.db)).years).toEqual([2025, 2027]);

  for (const year of [2020, 2021, 2022]) await setComparison(env.DB, year, [{ accountCode: "4301", amountCents: year }]);
  await book("2028-02-10", move("1010", "8010", 300));
  const many = meteredDb(env.DB);
  const report = await multiYearReport(many.db);
  expect(report.years).toEqual([2020, 2021, 2022, 2025, 2027, 2028]);
  expect(report.results).toEqual([-2020, -2021, -2022, 100, 700, 300]);
  expect(many.calls()).toBe(few.calls());
  expect(many.calls()).toBe(1);
});
