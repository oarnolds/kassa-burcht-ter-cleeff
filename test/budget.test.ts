import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { Budget, BudgetLine, BudgetRule } from "../shared/budget";
import type { EntryLine } from "../shared/ledger-types";
import { budgetActuals, getBudget, putBudget, putBudgetLine } from "../worker/db/budget";
import { createEntry } from "../worker/db/ledger";
import { api, asAdmin, meteredDb, resetData } from "./helpers";

let cookie: string;
beforeEach(async () => {
  await resetData();
  cookie = (await asAdmin()).cookie;
});

const base = "/api/admin/boekhouding";
/** Today for the calls made straight to the database: the budget years are then 2027 and 2028. */
const NOW = new Date("2026-11-24T12:00:00.000Z");

/** Twelve months with whole euros in the given months (1 to 12). */
const at = (pairs: Record<number, number>): number[] => Array.from({ length: 12 }, (_, i) => (pairs[i + 1] ?? 0) * 100);
const every = (euros: number): number[] => Array(12).fill(euros * 100);

const SOURCE = { kind: "mutations", baseYear: 2026, from: "2026-01-02", to: "2026-11-20" } as const;
const RENT = at({ 1: 1153, 2: 208, 4: 1153, 7: 1182, 10: 1182 });

const send = (method: string, path: string, json?: unknown) => api(`${base}${path}`, { method, cookie, json });
const read = async (year: number): Promise<Budget> => (await send("GET", `/budget?year=${year}`)).json();
const refusal = async (answer: Response) => ({ status: answer.status, error: ((await answer.json()) as { error: string }).error });

it("makes a year's budget: the Worker works out the months, the lines come in the order of the chart", async () => {
  const answer = await send("PUT", "/budget?year=2027", {
    source: SOURCE,
    lines: [
      { accountCode: "8010", rule: { kind: "pattern", amountCents: 600000 }, base: RENT },
      { accountCode: "4308", rule: { kind: "monthly", amountCents: 3100 }, base: every(31) },
      { accountCode: "4310", rule: { kind: "quarterly", amountCents: 50200, month: 1 }, base: at({ 4: 502, 7: 502, 10: 502 }) },
      { accountCode: "4601", rule: { kind: "yearly", amountCents: 123500, month: 12 }, base: null },
      { accountCode: "4514", rule: { kind: "custom", months: at({ 2: 10, 3: -5 }) } },
    ],
  });
  expect(answer.status).toBe(200);
  const expected: Budget = {
    year: 2027,
    source: SOURCE,
    lines: [
      { accountCode: "4308", rule: { kind: "monthly", amountCents: 3100 }, base: every(31), months: every(31) },
      { accountCode: "4310", rule: { kind: "quarterly", amountCents: 50200, month: 1 }, base: at({ 4: 502, 7: 502, 10: 502 }), months: at({ 1: 502, 4: 502, 7: 502, 10: 502 }) },
      { accountCode: "4514", rule: { kind: "custom", months: at({ 2: 10, 3: -5 }) }, base: null, months: at({ 2: 10, 3: -5 }) },
      { accountCode: "4601", rule: { kind: "yearly", amountCents: 123500, month: 12 }, base: null, months: at({ 12: 1235 }) },
      { accountCode: "8010", rule: { kind: "pattern", amountCents: 600000 }, base: RENT, months: at({ 1: 1418, 2: 256, 4: 1418, 7: 1454, 10: 1454 }) },
    ],
  };
  expect(await answer.json()).toEqual(expected);
  expect(await read(2027)).toEqual(expected);
  // Another year is apart.
  expect(await read(2028)).toEqual({ year: 2028, source: null, lines: [] });
});

