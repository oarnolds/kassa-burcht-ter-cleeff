import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { ACCOUNTS } from "../shared/accounts";
import type { EntryLine, EntrySource, LedgerAccount } from "../shared/ledger-types";
import {
  balancesOn,
  createEntry,
  editEntry,
  emptyEntry,
  entryHistory,
  firstOpenYear,
  getEntry,
  listEntries,
  upsertSourced,
  upsertSourcedStatements,
  yearStatus,
} from "../worker/db/ledger";
import { resetData } from "./helpers";

beforeEach(resetData);

const NOW = new Date("2027-03-01T12:00:00.000Z");
const LATER = new Date("2027-03-02T12:00:00.000Z");

/** One amount from `credit` to `debit`. */
function move(debit: string, credit: string, cents: number): EntryLine[] {
  return [
    { accountCode: debit, amountCents: cents, note: null, assetId: null },
    { accountCode: credit, amountCents: -cents, note: null, assetId: null },
  ];
}

const manual = (date: string, lines: EntryLine[] = move("4514", "1010", 1250), description = "Bonnetje") =>
  createEntry(env.DB, { date, description, source: "manual", lines }, NOW);

const synced = (source: EntrySource, sourceRef: string, date: string, lines: EntryLine[], now = NOW) =>
  upsertSourced(env.DB, { date, description: `Kassa ${sourceRef}`, source, sourceRef, lines }, now);

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

const closeByHand = (year: number) =>
  env.DB.prepare("UPDATE ledger_years SET status = 'closed', closed_at = '2028-02-01T10:00:00.000Z' WHERE year = ?").bind(year).run();

it("knows the 44 accounts of the spec, with what they replace", async () => {
  const { results } = await env.DB.prepare("SELECT code, name, kind, money, hidden, formerly FROM ledger_accounts ORDER BY sort").all<{
    code: string;
    name: string;
    kind: LedgerAccount["kind"];
    money: number;
    hidden: number;
    formerly: string;
  }>();
  const stored: LedgerAccount[] = results.map((row) => ({
    code: row.code,
    name: row.name,
    kind: row.kind,
    money: row.money === 1,
    hidden: row.hidden === 1,
    formerly: JSON.parse(row.formerly) as string[],
  }));
  expect(ACCOUNTS).toHaveLength(44);
  expect(stored.map((a) => a.code)).toEqual(ACCOUNTS.map((a) => a.code));
  expect(stored).toEqual(ACCOUNTS);
  expect(stored.find((a) => a.code === "8000")!.formerly).toEqual(["8000", "8001", "8002", "8003"]);
  expect(stored.find((a) => a.code === "1300")!.formerly).toEqual(["1300", "1500", "1590"]);
  expect(stored.find((a) => a.code === "4302")!.formerly).toEqual(["4302", "4303"]);
  expect(stored.find((a) => a.code === "1030")!.formerly).toEqual([]);
  expect(stored.filter((a) => a.money).map((a) => a.code)).toEqual(["1000", "1010", "1011", "1020", "1021", "1030"]);
  expect(stored.find((a) => a.code === "0135")!.kind).toBe("asset");
  expect(stored.find((a) => a.code === "1400")!.kind).toBe("equity");
  expect(stored.find((a) => a.code === "1700")!.kind).toBe("liability");
});

it("refuses an entry whose lines do not sum to zero", async () => {
  const lines: EntryLine[] = [
    { accountCode: "4514", amountCents: 1000, note: null, assetId: null },
    { accountCode: "1010", amountCents: -999, note: null, assetId: null },
  ];
  await expect(manual("2027-01-10", lines)).rejects.toMatchObject({ code: "unbalanced", status: 400 });
  await expect(synced("kassa_day", "2027-01-10", "2027-01-10", lines)).rejects.toMatchObject({ code: "unbalanced", status: 400 });
  expect(() =>
    upsertSourcedStatements(env.DB, { date: "2027-01-10", description: "x", source: "kassa_day", sourceRef: "2027-01-10", lines }, null, NOW),
  ).toThrow(expect.objectContaining({ code: "unbalanced", status: 400 }));
  // Whole cents only: half a cent on both sides sums to zero but is no amount.
  await expect(manual("2027-01-10", move("4514", "1010", 0.5))).rejects.toMatchObject({ code: "amount_invalid", status: 400 });
  expect(await count("ledger_entries")).toBe(0);
  expect(await count("ledger_lines")).toBe(0);
});

