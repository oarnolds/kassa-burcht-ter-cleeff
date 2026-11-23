import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { EntryLine } from "../shared/ledger-types";
import { app } from "../worker/app";
import { createEntry, upsertSourced } from "../worker/db/ledger";
import { accountLines, balanceReport, overview, resultReport, setComparison } from "../worker/db/ledger-reports";
import { setOpening } from "../worker/db/opening";
import { api, asAdmin, meteredDb, resetData } from "./helpers";

let cookie: string;
beforeEach(async () => {
  await resetData();
  cookie = (await asAdmin()).cookie;
});

const NOW = new Date("2027-03-01T12:00:00.000Z");
const move = (debit: string, credit: string, cents: number): EntryLine[] => [
  { accountCode: debit, amountCents: cents, note: null, assetId: null },
  { accountCode: credit, amountCents: -cents, note: null, assetId: null },
];
const book = (date: string, lines: EntryLine[], description = "Boeking") => createEntry(env.DB, { date, description, source: "manual", lines }, NOW);
const base = "/api/admin/boekhouding";

it("closes the balance, with the result of the year on it", async () => {
  await setOpening(env.DB, 2027, { lines: [{ accountCode: "1010", amountCents: 500000 }, { accountCode: "0130", amountCents: 200000 }, { accountCode: "0135", amountCents: 50000 }, { accountCode: "1700", amountCents: 30000 }], eBoekhoudenEquityCents: null }, NOW);
  await book("2027-02-01", move("1010", "8012", 12000));
  await book("2027-02-02", move("4514", "1010", 2500));
  const report = await balanceReport(env.DB, "2027-12-31");
  const by = Object.fromEntries(report.rows.map((row) => [row.code, row.cents]));
  expect(by["0135"]).toBe(-50000);
  expect(by["1010"]).toBe(509500);
  expect(by["1700"]).toBe(30000);
  expect(by["1400"]).toBe(620000);
  expect(report.resultCents).toBe(9500);
  expect(report.assetsCents).toBe(659500);
  expect(report.assetsCents).toBe(report.liabilitiesAndEquityCents + report.resultCents);
  expect(report.rows.some((row) => row.kind === "income" || row.kind === "expense")).toBe(false);
  expect((await balanceReport(env.DB, "2027-01-31")).resultCents).toBe(0);
});

it("shows the result next to 2026 from the typed comparison figures", async () => {
  await book("2027-05-01", move("1010", "8030", 150000));
  await book("2027-05-02", move("4308", "1010", 40000));
  expect((await resultReport(env.DB, "2027-01-01", "2027-12-31")).previousResultCents).toBeNull();
  await setComparison(env.DB, 2026, [{ accountCode: "8030", amountCents: 118440 }, { accountCode: "4308", amountCents: 30000 }]);
  const report = await resultReport(env.DB, "2027-01-01", "2027-12-31");
  expect(report.rows).toEqual([
    { code: "4308", name: "Energie", kind: "expense", cents: 40000, previousCents: 30000 },
    { code: "8030", name: "Rente", kind: "income", cents: 150000, previousCents: 118440 },
  ]);
  expect(report.resultCents).toBe(110000);
  expect(report.previousResultCents).toBe(88440);
  // Not a whole year: no comparison.
  const part = await resultReport(env.DB, "2027-01-01", "2027-06-30");
  expect(part.previousResultCents).toBeNull();
  expect(part.rows.every((row) => row.previousCents === null)).toBe(true);
});

it("shows the result next to the same months a year earlier", async () => {
  await book("2027-03-10", move("1010", "8010", 10000));
  await book("2027-03-11", move("4301", "1010", 4000));
  await book("2028-03-10", move("1010", "8010", 25000));
  await book("2028-04-10", move("1010", "8010", 99000));
  const report = await resultReport(env.DB, "2028-03-01", "2028-03-31");
  expect(report.rows).toEqual([
    { code: "4301", name: "Huur", kind: "expense", cents: 0, previousCents: 4000 },
    { code: "8010", name: "Verhuur", kind: "income", cents: 25000, previousCents: 10000 },
  ]);
  expect(report.resultCents).toBe(25000);
  expect(report.previousResultCents).toBe(6000);
});