it("replaces the whole year when it is made again", async () => {
  await send("PUT", "/budget?year=2027", { source: SOURCE, lines: [{ accountCode: "4308", rule: { kind: "monthly", amountCents: 3100 }, base: null }] });
  const again = await send("PUT", "/budget?year=2027", {
    source: { kind: "ledger", baseYear: 2026, from: "2026-01-01", to: "2026-06-30" },
    lines: [{ accountCode: "8012", rule: { kind: "yearly", amountCents: 100000, month: 7 }, base: null }],
  });
  expect(again.status).toBe(200);
  expect(await read(2027)).toEqual({
    year: 2027,
    source: { kind: "ledger", baseYear: 2026, from: "2026-01-01", to: "2026-06-30" },
    lines: [{ accountCode: "8012", rule: { kind: "yearly", amountCents: 100000, month: 7 }, base: null, months: at({ 7: 1000 }) }],
  });
  const emptied = await send("PUT", "/budget?year=2027", { source: { kind: "empty", baseYear: null, from: null, to: null }, lines: [] });
  expect(emptied.status).toBe(200);
  expect(await read(2027)).toEqual({ year: 2027, source: { kind: "empty", baseYear: null, from: null, to: null }, lines: [] });
});

it("adds or changes one line; a changed line keeps its base, a new one has none", async () => {
  await send("PUT", "/budget?year=2027", { source: SOURCE, lines: [{ accountCode: "4301", rule: { kind: "pattern", amountCents: 487800 }, base: RENT }] });

  const monthly = await send("PUT", "/budget/line?year=2027&account=4301", { rule: { kind: "monthly", amountCents: 41000 } });
  expect(monthly.status).toBe(200);
  expect(await monthly.json()).toEqual({ accountCode: "4301", rule: { kind: "monthly", amountCents: 41000 }, base: RENT, months: every(410) });
  // Back to "like the base": the base is still there.
  const back = await send("PUT", "/budget/line?year=2027&account=4301", { rule: { kind: "pattern", amountCents: 487800 } });
  expect(((await back.json()) as BudgetLine).months).toEqual(RENT);

  const added = await send("PUT", "/budget/line?year=2027&account=4501", { rule: { kind: "yearly", amountCents: -29300, month: 5 }, base: every(1) });
  expect(await added.json()).toEqual({ accountCode: "4501", rule: { kind: "yearly", amountCents: -29300, month: 5 }, base: null, months: at({ 5: -293 }) });
  expect(await refusal(await send("PUT", "/budget/line?year=2027&account=4501", { rule: { kind: "pattern", amountCents: 100 } }))).toEqual({ status: 400, error: "no_pattern" });

  const budget = await read(2027);
  expect(budget.source).toEqual(SOURCE);
  expect(budget.lines.map((line) => [line.accountCode, line.rule.kind])).toEqual([
    ["4301", "pattern"],
    ["4501", "yearly"],
  ]);
  // A line in a year without a budget yet: the year has lines, not a source.
  await send("PUT", "/budget/line?year=2028&account=8030", { rule: { kind: "monthly", amountCents: 100 } });
  expect(await read(2028)).toMatchObject({ source: null, lines: [{ accountCode: "8030" }] });
});

it("takes one line out, or the whole year with its source", async () => {
  await send("PUT", "/budget?year=2027", {
    source: SOURCE,
    lines: [
      { accountCode: "4308", rule: { kind: "monthly", amountCents: 3100 }, base: null },
      { accountCode: "8010", rule: { kind: "monthly", amountCents: 10000 }, base: null },
    ],
  });
  await send("PUT", "/budget?year=2028", { source: SOURCE, lines: [{ accountCode: "4308", rule: { kind: "monthly", amountCents: 100 }, base: null }] });
  const one = await send("DELETE", "/budget/line?year=2027&account=4308");
  expect(one.status).toBe(200);
  expect((await read(2027)).lines.map((line) => line.accountCode)).toEqual(["8010"]);
  // A line that is not there: nothing to take out.
  expect((await send("DELETE", "/budget/line?year=2027&account=4308")).status).toBe(200);

  const all = await send("DELETE", "/budget?year=2027");
  expect(all.status).toBe(200);
  expect(await read(2027)).toEqual({ year: 2027, source: null, lines: [] });
  expect((await read(2028)).lines).toHaveLength(1);
});