it("numbers entries per year, one after the other", async () => {
  const first = await manual("2027-03-01");
  const second = await manual("2027-01-05");
  const third = await manual("2027-02-14");
  expect([first.number, second.number, third.number]).toEqual([1, 2, 3]);
  expect(first).toMatchObject({ year: 2027, date: "2027-03-01", description: "Bonnetje", source: "manual", sourceRef: null });
  expect(first.lines).toEqual(move("4514", "1010", 1250));
  expect(first).toMatchObject({ attachments: [], editable: true, changed: false });
});

it("refuses a date in a closed year, or before the ledger starts", async () => {
  await expect(manual("2026-12-31")).rejects.toMatchObject({ code: "year_unknown", status: 400 });
  await expect(synced("kassa_day", "2026-12-31", "2026-12-31", move("1000", "8011", 110))).rejects.toMatchObject({
    code: "year_unknown",
    status: 400,
  });
  const kept = await manual("2027-12-30");
  await closeByHand(2027);
  await expect(manual("2027-12-31")).rejects.toMatchObject({ code: "year_closed", status: 409 });
  await expect(synced("kassa_day", "2027-12-31", "2027-12-31", move("1000", "8011", 110))).rejects.toMatchObject({
    code: "year_closed",
    status: 409,
  });
  await expect(editEntry(env.DB, kept.id, { date: "2027-12-30", description: "Anders", lines: kept.lines }, NOW)).rejects.toMatchObject({
    code: "year_closed",
    status: 409,
  });
  await expect(emptyEntry(env.DB, kept.id, NOW)).rejects.toMatchObject({ code: "year_closed", status: 409 });
  expect((await getEntry(env.DB, kept.id))!).toMatchObject({ description: "Bonnetje", editable: false });
  expect(await count("ledger_entries")).toBe(1);
});

it("refuses an unknown account, and a hidden one for the penningmeester", async () => {
  await expect(manual("2027-01-10", move("9999", "1010", 500))).rejects.toMatchObject({ code: "account_unknown", status: 400 });
  await env.DB.prepare("UPDATE ledger_accounts SET hidden = 1 WHERE code = '4507'").run();
  await expect(manual("2027-01-10", move("4507", "1010", 500))).rejects.toMatchObject({ code: "account_hidden", status: 400 });
  const entry = await manual("2027-01-10");
  await expect(editEntry(env.DB, entry.id, { date: "2027-01-10", description: "EHBO", lines: move("4507", "1010", 500) }, NOW)).rejects.toMatchObject({
    code: "account_hidden",
    status: 400,
  });
  expect(await count("ledger_entries")).toBe(1);
});

it("lets a sync book on a hidden account", async () => {
  await env.DB.prepare("UPDATE ledger_accounts SET hidden = 1 WHERE code = '8011'").run();
  const entry = await synced("kassa_day", "2027-04-03", "2027-04-03", move("1000", "8011", 330));
  expect(entry.lines).toEqual(move("1000", "8011", 330));
  await expect(synced("kassa_day", "2027-04-04", "2027-04-04", move("1000", "9999", 330))).rejects.toMatchObject({
    code: "account_unknown",
    status: 400,
  });
});

it("keeps the history of an edit", async () => {
  const entry = await manual("2027-01-10");
  const edited = await editEntry(env.DB, entry.id, { date: "2027-01-11", description: "Pleisters", lines: move("4507", "1010", 1300) }, LATER);
  expect(edited).toMatchObject({ id: entry.id, number: entry.number, date: "2027-01-11", description: "Pleisters", changed: true });
  expect(edited.lines).toEqual(move("4507", "1010", 1300));
  expect(await entryHistory(env.DB, entry.id)).toEqual([
    {
      at: LATER.toISOString(),
      before: { date: "2027-01-10", description: "Bonnetje", lines: move("4514", "1010", 1250) },
      after: { date: "2027-01-11", description: "Pleisters", lines: move("4507", "1010", 1300) },
    },
  ]);
  // Saving it again as it is changes nothing and adds nothing to the history.
  await editEntry(env.DB, entry.id, { date: "2027-01-11", description: "Pleisters", lines: move("4507", "1010", 1300) }, LATER);
  expect(await entryHistory(env.DB, entry.id)).toHaveLength(1);
  await expect(editEntry(env.DB, "bestaat-niet", { date: "2027-01-11", description: "x", lines: [] }, LATER)).rejects.toMatchObject({
    code: "not_found",
    status: 404,
  });
  await expect(emptyEntry(env.DB, "bestaat-niet", LATER)).rejects.toMatchObject({ code: "not_found", status: 404 });
});

