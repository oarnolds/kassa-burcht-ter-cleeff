import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PastedAsset } from "../shared/asset-paste";
import type { EntryLine, YearCheck } from "../shared/ledger-types";
import { addPastedAssets, bookDepreciation, disposeAsset, saveAsset } from "../worker/db/assets";
import { addAttachment, hideAttachment } from "../worker/db/attachments";
import { bookLine, importLines, openLines, recordBalance } from "../worker/db/bank";
import { balancesOn, createEntry, editEntry, emptyEntry, getEntry, upsertSourced, yearStatus } from "../worker/db/ledger";
import { balanceReport, resultReport } from "../worker/db/ledger-reports";
import { setOpening } from "../worker/db/opening";
import { closeYear, listYears, reopenYear, yearChecks } from "../worker/db/year";
import type { Env } from "../worker/env";
import { api, asAdmin, meteredDb, resetData } from "./helpers";

// Closing a year (spec §13): the checks, the result booked to 1400, the year locked; and reopening it with a reason.

beforeEach(resetData);
afterEach(() => {
  vi.useRealTimers();
});

const BEFORE = new Date("2026-06-01T12:00:00.000Z");
/** After 2026 has ended: the penningmeester closes it in January. */
const NOW = new Date("2027-01-15T12:00:00.000Z");
const NEXT = new Date("2028-01-10T12:00:00.000Z");