it("refuses a year outside the budget years, and a malformed one", async () => {
  for (const year of [2026, 3000]) {
    for (const [method, path, json] of [
      ["GET", `/budget?year=${year}`],
      ["PUT", `/budget?year=${year}`, { source: SOURCE, lines: [] }],
      ["PUT", `/budget/line?year=${year}&account=4308`, { rule: { kind: "monthly", amountCents: 100 } }],
      ["DELETE", `/budget/line?year=${year}&account=4308`],
      ["DELETE", `/budget?year=${year}`],
    ] as [string, string, unknown?][]) {
      expect(await refusal(await send(method, path, json)), `${method} ${path}`).toEqual({ status: 400, error: "not_budget_year" });
    }
  }
  expect(await refusal(await send("GET", "/budget?year=twee"))).toEqual({ status: 400, error: "invalid" });
  expect(await refusal(await send("GET", "/budget"))).toEqual({ status: 400, error: "invalid" });
  // The years run to the year after today.
  await expect(getBudget(env.DB, 2029, NOW)).rejects.toMatchObject({ code: "not_budget_year" });
  expect((await getBudget(env.DB, 2029, new Date("2028-01-01T12:00:00.000Z"))).year).toBe(2029);
});

it("refuses an account that is not there, not a result account, or twice; and a rule it cannot take; and writes nothing then", async () => {
  const line = (accountCode: string, rule: unknown, more: object = {}) => ({ accountCode, rule, base: null, ...more });
  const monthly = { kind: "monthly", amountCents: 100 };
  // A budget that is there already: a refusal leaves it as it is, its source included.
  await send("PUT", "/budget?year=2027", {
    source: SOURCE,
    lines: [line("4308", { kind: "monthly", amountCents: 3100 }), line("8010", { kind: "pattern", amountCents: 600000 }, { base: RENT })],
  });
  const before = await read(2027);
  expect(before.lines).toHaveLength(2);
  const unchanged = async (what: string) => expect(await read(2027), what).toEqual(before);
  const other = { kind: "ledger", baseYear: 2026, from: "2026-01-01", to: "2026-06-30" };
  const cases: [unknown[], string][] = [
    [[line("4308", monthly), line("9999", monthly)], "unknown_account"],
    [[line("1010", monthly)], "not_result_account"],
    [[line("1400", monthly)], "not_result_account"],
    [[line("4308", monthly), line("4308", { kind: "yearly", amountCents: 100, month: 1 })], "duplicate_account"],
    [[line("4308", { kind: "quarterly", amountCents: 100, month: 4 })], "invalid_rule"],
    [[line("4308", { kind: "custom", months: [100] })], "invalid_rule"],
    [[line("4308", { kind: "monthly", amountCents: 2_000_000_000 })], "invalid_rule"],
    [[line("4308", { kind: "monthly", amountCents: 3150 })], "not_whole_euros"],
    [[line("4308", { kind: "pattern", amountCents: 100 })], "no_pattern"],
    [[line("4308", { kind: "pattern", amountCents: 100 }, { base: at({ 1: 5, 2: -5 }) })], "no_pattern"],
  ];
  for (const [lines, error] of cases) {
    // Another source and a first line that would do: nothing of it may stay when a later line is refused.
    expect(await refusal(await send("PUT", "/budget?year=2027", { source: other, lines })), error).toEqual({ status: 400, error });
    await unchanged(`whole year, ${error}`);
  }
  for (const body of [
    { source: SOURCE },
    { source: other, lines: [line("4308", monthly, { base: [1, 2] })] },
    { source: { kind: "elders" }, lines: [] },
  ]) {
    expect(await refusal(await send("PUT", "/budget?year=2027", body))).toEqual({ status: 400, error: "invalid" });
    await unchanged(`whole year, ${JSON.stringify(body)}`);
  }

  const lineCases: [string, unknown, string][] = [
    ["account=9999", { rule: monthly }, "unknown_account"],
    ["account=1010", { rule: monthly }, "not_result_account"],
    ["account=4308", { rule: { kind: "monthly", amountCents: 1 } }, "not_whole_euros"],
    ["account=4308", { rule: { kind: "weekly" } }, "invalid_rule"],
    ["account=4308", {}, "invalid_rule"],
    ["account=4308", { rule: { kind: "pattern", amountCents: 100 } }, "no_pattern"],
    ["", { rule: monthly }, "unknown_account"],
  ];
  for (const [query, body, error] of lineCases) {
    expect(await refusal(await send("PUT", `/budget/line?year=2027&${query}`, body)), `${query} ${error}`).toEqual({ status: 400, error });
    await unchanged(`line, ${query} ${error}`);
  }
});