it("gives an entry moved to another year the next number there", async () => {
  await manual("2028-01-03");
  const entry = await manual("2027-12-31");
  const moved = await editEntry(env.DB, entry.id, { date: "2028-01-04", description: "Bonnetje", lines: entry.lines }, LATER);
  expect(moved).toMatchObject({ year: 2028, number: 2, date: "2028-01-04" });
});

it("empties an entry instead of deleting it", async () => {
  const entry = await manual("2027-01-10");
  const emptied = await emptyEntry(env.DB, entry.id, LATER);
  expect(emptied).toMatchObject({ id: entry.id, number: entry.number, date: "2027-01-10", description: "Bonnetje", lines: [], changed: true });
  const history = await entryHistory(env.DB, entry.id);
  expect(history).toHaveLength(1);
  expect(history[0]!.before!.lines).toEqual(move("4514", "1010", 1250));
  expect(history[0]!.after.lines).toEqual([]);
  expect(await count("ledger_entries")).toBe(1);
});

it("does not let the penningmeester edit what a sync wrote", async () => {
  const entry = await synced("kassa_day", "2027-04-03", "2027-04-03", move("1000", "8011", 330));
  expect(entry.editable).toBe(false);
  await expect(editEntry(env.DB, entry.id, { date: "2027-04-03", description: "Anders", lines: move("1000", "8012", 330) }, NOW)).rejects.toMatchObject({
    code: "not_editable",
    status: 409,
  });
  await expect(emptyEntry(env.DB, entry.id, NOW)).rejects.toMatchObject({ code: "not_editable", status: 409 });
  expect((await getEntry(env.DB, entry.id))!.lines).toEqual(move("1000", "8011", 330));
});

it("replaces the lines of a synced entry without history, and leaves it alone when nothing changed", async () => {
  const first = await synced("kassa_day", "2027-04-03", "2027-04-03", move("1000", "8011", 330));
  const second = await synced("kassa_day", "2027-04-03", "2027-04-03", move("1000", "8011", 440), LATER);
  expect(second).toMatchObject({ id: first.id, number: first.number, changed: false });
  expect(second.lines).toEqual(move("1000", "8011", 440));
  expect(await entryHistory(env.DB, first.id)).toEqual([]);
  const updatedAt = () => env.DB.prepare("SELECT updated_at FROM ledger_entries WHERE id = ?").bind(first.id).first<string>("updated_at");
  expect(await updatedAt()).toBe(LATER.toISOString());
  await synced("kassa_day", "2027-04-03", "2027-04-03", move("1000", "8011", 440), new Date("2027-03-03T12:00:00.000Z"));
  expect(await updatedAt()).toBe(LATER.toISOString());
  expect(await count("ledger_lines")).toBe(2);
});

it("writes one entry per source and reference, also when called twice at once", async () => {
  const one = move("1000", "8011", 330);
  const other = move("1000", "8012", 120);
  await Promise.all([synced("kassa_day", "2027-04-03", "2027-04-03", one), synced("kassa_day", "2027-04-03", "2027-04-03", other)]);
  const { results } = await env.DB.prepare("SELECT id FROM ledger_entries WHERE source = 'kassa_day' AND source_ref = '2027-04-03'").all<{
    id: string;
  }>();
  expect(results).toHaveLength(1);
  const lines = (await getEntry(env.DB, results[0]!.id))!.lines;
  expect([one, other]).toContainEqual(lines);
  await expect(
    createEntry(env.DB, { date: "2027-04-03", description: "Nog eens", source: "kassa_day", sourceRef: "2027-04-03", lines: one }, NOW),
  ).rejects.toMatchObject({ code: "entry_exists", status: 409 });
});