it("leaves the closing entry out of the result", async () => {
  await book("2027-03-10", move("1010", "8010", 10000));
  await createEntry(env.DB, { date: "2027-12-31", description: "Afsluiting", source: "closing", lines: move("8010", "1400", 10000) }, NOW);
  const report = await resultReport(env.DB, "2027-01-01", "2027-12-31");
  expect(report.resultCents).toBe(10000);
  expect(report.rows).toEqual([{ code: "8010", name: "Verhuur", kind: "income", cents: 10000, previousCents: null }]);
  // R8: on 31 December the year's result stands apart; from 1 January on it is in 1400.
  const yearEnd = await balanceReport(env.DB, "2027-12-31");
  expect(yearEnd.resultCents).toBe(10000);
  expect(yearEnd.assetsCents).toBe(yearEnd.liabilitiesAndEquityCents + yearEnd.resultCents);
  const next = await balanceReport(env.DB, "2028-01-01");
  expect(next.resultCents).toBe(0);
  expect(next.assetsCents).toBe(next.liabilitiesAndEquityCents);
});

it("lists an account's lines with a running balance", async () => {
  await book("2027-01-05", move("1010", "8010", 1000), "Een");
  await book("2027-02-05", move("1010", "8010", 2000), "Twee");
  await book("2027-02-05", move("4301", "1010", 500), "Drie");
  await book("2027-03-05", move("1010", "8010", 4000), "Vier");
  const lines = await accountLines(env.DB, "1010", "2027-02-01", "2027-02-28");
  expect(lines.openingCents).toBe(1000);
  expect(lines.lines.map((line) => [line.description, line.amountCents, line.runningCents])).toEqual([["Twee", 2000, 3000], ["Drie", -500, 2500]]);
  expect(lines.lines[0]!.number).toBe(2);
  await expect(accountLines(env.DB, "9999", "2027-02-01", "2027-02-28")).rejects.toMatchObject({ code: "not_found" });
});

it("answers every boekhouding route only after logging in", async () => {
  const routes: [string, string][] = [
    ["GET", "/accounts"], ["POST", "/accounts"], ["PATCH", "/accounts/4514"], ["GET", "/category-accounts"], ["PUT", "/category-accounts"],
    ["GET", "/entries?year=2027"], ["POST", "/entries"], ["PUT", "/entries/x"], ["POST", "/entries/x/empty"], ["GET", "/entries/x/history"],
    ["POST", "/entries/x/attachments"], ["GET", "/attachments/x"], ["POST", "/attachments/x/hide"], ["GET", "/opening?year=2027"], ["PUT", "/opening?year=2027"],
    ["GET", "/comparison?year=2026"], ["PUT", "/comparison?year=2026"], ["GET", "/reports/balance?date=2027-01-01"],
    ["GET", "/reports/result?from=2027-01-01&to=2027-01-31"], ["GET", "/reports/account/1010?from=2027-01-01&to=2027-01-31"], ["GET", "/overview"],
  ];
  for (const [method, path] of routes) {
    const bare = await app.request(`${base}${path}`, { method }, env);
    expect(bare.status, `${method} ${path}`).toBe(401);
    if (method !== "GET") {
      const noHeader = await app.request(`${base}${path}`, { method, headers: { Cookie: cookie } }, env);
      expect(noHeader.status, `${method} ${path}`).toBe(403);
    }
  }
});

it("reads no more rows for a report as the years go by", async () => {
  const statements: D1PreparedStatement[] = [];
  const years = [2027, 2028];
  await env.DB.prepare("INSERT OR IGNORE INTO ledger_years (year, status) VALUES (2028, 'open')").run();
  for (let i = 0; i < 2000; i++) {
    const year = years[i % 2]!;
    const id = `e${i}`;
    const month = i % 2 === 0 ? "01" : "07";
    statements.push(
      env.DB.prepare("INSERT INTO ledger_entries (id, year, number, date, description, source, source_ref, created_at, updated_at) VALUES (?, ?, ?, ?, 'x', 'manual', NULL, 'a', 'a')").bind(id, year, Math.floor(i / 2) + 1, `${year}-${month}-10`),
      env.DB.prepare("INSERT INTO ledger_lines (entry_id, account_code, amount_cents) VALUES (?, '1010', 100), (?, '8010', -100)").bind(id, id),
    );
  }
  for (let i = 0; i < statements.length; i += 100) await env.DB.batch(statements.slice(i, i + 100));
  await book("2027-04-10", move("1010", "8010", 700));
  const metered = meteredDb(env.DB);
  const report = await resultReport(metered.db, "2027-04-01", "2027-04-30");
  expect(report.resultCents).toBe(700);
  expect(metered.rowsRead()).toBeLessThan(100);
});