it("refuses a source that does not fit the year, and keeps the budget that was there", async () => {
  await send("PUT", "/budget?year=2027", { source: SOURCE, lines: [{ accountCode: "4308", rule: { kind: "monthly", amountCents: 3100 }, base: null }] });
  const before = await read(2027);
  const lines = [{ accountCode: "8010", rule: { kind: "monthly", amountCents: 100 }, base: null }];
  const sources = [
    // A proposal without its year or its dates.
    { kind: "mutations", baseYear: null, from: "2026-01-02", to: "2026-11-20" },
    { kind: "mutations", baseYear: 2026, from: null, to: "2026-11-20" },
    { kind: "mutations", baseYear: 2026, from: "2026-01-02", to: null },
    { kind: "ledger", baseYear: null, from: null, to: null },
    // Dates the wrong way round, or outside its year.
    { kind: "mutations", baseYear: 2026, from: "2026-11-20", to: "2026-01-02" },
    { kind: "mutations", baseYear: 2026, from: "2025-12-31", to: "2026-11-20" },
    { kind: "ledger", baseYear: 2026, from: "2026-01-01", to: "2027-01-01" },
    // The year of the budget itself, or later.
    { kind: "mutations", baseYear: 2027, from: "2027-01-02", to: "2027-11-20" },
    { kind: "ledger", baseYear: 2028, from: "2028-01-01", to: "2028-03-01" },
    // An empty start has none of them.
    { kind: "empty", baseYear: 2026, from: null, to: null },
    { kind: "empty", baseYear: null, from: "2026-01-01", to: null },
    { kind: "empty", baseYear: null, from: null, to: "2026-12-31" },
  ];
  for (const source of sources) {
    expect(await refusal(await send("PUT", "/budget?year=2027", { source, lines })), JSON.stringify(source)).toEqual({ status: 400, error: "invalid_source" });
    expect(await read(2027), JSON.stringify(source)).toEqual(before);
  }
  // A source of an earlier year than the one before is fine; an empty start too.
  const earlier = { kind: "mutations", baseYear: 2026, from: "2026-01-01", to: "2026-12-31" };
  expect((await send("PUT", "/budget?year=2028", { source: earlier, lines })).status).toBe(200);
  expect((await send("PUT", "/budget?year=2027", { source: { kind: "empty", baseYear: null, from: null, to: null }, lines: [] })).status).toBe(200);
});

it("refuses a rule that gives a month beyond the limit, as one like a base that nearly adds up to nothing can", async () => {
  const thin = at({ 1: 1000, 2: -999 });
  await send("PUT", "/budget?year=2027", { source: SOURCE, lines: [{ accountCode: "4308", rule: { kind: "pattern", amountCents: 100 }, base: thin }] });
  const before = await read(2027);
  expect(before.lines[0]!.months).toEqual(thin);
  // € 20.000 spread like it: a January of € 20.000.000.
  const large = { kind: "pattern", amountCents: 2_000_000 };
  expect(await refusal(await send("PUT", "/budget?year=2027", { source: SOURCE, lines: [{ accountCode: "4308", rule: large, base: thin }] }))).toEqual({
    status: 400,
    error: "invalid_rule",
  });
  expect(await read(2027)).toEqual(before);
  expect(await refusal(await send("PUT", "/budget/line?year=2027&account=4308", { rule: large }))).toEqual({ status: 400, error: "invalid_rule" });
  expect(await read(2027)).toEqual(before);
  // € 10.000 gives a January of exactly the limit: that is still allowed.
  const edge = await send("PUT", "/budget/line?year=2027&account=4308", { rule: { kind: "pattern", amountCents: 1_000_000 } });
  expect(edge.status).toBe(200);
  expect(((await edge.json()) as BudgetLine).months).toEqual(at({ 1: 10_000_000, 2: -9_990_000 }));
});