it("finds entries by period, account, text and amount", async () => {
  const huur = await manual("2027-01-05", move("4301", "1010", 50000), "Huur januari");
  const ehbo = await manual("2027-02-10", move("4507", "1010", 1250), "Pleisters");
  const kassa = await synced("kassa_day", "2027-02-11", "2027-02-11", move("1000", "8011", 1250));
  await manual("2028-01-05", move("4301", "1010", 50000), "Huur januari");
  const ids = async (filter: Omit<Parameters<typeof listEntries>[1], "year">) =>
    (await listEntries(env.DB, { year: 2027, ...filter })).map((entry) => entry.id);
  expect(await ids({})).toEqual([huur.id, ehbo.id, kassa.id]);
  expect(await ids({ from: "2027-02-01", to: "2027-02-10" })).toEqual([ehbo.id]);
  expect(await ids({ accountCode: "1010" })).toEqual([huur.id, ehbo.id]);
  expect(await ids({ text: "huur" })).toEqual([huur.id]);
  expect(await ids({ amountCents: 1250 })).toEqual([ehbo.id, kassa.id]);
  expect(await ids({ amountCents: -1250, accountCode: "8011" })).toEqual([kassa.id]);
  expect((await listEntries(env.DB, { year: 2027 }))[0]!.lines).toEqual(move("4301", "1010", 50000));
});

it("adds up balances up to a date", async () => {
  await manual("2027-01-10", move("4514", "1010", 1250));
  await manual("2027-01-31", move("4514", "1010", 750));
  await synced("kassa_day", "2027-01-20", "2027-01-20", move("1000", "8011", 330));
  await manual("2027-02-01", move("4514", "1010", 9999));
  const balances = await balancesOn(env.DB, "2027-01-31");
  expect(balances.get("4514")).toBe(2000);
  expect(balances.get("1010")).toBe(-2000);
  expect(balances.get("1000")).toBe(330);
  expect(balances.get("8011")).toBe(-330);
  expect(balances.has("4301")).toBe(false);
});

it("opens the next year by itself when the first entry for it arrives", async () => {
  expect(await yearStatus(env.DB, 2028)).toBeNull();
  expect(await firstOpenYear(env.DB)).toBe(2027);
  const entry = await manual("2028-01-02");
  expect(entry).toMatchObject({ year: 2028, number: 1, editable: true });
  expect(await yearStatus(env.DB, 2028)).toBe("open");
  await env.DB.batch(
    upsertSourcedStatements(
      env.DB,
      { date: "2029-01-01", description: "Kassa", source: "kassa_day", sourceRef: "2029-01-01", lines: move("1000", "8011", 110) },
      null,
      NOW,
    ),
  );
  expect(await yearStatus(env.DB, 2029)).toBe("open");
  await closeByHand(2027);
  expect(await yearStatus(env.DB, 2027)).toBe("closed");
  expect(await firstOpenYear(env.DB)).toBe(2028);
});

it("writes nothing into a closed year from the statement form either", async () => {
  const kept = await synced("kassa_day", "2027-12-30", "2027-12-30", move("1000", "8011", 330));
  const next = await synced("kassa_day", "2028-01-02", "2028-01-02", move("1000", "8011", 220));
  await closeByHand(2027);
  const statements = (date: string, sourceRef: string, existing: { id: string } | null) =>
    upsertSourcedStatements(env.DB, { date, description: "Kassa", source: "kassa_day", sourceRef, lines: move("1000", "8011", 110) }, existing, LATER);
  await env.DB.batch(statements("2027-12-31", "2027-12-31", null));
  await env.DB.batch(statements("2027-12-30", "2027-12-30", { id: kept.id }));
  // Nor out of it, nor into it from the open year.
  await env.DB.batch(statements("2028-01-01", "2027-12-30", { id: kept.id }));
  await env.DB.batch(statements("2027-12-29", "2028-01-02", { id: next.id }));
  expect(await count("ledger_entries")).toBe(2);
  expect(await getEntry(env.DB, kept.id)).toEqual(kept);
  expect(await getEntry(env.DB, next.id)).toEqual(next);
});