it("works out the overview", async () => {
  const day = new Date("2027-06-10T10:00:00.000Z");
  await env.DB.prepare("INSERT INTO bank_lines (id, account_code, booking_date, amount_cents, description, content_key, origin, status, imported_at) VALUES ('b0','1010','2027-06-01',100,'x','k0','typed','open','t'), ('b1','1010','2027-06-01',100,'x','k1','typed','open','t'), ('b2','1010','2027-06-01',100,'x','k2','typed','waiting','t'), ('b3','1010','2027-06-01',100,'x','k3','typed','booked','t')").run();
  await book("2027-02-01", move("1010", "8010", 5000));
  await book("2027-01-01", move("1010", "8010", 700)); // the first day of the year counts
  await book("2027-06-02", move("4301", "1010", 1200));
  await book("2027-06-09", move("1000", "8012", 3000)); // cash booked, the kassa knows nothing of it
  await book("2027-06-10", move("1000", "8012", 999)); // today: not in yesterday's figure
  await upsertSourced(env.DB, { date: "2027-06-09", description: "d", source: "kassa_day", sourceRef: "2027-06-09", lines: move("1000", "8012", 100) }, NOW);
  const result = await overview(env.DB, day);
  expect(result).toMatchObject({ openLines: 2, waitingLines: 1, resultYearCents: 700 + 5000 - 1200 + 3000 + 999 + 100, cashDifferenceCents: 3100, consent: null, mollieDifferenceCents: null, lastNightly: null });
  expect(result.moneyAccounts.map((account) => account.accountCode)).toContain("1030");
  const before = await overview(env.DB, new Date("2026-11-23T10:00:00.000Z"));
  expect(before).toMatchObject({ resultYearCents: 0, cashDifferenceCents: 0 });
});

it("keeps and lists accounts, never deleting or hiding a money account", async () => {
  const added = await api(`${base}/accounts`, { method: "POST", cookie, json: { code: "4999", name: "Nieuw", kind: "expense" } });
  expect(added.status).toBe(201);
  expect((await api(`${base}/accounts`, { method: "POST", cookie, json: { code: "4999", name: "Nog eens", kind: "expense" } })).status).toBe(409);
  expect((await api(`${base}/accounts`, { method: "POST", cookie, json: { code: "49", name: "Kort", kind: "expense" } })).status).toBe(400);
  const hidden = await api(`${base}/accounts/4999`, { method: "PATCH", cookie, json: { name: "Anders", hidden: true } });
  expect(await hidden.json()).toMatchObject({ code: "4999", name: "Anders", hidden: true, money: false });
  const money = await api(`${base}/accounts/1010`, { method: "PATCH", cookie, json: { hidden: true } });
  expect(money.status).toBe(409);
  expect(await money.json()).toEqual({ error: "money_account" });
  const list = await (await api(`${base}/accounts`, { cookie })).json<{ code: string }[]>();
  expect(list).toHaveLength(45);
  expect(list.at(-1)!.code).toBe("4999");
  expect((await api(`${base}/accounts/4999`, { method: "DELETE", cookie })).status).toBe(404);
});