const move = (debit: string, credit: string, cents: number): EntryLine[] => [
  { accountCode: debit, amountCents: cents, note: null, assetId: null },
  { accountCode: credit, amountCents: -cents, note: null, assetId: null },
];
const book = (date: string, lines: EntryLine[], description = "Boeking") => createEntry(env.DB, { date, description, source: "manual", lines }, BEFORE);
const mollieBalance = (date: string, cents: number) => recordBalance(env.DB, "1030", { date, cents }, "mollie");
const count = async (where: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${where}`).first<{ n: number }>())!.n;
const yearRow = (year: number) => env.DB.prepare("SELECT status, closed_at, close_note FROM ledger_years WHERE year = ?").bind(year).first();
const events = async (year: number) =>
  (await env.DB.prepare("SELECT at, kind, note FROM ledger_year_events WHERE year = ? ORDER BY id").bind(year).all()).results;
async function entryOf(source: string, ref: string) {
  const row = await env.DB.prepare("SELECT id FROM ledger_entries WHERE source = ? AND source_ref = ?").bind(source, ref).first<{ id: string }>();
  return row ? getEntry(env.DB, row.id) : null;
}
/** As formatEuro writes it: a non-breaking space after the euro sign. */
const eur = (text: string) => text.replaceAll("€ ", "€\u00a0");
const amounts = (lines: EntryLine[]) => lines.map((line) => [line.accountCode, line.amountCents]);
const checksOf = async (year: number, now = NOW) => Object.fromEntries((await yearChecks(env, year, now)).map((check) => [check.key, check])) as Record<YearCheck["key"], YearCheck>;

/** A bank line on `account`, as from a file, and its id. */
async function bankLine(account: string, date: string, cents: number, description: string): Promise<string> {
  await importLines(env.DB, account, [{ bookingDate: date, amountCents: cents, description, counterpartyName: "Iemand", counterpartyIban: null, bankRef: null }], "file", BEFORE);
  const row = await env.DB.prepare("SELECT id FROM bank_lines WHERE description = ?").bind(description).first<{ id: string }>();
  return row!.id;
}

/**
 * A year whose checks all pass: an opening, income and costs (result € 98,00), nothing left to book, and Mollie's
 * balance of 31 December as in the books. ING betaal ends the year on € 5.098,00.
 */
async function tidyYear() {
  await setOpening(env.DB, 2026, { lines: [{ accountCode: "1010", amountCents: 500000 }, { accountCode: "1700", amountCents: 30000 }], eBoekhoudenEquityCents: null }, BEFORE);
  await book("2026-02-01", move("1010", "8012", 12000), "Entree");
  await book("2026-03-01", move("4514", "1010", 2500), "Diversen");
  await book("2026-12-31", move("1010", "8030", 300), "Rente");
  await mollieBalance("2026-12-31", 0);
}

const STRAALJAGER: PastedAsset = { name: "Straaljager", purchaseDate: "2008-01-01", costCents: 949600, writtenOffCents: 902120, lifeYears: 20 };
const DOME: PastedAsset = { name: "Dome - Kopan", purchaseDate: "2012-07-10", costCents: 4445721, writtenOffCents: 3072928, lifeYears: 20 };
const WIP: PastedAsset = { name: "Wip", purchaseDate: "2000-01-01", costCents: 100000, writtenOffCents: 100000, lifeYears: 10 };

// ---- The six of the plan ----

it("will not close while bank lines are open", async () => {
  await tidyYear();
  const open = await bankLine("1010", "2026-11-26", 500, "Gift");
  const waiting = await bankLine("1011", "2026-12-31", 7, "Rente kwartaalrekening");
  await env.DB.prepare("UPDATE bank_lines SET status = 'waiting', waiting_for = 'mollie' WHERE id = ?").bind(waiting).run();
  await bankLine("1010", "2027-01-02", 900, "Gift in het nieuwe jaar"); // of 2027: not counted

  expect((await checksOf(2026)).bank_lines).toEqual({ key: "bank_lines", ok: false, detail: "2 bankregels van 2026 nog te boeken", required: true });
  // A toelichting does not help: this check must hold.
  await expect(closeYear(env, 2026, "Toch afsluiten", NOW)).rejects.toMatchObject({ code: "checks_failed", status: 409 });

  await bookLine(env.DB, open, { split: [{ accountCode: "8025", amountCents: -500 }] }, BEFORE);
  expect((await checksOf(2026)).bank_lines).toMatchObject({ ok: false, detail: "1 bankregel van 2026 nog te boeken" });
  await expect(closeYear(env, 2026, null, NOW)).rejects.toMatchObject({ code: "checks_failed", status: 409 });
  expect(await yearStatus(env.DB, 2026)).toBe("open");
  expect(await count("ledger_entries WHERE source = 'closing'")).toBe(0);
  expect(await count("ledger_year_events")).toBe(0);

  await bookLine(env.DB, waiting, { split: [{ accountCode: "8030", amountCents: -7 }] }, BEFORE);
  expect((await checksOf(2026)).bank_lines).toEqual({ key: "bank_lines", ok: true, detail: "Alle bankregels van 2026 zijn geboekt", required: true });
  await closeYear(env, 2026, null, NOW);
  expect(await yearStatus(env.DB, 2026)).toBe("closed");
});

it("closes with a note when only a balance check fails", async () => {
  await tidyYear();
  await recordBalance(env.DB, "1010", { date: "2026-12-31", cents: 509000 }, "file");
  const checks = await checksOf(2026);
  expect(checks.bank_balances).toEqual({
    key: "bank_balances",
    ok: false,
    detail: eur("ING betaalrekening: boekhouding € 5.098,00, bank € 5.090,00 op 31-12-2026"),
    required: false,
  });
  expect(Object.values(checks).filter((check) => !check.ok).map((check) => check.key)).toEqual(["bank_balances"]);

  await expect(closeYear(env, 2026, null, NOW)).rejects.toMatchObject({ code: "note_required", status: 400 });
  await expect(closeYear(env, 2026, "   ", NOW)).rejects.toMatchObject({ code: "note_required", status: 400 });
  expect(await yearStatus(env.DB, 2026)).toBe("open");

  await closeYear(env, 2026, "  Bankkosten december komen in januari  ", NOW);
  expect(await yearRow(2026)).toEqual({ status: "closed", closed_at: NOW.toISOString(), close_note: "Bankkosten december komen in januari" });
  expect(await events(2026)).toEqual([{ at: NOW.toISOString(), kind: "closed", note: "Bankkosten december komen in januari" }]);
  // The next year is ready, open.
  expect(await yearRow(2027)).toEqual({ status: "open", closed_at: null, close_note: null });
});

it("books the result to equity and keeps the result report as it was", async () => {
  await tidyYear();
  const result = await resultReport(env.DB, "2026-01-01", "2026-12-31");
  expect(result.resultCents).toBe(9800);
  const equity = (await balancesOn(env.DB, "2026-12-31")).get("1400")!;
  expect(equity).toBe(-470000);

  await closeYear(env, 2026, null, NOW);
  expect(await resultReport(env.DB, "2026-01-01", "2026-12-31")).toEqual(result);

  // One entry on 31 December: each income and expense account back to zero, the result credited to 1400.
  const closing = (await entryOf("closing", "2026"))!;
  expect(closing).toMatchObject({ year: 2026, date: "2026-12-31", description: "Afsluiting 2026", source: "closing", sourceRef: "2026", editable: false });
  expect(amounts(closing.lines)).toEqual([
    ["4514", -2500],
    ["8012", 12000],
    ["8030", 300],
    ["1400", -9800],
  ]);
  expect(await yearRow(2026)).toEqual({ status: "closed", closed_at: NOW.toISOString(), close_note: null });

  // From 2027 on, 1400 holds the result and the income and expense accounts start at zero.
  const after = await balancesOn(env.DB, "2027-01-01");
  expect(after.get("1400")).toBe(equity - 9800);
  for (const code of ["4514", "8012", "8030"]) expect(after.get(code)).toBe(0);
  await book("2027-02-01", move("1010", "8012", 1500), "Entree 2027");
  expect((await resultReport(env.DB, "2027-01-01", "2027-12-31")).resultCents).toBe(1500);
  expect((await balanceReport(env.DB, "2027-12-31")).resultCents).toBe(1500);
});

it("carries the balance into the next year", async () => {
  await tidyYear();
  const yearEnd = await balanceReport(env.DB, "2026-12-31");
  expect(yearEnd.resultCents).toBe(9800);

  await closeYear(env, 2026, null, NOW);
  // On 31 December the result still stands apart (R8) ...
  expect(await balanceReport(env.DB, "2026-12-31")).toEqual(yearEnd);
  // ... and on 1 January it is in 1400.
  expect(await balanceReport(env.DB, "2027-01-01")).toEqual({
    date: "2027-01-01",
    rows: yearEnd.rows.map((row) => (row.code === "1400" ? { ...row, cents: row.cents + yearEnd.resultCents } : row)),
    assetsCents: yearEnd.assetsCents,
    liabilitiesAndEquityCents: yearEnd.liabilitiesAndEquityCents + yearEnd.resultCents,
    resultCents: 0,
  });
  expect((await balanceReport(env.DB, "2027-01-01")).rows.find((row) => row.code === "1400")!.cents).toBe(479800);
});

it("changes nothing in a closed year", async () => {
  await tidyYear();
  const kept = await book("2026-05-01", move("4514", "1010", 1000), "Bonnetje");
  const pdf = new TextEncoder().encode("%PDF-1.4 bon").buffer as ArrayBuffer;
  const file = () => ({ filename: "bon.pdf", contentType: "application/pdf", body: pdf, sizeBytes: pdf.byteLength });
  const attachment = await addAttachment(env, kept.id, file(), BEFORE);
  const booked = await bankLine("1010", "2026-11-27", 2500, "Verhuur");
  await bookLine(env.DB, booked, { split: [{ accountCode: "8010", amountCents: -2500 }] }, BEFORE);
  await closeYear(env, 2026, null, NOW);

  const snapshot = async () => ({
    entries: (await env.DB.prepare("SELECT * FROM ledger_entries ORDER BY id").all()).results,
    lines: (await env.DB.prepare("SELECT * FROM ledger_lines ORDER BY id").all()).results,
    history: (await env.DB.prepare("SELECT * FROM ledger_history ORDER BY id").all()).results,
    attachments: (await env.DB.prepare("SELECT * FROM ledger_attachments ORDER BY id").all()).results,
  });
  const before = await snapshot();
  const refused = { code: "year_closed", status: 409 };

  await expect(book("2026-05-02", move("4514", "1010", 100))).rejects.toMatchObject(refused);
  await expect(editEntry(env.DB, kept.id, { date: "2026-05-01", description: "Anders", lines: kept.lines }, NOW)).rejects.toMatchObject(refused);
  await expect(emptyEntry(env.DB, kept.id, NOW)).rejects.toMatchObject(refused);
  // Out of the closed year into the open one is a change in the closed year too.
  await expect(editEntry(env.DB, kept.id, { date: "2027-01-05", description: "Bonnetje", lines: kept.lines }, NOW)).rejects.toMatchObject(refused);
  await expect(bookLine(env.DB, booked, { split: [{ accountCode: "8025", amountCents: -2500 }] }, NOW)).rejects.toMatchObject(refused);
  // A line of 2026 read in after closing waits: it cannot be booked in 2026.
  const late = await bankLine("1010", "2026-12-30", 25, "Rente december");
  await expect(bookLine(env.DB, late, { split: [{ accountCode: "8030", amountCents: -25 }] }, NOW)).rejects.toMatchObject(refused);
  await expect(addAttachment(env, kept.id, file(), NOW)).rejects.toMatchObject(refused);
  await expect(hideAttachment(env, attachment.id, NOW)).rejects.toMatchObject(refused);
  await expect(
    upsertSourced(env.DB, { date: "2026-12-31", description: "Kassa 31-12-2026", source: "kassa_day", sourceRef: "2026-12-31", lines: move("1000", "8011", 110) }, NOW),
  ).rejects.toMatchObject(refused);
  await expect(bookDepreciation(env.DB, 2026, NOW)).rejects.toMatchObject(refused);
  await expect(setOpening(env.DB, 2026, { lines: [{ accountCode: "1010", amountCents: 1 }], eBoekhoudenEquityCents: null }, NOW)).rejects.toMatchObject(refused);
  await expect(closeYear(env, 2026, "nog eens", NOW)).rejects.toMatchObject(refused);

  expect(await snapshot()).toEqual(before);
  expect((await openLines(env.DB, {})).map((line) => [line.id, line.inClosedYear])).toEqual([[late, true]]);
});

it("reopens the newest closed year with a reason, and only that one", async () => {
  await tidyYear();
  await closeYear(env, 2026, null, NOW);
  await book("2027-03-01", move("1010", "8010", 5000), "Verhuur");
  await mollieBalance("2027-12-31", 0);
  await closeYear(env, 2027, null, NEXT);
  const closing2027 = (await entryOf("closing", "2027"))!;
  expect(amounts(closing2027.lines)).toEqual([
    ["8010", 5000],
    ["1400", -5000],
  ]);

  await expect(reopenYear(env.DB, 2026, "Fout in de kas", NEXT)).rejects.toMatchObject({ code: "not_newest", status: 409 });
  await expect(reopenYear(env.DB, 2027, "  ab  ", NEXT)).rejects.toMatchObject({ code: "reason_required", status: 400 });
  expect(await yearStatus(env.DB, 2027)).toBe("closed");

  await reopenYear(env.DB, 2027, "  Kascommissie: huur dubbel geboekt  ", NEXT);
  expect(await yearRow(2027)).toEqual({ status: "open", closed_at: null, close_note: null });
  // The closing entry is emptied, not deleted: it keeps its number.
  expect(await entryOf("closing", "2027")).toMatchObject({ id: closing2027.id, number: closing2027.number, lines: [], editable: false });
  expect(await events(2027)).toEqual([
    { at: NEXT.toISOString(), kind: "closed", note: null },
    { at: NEXT.toISOString(), kind: "reopened", note: "Kascommissie: huur dubbel geboekt" },
  ]);
  // The result of 2027 is unbooked again.
  expect((await balanceReport(env.DB, "2028-01-01")).resultCents).toBe(5000);
  await expect(reopenYear(env.DB, 2027, "nog een keer", NEXT)).rejects.toMatchObject({ code: "not_closed", status: 409 });
  await expect(reopenYear(env.DB, 2025, "bestaat niet", NEXT)).rejects.toMatchObject({ code: "not_closed", status: 409 });

  // Now 2026 is the newest closed year: reopened, corrected and closed again, with the same closing entry.
  const closing2026 = (await entryOf("closing", "2026"))!;
  await reopenYear(env.DB, 2026, "Kas klopte niet", NEXT);
  expect(await yearStatus(env.DB, 2026)).toBe("open");
  await book("2026-11-01", move("4515", "1010", 700), "Kasverschil");
  await closeYear(env, 2026, null, NEXT);
  const again = (await entryOf("closing", "2026"))!;
  expect(again).toMatchObject({ id: closing2026.id, number: closing2026.number });
  expect(amounts(again.lines)).toEqual([
    ["4514", -2500],
    ["4515", -700],
    ["8012", 12000],
    ["8030", 300],
    ["1400", -9100],
  ]);
  expect((await events(2026)).map((event) => event.kind)).toEqual(["closed", "reopened", "closed"]);
});

// ---- When it can be closed ----

it("closes a year only once it has ended", async () => {
  await tidyYear();
  // 31 December 23:59:59 in Amsterdam.
  await expect(closeYear(env, 2026, null, new Date("2026-12-31T22:59:59.000Z"))).rejects.toMatchObject({ code: "year_not_ended", status: 409 });
  expect(await yearStatus(env.DB, 2026)).toBe("open");
  // Midnight in Amsterdam: 1 January 2027.
  await closeYear(env, 2026, null, new Date("2026-12-31T23:00:00.000Z"));
  expect(await yearStatus(env.DB, 2026)).toBe("closed");
  await expect(closeYear(env, 2026, null, NOW)).rejects.toMatchObject({ code: "year_closed", status: 409 });
  await expect(closeYear(env, 2025, null, NOW)).rejects.toMatchObject({ code: "year_unknown", status: 400 });
  await expect(closeYear(env, 2030, null, new Date("2031-02-01T12:00:00.000Z"))).rejects.toMatchObject({ code: "year_unknown", status: 400 });
  await expect(yearChecks(env, 2025, NOW)).rejects.toMatchObject({ code: "year_unknown", status: 400 });
});

it("closes the years in order (R34)", async () => {
  await tidyYear();
  await book("2027-03-01", move("1010", "8010", 5000), "Verhuur");
  await mollieBalance("2027-12-31", 0);
  const snapshot = async () => ({
    years: (await env.DB.prepare("SELECT * FROM ledger_years ORDER BY year").all()).results,
    events: (await env.DB.prepare("SELECT * FROM ledger_year_events ORDER BY id").all()).results,
    entries: (await env.DB.prepare("SELECT * FROM ledger_entries ORDER BY id").all()).results,
    lines: (await env.DB.prepare("SELECT * FROM ledger_lines ORDER BY id").all()).results,
  });
  const before = await snapshot();

  // 2026 is still open: 2027 waits for it, with or without a toelichting.
  await expect(closeYear(env, 2027, null, NEXT)).rejects.toMatchObject({ code: "earlier_year_open", status: 409 });
  await expect(closeYear(env, 2027, "Toch alvast", NEXT)).rejects.toMatchObject({ code: "earlier_year_open", status: 409 });
  expect(await snapshot()).toEqual(before);
  // Its checks can still be read.
  expect((await yearChecks(env, 2027, NEXT)).every((check) => check.ok)).toBe(true);

  await closeYear(env, 2026, null, NEXT);
  await closeYear(env, 2027, null, NEXT);
  expect(await yearRow(2027)).toEqual({ status: "closed", closed_at: NEXT.toISOString(), close_note: null });
  expect(await yearRow(2028)).toEqual({ status: "open", closed_at: null, close_note: null });
});

it("does not close a year when the year before is reopened between the checks and the close", async () => {
  await tidyYear();
  await closeYear(env, 2026, null, NOW);
  await mollieBalance("2027-12-31", 0);
  let batches = 0;
  const racing = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => target.prepare(sql);
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (++batches === 2) await reopenYear(env.DB, 2026, "Kascommissie vond een fout", NEXT);
          return target.batch(statements);
        };
      }
      return Reflect.get(target, prop);
    },
  });
  await expect(closeYear({ ...env, DB: racing } as Env, 2027, null, NEXT)).rejects.toMatchObject({ code: "year_changed", status: 409 });
  expect(batches).toBe(2);
  expect(await yearStatus(env.DB, 2026)).toBe("open");
  expect(await yearStatus(env.DB, 2027)).toBe("open");
  expect(await count("ledger_entries WHERE source = 'closing' AND source_ref = '2027'")).toBe(0);
  expect((await events(2027)).length).toBe(0);
});

it("closes nothing when the books change between the checks and the close", async () => {
  await tidyYear();
  // The seed still holds a row for 2027; take it away to see that a failed close does not open the next year.
  await env.DB.prepare("DELETE FROM ledger_years WHERE year = 2027").run();
  // Another window books interest on 31 December after the close has read the year, before it writes.
  let batches = 0;
  const racing = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => target.prepare(sql);
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (++batches === 2) await book("2026-12-31", move("1010", "8030", 45), "Rente na");
          return target.batch(statements);
        };
      }
      return Reflect.get(target, prop);
    },
  });
  await expect(closeYear({ ...env, DB: racing } as Env, 2026, null, NOW)).rejects.toMatchObject({ code: "year_changed", status: 409 });
  expect(batches).toBe(2);
  expect(await yearStatus(env.DB, 2026)).toBe("open");
  expect(await yearStatus(env.DB, 2027)).toBeNull();
  expect(await count("ledger_entries WHERE source = 'closing'")).toBe(0);
  expect(await count("ledger_year_events")).toBe(0);

  // Closed again, it takes the interest along.
  await closeYear(env, 2026, null, NOW);
  expect(amounts((await entryOf("closing", "2026"))!.lines)).toEqual([
    ["4514", -2500],
    ["8012", 12000],
    ["8030", 345],
    ["1400", -9845],
  ]);
});

// ---- The checks ----

it("runs every check of a tidy year in a single call", async () => {
  await tidyYear();
  await recordBalance(env.DB, "1010", { date: "2026-12-31", cents: 509800 }, "file");
  await recordBalance(env.DB, "1011", { date: "2026-11-30", cents: 0 }, "file");
  const metered = meteredDb(env.DB);
  const checks = await yearChecks({ ...env, DB: metered.db } as Env, 2026, NOW);
  expect(metered.calls()).toBe(1);
  expect(checks).toEqual([
    { key: "bank_lines", ok: true, detail: "Alle bankregels van 2026 zijn geboekt", required: true },
    { key: "bank_balances", ok: true, detail: "Alle saldo's van de bank kloppen", required: false },
    { key: "cash", ok: true, detail: eur("Kas € 0,00, volgens de kassa € 0,00"), required: false },
    { key: "mollie", ok: true, detail: eur("Mollie: boekhouding € 0,00, bij Mollie € 0,00 op 31-12-2026"), required: false },
    { key: "depreciation", ok: true, detail: "Er valt in 2026 niets af te schrijven", required: false },
    { key: "in_transit", ok: true, detail: "1080 Kruisposten staat op nul", required: false },
    { key: "assets", ok: true, detail: eur("0130 € 0,00 en 0135 € 0,00, volgens de lijst toestellen € 0,00 en € 0,00"), required: false },
  ]);
  // Closing reads once and writes once.
  const closing = meteredDb(env.DB);
  await closeYear({ ...env, DB: closing.db } as Env, 2026, null, NOW);
  expect(closing.calls()).toBe(2);
});

it("compares each bank account's newest balance up to 31 December with the books", async () => {
  await tidyYear();
  expect((await checksOf(2026)).bank_balances).toMatchObject({ ok: true, detail: "Geen saldo van de bank om mee te vergelijken" });
  await recordBalance(env.DB, "1010", { date: "2026-12-31", cents: 509800 }, "file");
  await recordBalance(env.DB, "1011", { date: "2026-11-30", cents: 100 }, "file");
  await recordBalance(env.DB, "1011", { date: "2027-01-05", cents: 0 }, "file"); // after the year: not looked at
  await recordBalance(env.DB, "1020", { date: "2026-06-30", cents: 5 }, "file");
  await mollieBalance("2026-12-31", 999); // 1030 has a check of its own
  expect((await checksOf(2026)).bank_balances).toEqual({
    key: "bank_balances",
    ok: false,
    detail: eur("ING kwartaalrekening: boekhouding € 0,00, bank € 1,00 op 30-11-2026; ASN MeerSparen: boekhouding € 0,00, bank € 0,05 op 30-6-2026"),
    required: false,
  });
  await book("2026-11-30", move("1011", "1010", 100), "Naar de kwartaalrekening");
  await book("2026-06-30", move("1020", "8030", 5), "Rente");
  await recordBalance(env.DB, "1010", { date: "2026-12-31", cents: 509700 }, "file");
  expect((await checksOf(2026)).bank_balances).toMatchObject({ ok: true, detail: "Alle saldo's van de bank kloppen" });
});

it("compares the kluisje with what the kassa says on 31 December", async () => {
  await tidyYear();
  const sale = (id: string, cents: number, soldAt: string) =>
    env.DB.prepare(
      "INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date, handover_id) VALUES (?1, 'cash', 'paid', ?2, ?3, ?3, substr(?3, 1, 10), NULL)",
    )
      .bind(id, cents, soldAt)
      .run();
  await sale("s1", 110, "2026-12-31T15:00:00.000Z");
  await sale("s2", 220, "2026-12-31T23:30:00.000Z"); // 00:30 on 1 January in Amsterdam
  expect((await checksOf(2026)).cash).toEqual({ key: "cash", ok: false, detail: eur("Kas € 0,00, volgens de kassa € 1,10"), required: false });
  await book("2026-12-31", move("1000", "8011", 110), "Kassa 31-12-2026");
  expect((await checksOf(2026)).cash).toMatchObject({ ok: true, detail: eur("Kas € 1,10, volgens de kassa € 1,10") });
});

it("compares 1030 with Mollie's balance of 31 December, payouts on their way to ING left out", async () => {
  await tidyYear();
  await book("2026-12-20", move("1030", "8025", 5100), "Donaties via de website");
  expect((await checksOf(2026)).mollie).toEqual({
    key: "mollie",
    ok: false,
    detail: eur("Mollie: boekhouding € 51,00, bij Mollie € 0,00 op 31-12-2026"),
    required: false,
  });
  // Mollie paid it out on 30 December; it reaches ING in January (R30).
  await env.DB.prepare(
    "INSERT INTO mollie_settlements (id, reference, status, settled_at, amount_cents, costs_cents) VALUES ('stl_1', '05665564.2712.01', 'paidout', '2026-12-30T05:00:00.000Z', 5000, 100)",
  ).run();
  expect((await checksOf(2026)).mollie).toMatchObject({ ok: true, detail: eur("Mollie: boekhouding € 51,00, onderweg naar ING € 51,00, bij Mollie € 0,00 op 31-12-2026") });

  // Only a balance of 31 December itself counts.
  await env.DB.prepare("DELETE FROM bank_balances WHERE account_code = '1030'").run();
  await mollieBalance("2026-12-30", 0);
  await mollieBalance("2027-01-01", 0);
  expect((await checksOf(2026)).mollie).toEqual({ key: "mollie", ok: false, detail: "Geen saldo van Mollie op 31 december", required: false });
});

it("wants the depreciation of the year booked as planned", async () => {
  await tidyYear();
  await addPastedAssets(env.DB, [STRAALJAGER, WIP], BEFORE);
  expect((await checksOf(2026)).depreciation).toEqual({ key: "depreciation", ok: false, detail: "Afschrijving 2026 is nog niet geboekt", required: false });
  await bookDepreciation(env.DB, 2026, BEFORE);
  expect((await checksOf(2026)).depreciation).toMatchObject({ ok: true, detail: "Afschrijving 2026 is geboekt" });
  const straaljager = (await env.DB.prepare("SELECT id FROM assets WHERE name = 'Straaljager'").first<{ id: string }>())!;
  await saveAsset(env.DB, { id: straaljager.id, residualCents: 10000 }, BEFORE);
  expect((await checksOf(2026)).depreciation).toMatchObject({ ok: false, detail: "Afschrijving 2026 is geboekt, maar de bedragen zijn sindsdien veranderd" });
});

it("wants 1080 Kruisposten at zero on 31 December", async () => {
  await tidyYear();
  await book("2026-12-30", move("1080", "1010", 2000), "Naar de spaarrekening");
  await book("2027-01-02", move("1011", "1080", 2000), "Aangekomen op de spaarrekening");
  expect((await checksOf(2026)).in_transit).toEqual({ key: "in_transit", ok: false, detail: eur("1080 Kruisposten staat op € 20,00 op 31-12-2026"), required: false });
  await closeYear(env, 2026, "Overboeking kwam op 2 januari aan", NOW);
  expect(await yearRow(2026)).toMatchObject({ status: "closed", close_note: "Overboeking kwam op 2 januari aan" });
});

it("wants 0130 and 0135 to equal the list of toestellen (R33)", async () => {
  await tidyYear();
  const [straaljager] = await addPastedAssets(env.DB, [STRAALJAGER, DOME], BEFORE);
  // A toestel that went during the year is off the list and off the books.
  await disposeAsset(env.DB, straaljager!.id, "2026-06-30", BEFORE);
  await bookDepreciation(env.DB, 2026, BEFORE);
  const listed = eur("volgens de lijst toestellen € 44.457,21 en -€ 32.952,14");
  expect((await checksOf(2026)).assets).toEqual({ key: "assets", ok: true, detail: eur(`0130 € 44.457,21 en 0135 -€ 32.952,14, ${listed}`), required: false });

  // Bought by hand on 0130, without a toestel.
  await book("2026-08-01", move("0130", "1010", 25000), "Picknicktafel");
  expect((await checksOf(2026)).assets).toEqual({ key: "assets", ok: false, detail: eur(`0130 € 44.707,21 en 0135 -€ 32.952,14, ${listed}`), required: false });
  await expect(closeYear(env, 2026, null, NOW)).rejects.toMatchObject({ code: "note_required", status: 400 });
  await closeYear(env, 2026, "Picknicktafel staat nog niet in de lijst", NOW);
  expect(await yearStatus(env.DB, 2026)).toBe("closed");
});

// ---- Through beheer ----

it("answers the checks, closes and reopens through beheer", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  await tidyYear();
  const { cookie } = await asAdmin();
  const path = "/api/admin/boekhouding";
  const post = (to: string, json?: unknown) => api(`${path}${to}`, { method: "POST", cookie, json });

  expect((await api(`${path}/year/2026/checks`)).status).toBe(401);
  const checks = await api(`${path}/year/2026/checks`, { cookie });
  expect(checks.status).toBe(200);
  expect((await checks.json<YearCheck[]>()).map((check) => [check.key, check.ok])).toEqual([
    ["bank_lines", true],
    ["bank_balances", true],
    ["cash", true],
    ["mollie", true],
    ["depreciation", true],
    ["in_transit", true],
    ["assets", true],
  ]);
  expect((await api(`${path}/year/abcd/checks`, { cookie })).status).toBe(400);
  expect(await (await api(`${path}/year/2025/checks`, { cookie })).json()).toEqual({ error: "year_unknown" });

  const open = await bankLine("1010", "2026-11-26", 500, "Gift");
  const refused = await post("/year/2026/close", { note: "toch" });
  expect([refused.status, await refused.json()]).toEqual([409, { error: "checks_failed" }]);
  await bookLine(env.DB, open, { split: [{ accountCode: "8025", amountCents: -500 }] }, BEFORE);
  await recordBalance(env.DB, "1010", { date: "2026-12-31", cents: 1 }, "file");
  const noNote = await post("/year/2026/close", {});
  expect([noNote.status, await noNote.json()]).toEqual([400, { error: "note_required" }]);
  expect((await post("/year/2026/close", { note: 5 })).status).toBe(400);
  const closed = await post("/year/2026/close", { note: "Saldo van de bank volgt" });
  expect([closed.status, await closed.json()]).toEqual([200, { ok: true }]);

  const years = await api(`${path}/years`, { cookie });
  expect(await years.json()).toEqual([
    {
      year: 2026,
      status: "closed",
      closedAt: NOW.toISOString(),
      closeNote: "Saldo van de bank volgt",
      events: [{ at: NOW.toISOString(), kind: "closed", note: "Saldo van de bank volgt" }],
    },
    { year: 2027, status: "open", closedAt: null, closeNote: null, events: [] },
  ]);

  const short = await post("/year/2026/reopen", { reason: "x" });
  expect([short.status, await short.json()]).toEqual([400, { error: "reason_required" }]);
  expect(await (await post("/year/2026/reopen", {})).json()).toEqual({ error: "reason_required" });
  const reopened = await post("/year/2026/reopen", { reason: "Kascommissie vond een fout" });
  expect([reopened.status, await reopened.json()]).toEqual([200, { ok: true }]);
  const notClosed = await post("/year/2026/reopen", { reason: "Kascommissie vond een fout" });
  expect([notClosed.status, await notClosed.json()]).toEqual([409, { error: "not_closed" }]);
  expect((await listYears(env.DB))[0]).toMatchObject({ year: 2026, status: "open", closedAt: null, closeNote: null });
});

it("refuses to close through beheer before the year has ended", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-12-20T12:00:00.000Z") });
  await tidyYear();
  const { cookie } = await asAdmin();
  const res = await api("/api/admin/boekhouding/year/2026/close", { method: "POST", cookie, json: {} });
  expect([res.status, await res.json()]).toEqual([409, { error: "year_not_ended" }]);
});