const move = (debit: string, credit: string, cents: number): EntryLine[] => [
  { accountCode: debit, amountCents: cents, note: null, assetId: null },
  { accountCode: credit, amountCents: -cents, note: null, assetId: null },
];
const BOOKED = new Date("2029-03-01T12:00:00.000Z");
const book = (date: string, lines: EntryLine[], source: "manual" | "closing" = "manual") =>
  createEntry(env.DB, { date, description: "Boeking", source, sourceRef: source === "closing" ? date.slice(0, 4) : null, lines }, BOOKED);

it("gives a year of the books per account and month as the report shows it, the closing entry left out", async () => {
  await book("2027-03-10", move("1010", "8010", 70000));
  await book("2027-04-10", move("4308", "1010", 30000));
  await book("2027-04-28", move("4308", "1010", 5000));
  await book("2027-05-02", move("1010", "4308", 1200)); // a refund
  await book("2027-06-30", move("1010", "1011", 99999)); // money between own accounts
  await book("2027-07-01", move("1010", "8030", 0 + 300));
  await book("2027-09-15", move("1080", "1010", 400)); // balance only, later than the last result line
  await book("2027-12-31", [...move("8010", "1400", 70000), ...move("8030", "1400", 300), ...move("1400", "4308", 33800)], "closing");
  await book("2028-01-15", move("4308", "1010", 100));

  const answer = await send("GET", "/budget/actuals?year=2027");
  expect(answer.status).toBe(200);
  expect(await answer.json()).toEqual({
    year: 2027,
    lastDate: "2027-07-01",
    accounts: [
      { accountCode: "4308", cents: at({ 4: 350, 5: -12 }) },
      { accountCode: "8010", cents: at({ 3: 700 }) },
      { accountCode: "8030", cents: at({ 7: 3 }) },
    ],
  });
  expect(await (await send("GET", "/budget/actuals?year=2029")).json()).toEqual({ year: 2029, lastDate: null, accounts: [] });
  expect(await refusal(await send("GET", "/budget/actuals?year=2026"))).toEqual({ status: 400, error: "not_ledger_year" });
  expect(await refusal(await send("GET", "/budget/actuals?year=x"))).toEqual({ status: 400, error: "invalid" });
});

it("reads and writes a budget in a fixed, small number of calls to the database", async () => {
  const accounts = (await env.DB.prepare("SELECT code FROM ledger_accounts WHERE kind IN ('income', 'expense') ORDER BY sort").all<{ code: string }>()).results;
  expect(accounts.length).toBeGreaterThanOrEqual(30);
  const lines = accounts.slice(0, 40).map((account, i) => ({
    accountCode: account.code,
    rule: (i % 2 === 0 ? { kind: "monthly", amountCents: 100 * (i + 1) } : { kind: "pattern", amountCents: 1000 }) as BudgetRule,
    base: i % 2 === 0 ? null : at({ 1: 1, 6: 2 }),
  }));
  const put = meteredDb(env.DB);
  const made = await putBudget(put.db, 2027, { source: SOURCE, lines }, NOW);
  expect(made.lines).toHaveLength(lines.length);
  expect(put.calls()).toBe(2);

  const get = meteredDb(env.DB);
  expect((await getBudget(get.db, 2027, NOW)).lines).toHaveLength(lines.length);
  expect(get.calls()).toBe(1);

  const one = meteredDb(env.DB);
  await putBudgetLine(one.db, 2027, lines[1]!.accountCode, { kind: "pattern", amountCents: 2000 }, NOW);
  expect(one.calls()).toBe(2);

  for (let day = 1; day <= 20; day++) await book(`2027-0${(day % 9) + 1}-${String(day).padStart(2, "0")}`, move("4308", "1010", day * 100));
  const actuals = meteredDb(env.DB);
  expect((await budgetActuals(actuals.db, 2027)).accounts).toHaveLength(1);
  expect(actuals.calls()).toBe(1);
});