it("keeps the account of each kassa category, income accounts only", async () => {
  const first = await (await api(`${base}/category-accounts`, { cookie })).json<{ categoryId: string; categoryName: string; accountCode: string }[]>();
  expect(first.find((row) => row.categoryId === "entree")).toMatchObject({ categoryName: "Entree", accountCode: "8012" });
  expect(first.find((row) => row.categoryId === "ijs")!.accountCode).toBe("8011");
  await env.DB.prepare("DELETE FROM category_accounts WHERE category_id = 'ijs'").run();
  expect((await (await api(`${base}/category-accounts`, { cookie })).json<{ categoryId: string; accountCode: string }[]>()).find((r) => r.categoryId === "ijs")!.accountCode).toBe("8011");
  const put = await api(`${base}/category-accounts`, { method: "PUT", cookie, json: [{ categoryId: "ijs", accountCode: "8040" }] });
  expect((await put.json<{ categoryId: string; accountCode: string }[]>()).find((r) => r.categoryId === "ijs")!.accountCode).toBe("8040");
  const notIncome = await api(`${base}/category-accounts`, { method: "PUT", cookie, json: [{ categoryId: "ijs", accountCode: "4514" }] });
  expect([notIncome.status, await notIncome.json()]).toEqual([400, { error: "not_income_account" }]);
  const unknown = await api(`${base}/category-accounts`, { method: "PUT", cookie, json: [{ categoryId: "nee", accountCode: "8040" }] });
  expect([unknown.status, await unknown.json()]).toEqual([400, { error: "category_unknown" }]);
});

it("books, edits, empties and reads entries through the routes", async () => {
  const body = { date: "2027-03-05", description: "Bonnetje", lines: [{ accountCode: "4514", amountCents: 1250 }, { accountCode: "1010", amountCents: -1250, note: "pin" }] };
  const created = await api(`${base}/entries`, { method: "POST", cookie, json: body });
  expect(created.status).toBe(201);
  const entry = await created.json<{ id: string; source: string; editable: boolean }>();
  expect(entry).toMatchObject({ source: "manual", editable: true });
  expect((await api(`${base}/entries`, { method: "POST", cookie, json: { ...body, lines: [body.lines[0]] } })).status).toBe(400);
  const unbalanced = await api(`${base}/entries`, { method: "POST", cookie, json: { ...body, lines: [{ accountCode: "4514", amountCents: 5 }, { accountCode: "1010", amountCents: -4 }] } });
  expect(await unbalanced.json()).toEqual({ error: "unbalanced" });
  const edited = await api(`${base}/entries/${entry.id}`, { method: "PUT", cookie, json: { ...body, description: "Anders" } });
  expect(await edited.json()).toMatchObject({ description: "Anders", changed: true });
  expect(await (await api(`${base}/entries/${entry.id}/history`, { cookie })).json()).toHaveLength(1);
  expect((await api(`${base}/entries/nope/history`, { cookie })).status).toBe(404);
  const found = await (await api(`${base}/entries?year=2027&account=4514&amount=1250&text=anders`, { cookie })).json<unknown[]>();
  expect(found).toHaveLength(1);
  expect((await api(`${base}/entries`, { cookie })).status).toBe(400);
  const emptied = await api(`${base}/entries/${entry.id}/empty`, { method: "POST", cookie });
  expect((await emptied.json<{ lines: unknown[] }>()).lines).toEqual([]);
  expect((await api(`${base}/entries/nope/empty`, { method: "POST", cookie })).status).toBe(404);
});

it("takes, serves and hides an attachment through the routes", async () => {
  const entry = await book("2027-03-05", move("4514", "1010", 100));
  const bytes = new TextEncoder().encode("%PDF-1.4 bon");
  const send = (headers: Record<string, string>, payload: BodyInit = bytes) =>
    app.request(`${base}/entries/${entry.id}/attachments`, { method: "POST", headers: { "X-Requested-With": "kassa", Cookie: cookie, ...headers }, body: payload }, env);
  const ok = await send({ "Content-Type": "application/pdf", "X-Filename": encodeURIComponent("Bon façade.pdf") });
  expect(ok.status).toBe(201);
  const attachment = await ok.json<{ id: string; sizeBytes: number }>();
  expect(attachment.sizeBytes).toBe(bytes.byteLength);
  expect((await send({ "Content-Type": "text/html", "X-Filename": "a.html" })).status).toBe(400);
  expect((await send({ "Content-Type": "application/pdf", "X-Filename": "%E0%A4%A" })).status).toBe(400);
  const big = await send({ "Content-Type": "application/pdf", "X-Filename": "groot.pdf" }, new Uint8Array(10 * 1024 * 1024 + 1));
  expect([big.status, await big.json()]).toEqual([400, { error: "too_large" }]);
  const served = await api(`${base}/attachments/${attachment.id}`, { cookie });
  expect(served.status).toBe(200);
  expect(served.headers.get("Content-Type")).toBe("application/pdf");
  expect(served.headers.get("Cache-Control")).toBe("private, no-store");
  expect(served.headers.get("Content-Disposition")).toMatch(/^inline; filename\*=UTF-8''/);
  expect(await served.text()).toBe("%PDF-1.4 bon");
  expect((await api(`${base}/attachments/nope`, { cookie })).status).toBe(404);
  expect((await api(`${base}/attachments/${attachment.id}/hide`, { method: "POST", cookie })).status).toBe(200);
  expect((await api(`${base}/attachments/nope/hide`, { method: "POST", cookie })).status).toBe(404);
});

it("types the opening and the comparison figures through the routes", async () => {
  const put = await api(`${base}/opening?year=2027`, { method: "PUT", cookie, json: { lines: [{ accountCode: "1010", amountCents: 100000 }], eBoekhoudenEquityCents: 100000 } });
  expect(put.status).toBe(200);
  expect(await (await api(`${base}/opening?year=2027`, { cookie })).json()).toMatchObject({ year: 2027, equityCents: 100000, eBoekhoudenEquityCents: 100000 });
  expect(await (await api(`${base}/opening?year=2028`, { cookie })).json()).toMatchObject({ year: 2028, lines: [] });
  expect((await api(`${base}/opening?year=2028`, { method: "PUT", cookie, json: { lines: [] } })).status).toBe(409);
  const figures = await api(`${base}/comparison?year=2026`, { method: "PUT", cookie, json: { figures: [{ accountCode: "8030", amountCents: 118440 }] } });
  expect(await figures.json()).toEqual({ year: 2026, figures: [{ accountCode: "8030", amountCents: 118440 }] });
  const replaced = await api(`${base}/comparison?year=2026`, { method: "PUT", cookie, json: { figures: [{ accountCode: "4308", amountCents: 5 }] } });
  expect((await replaced.json<{ figures: unknown[] }>()).figures).toEqual([{ accountCode: "4308", amountCents: 5 }]);
  const asset = await api(`${base}/comparison?year=2026`, { method: "PUT", cookie, json: { figures: [{ accountCode: "1010", amountCents: 5 }] } });
  expect([asset.status, await asset.json()]).toEqual([400, { error: "not_result_account" }]);
  const year = await api(`${base}/comparison?year=2027`, { method: "PUT", cookie, json: { figures: [] } });
  expect([year.status, await year.json()]).toEqual([400, { error: "not_comparison_year" }]);
});

it("serves the reports and the overview", async () => {
  await book("2027-03-05", move("1010", "8010", 700));
  expect(((await (await api(`${base}/reports/balance?date=2027-12-31`, { cookie })).json()) as { resultCents: number }).resultCents).toBe(700);
  expect(((await (await api(`${base}/reports/result?from=2027-01-01&to=2027-12-31`, { cookie })).json()) as { resultCents: number }).resultCents).toBe(700);
  expect(((await (await api(`${base}/reports/account/1010?from=2027-01-01&to=2027-12-31`, { cookie })).json()) as { lines: unknown[] }).lines).toHaveLength(1);
  expect((await api(`${base}/reports/result?from=2027-02-01&to=2027-01-01`, { cookie })).status).toBe(400);
  expect((await api(`${base}/reports/balance?date=nope`, { cookie })).status).toBe(400);
  expect((await api(`${base}/reports/account/9999?from=2027-01-01&to=2027-12-31`, { cookie })).status).toBe(404);
  expect((await api(`${base}/overview`, { cookie })).status).toBe(200);
});

it("hands back one entry by its id, and says when there is none", async () => {
  const entry = await book("2027-02-01", move("4501", "1010", 1250), "Inkoop");
  const found = await api(`${base}/entries/${entry.id}`, { cookie });
  expect(found.status).toBe(200);
  expect(await found.json()).toMatchObject({ id: entry.id, number: entry.number, description: "Inkoop", editable: true });
  expect((await api(`${base}/entries/onbekend`, { cookie })).status).toBe(404);
});
