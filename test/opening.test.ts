import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { LedgerError } from "../worker/db/ledger";
import { expectedCashAt, getOpening, setOpening } from "../worker/db/opening";
import { resetData } from "./helpers";

beforeEach(resetData);

const NOW = new Date("2027-01-05T12:00:00.000Z");
const LATER = new Date("2027-01-06T12:00:00.000Z");

const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

async function openingEntrySum() {
  const row = await env.DB.prepare(
    `SELECT COUNT(DISTINCT e.id) AS entries, COALESCE(SUM(l.amount_cents), 0) AS sum
     FROM ledger_entries e LEFT JOIN ledger_lines l ON l.entry_id = e.id WHERE e.source = 'opening'`,
  ).first<{ entries: number; sum: number }>();
  return row!;
}

async function handover(id: string, kind: "opening" | "handover", countedAt: string, leftCents: number) {
  await env.DB.prepare(
    "INSERT INTO handovers (id, kind, counted_at, expected_cents, received_cents, left_cents, difference_cents, note, created_at) VALUES (?1, ?2, ?3, 0, 0, ?4, 0, NULL, ?3)",
  )
    .bind(id, kind, countedAt, leftCents)
    .run();
}

async function cashSale(id: string, cents: number, soldAt: string, handoverId: string | null = null) {
  await env.DB.prepare(
    "INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date, handover_id) VALUES (?1, 'cash', 'paid', ?2, ?3, ?3, substr(?3, 1, 10), ?4)",
  )
    .bind(id, cents, soldAt, handoverId)
    .run();
}

it("works out equity so the opening balance always closes", async () => {
  const opening = await setOpening(
    env.DB,
    2027,
    {
      lines: [
        { accountCode: "1010", amountCents: 2_173_676 },
        { accountCode: "1020", amountCents: 9_344_653 },
        { accountCode: "1700", amountCents: 50_000 },
      ],
      eBoekhoudenEquityCents: null,
    },
    NOW,
  );
  expect(opening.equityCents).toBe(2_173_676 + 9_344_653 - 50_000);
  expect(opening.lines).toEqual([
    { accountCode: "1010", amountCents: 2_173_676 },
    { accountCode: "1020", amountCents: 9_344_653 },
    { accountCode: "1700", amountCents: 50_000 },
  ]);
  const { entries, sum } = await openingEntrySum();
  expect(entries).toBe(1);
  expect(sum).toBe(0);
  const entry = await env.DB.prepare("SELECT date, description, source_ref FROM ledger_entries WHERE source = 'opening'").first();
  expect(entry).toEqual({ date: "2027-01-01", description: "Beginbalans 2027", source_ref: "2027" });
  const equity = await env.DB.prepare("SELECT amount_cents FROM ledger_lines WHERE account_code = '1400'").first<{ amount_cents: number }>();
  expect(equity!.amount_cents).toBe(-(2_173_676 + 9_344_653 - 50_000));
});

it("turns accumulated depreciation (0135) into a credit", async () => {
  const opening = await setOpening(
    env.DB,
    2027,
    {
      lines: [
        { accountCode: "0130", amountCents: 100_000 },
        { accountCode: "0135", amountCents: 40_000 },
      ],
      eBoekhoudenEquityCents: null,
    },
    NOW,
  );
  expect(opening.equityCents).toBe(60_000);
  expect(opening.lines).toEqual([
    { accountCode: "0130", amountCents: 100_000 },
    { accountCode: "0135", amountCents: 40_000 },
  ]);
  const row = await env.DB.prepare("SELECT amount_cents FROM ledger_lines WHERE account_code = '0135'").first<{ amount_cents: number }>();
  expect(row!.amount_cents).toBe(-40_000);
});

it("shows the difference with equity in e-Boekhouden", async () => {
  await setOpening(env.DB, 2027, { lines: [{ accountCode: "1010", amountCents: 1_000_000 }], eBoekhoudenEquityCents: 24_662_912 }, NOW);
  const opening = await getOpening(env.DB, 2027, NOW);
  expect(opening.eBoekhoudenEquityCents).toBe(24_662_912);
  expect(opening.equityCents).toBe(1_000_000);
  expect(opening.equityCents).not.toBe(opening.eBoekhoudenEquityCents);
  const kassa = await env.DB.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'ledger_%'").first<{ n: number }>();
  expect(kassa!.n).toBe(0);
});

it("replaces the opening balance when typed again", async () => {
  await setOpening(env.DB, 2027, { lines: [{ accountCode: "1010", amountCents: 500 }], eBoekhoudenEquityCents: 1 }, NOW);
  const second = await setOpening(
    env.DB,
    2027,
    { lines: [{ accountCode: "1020", amountCents: 700 }, { accountCode: "1010", amountCents: 0 }], eBoekhoudenEquityCents: null },
    LATER,
  );
  expect(second.lines).toEqual([{ accountCode: "1020", amountCents: 700 }]);
  expect(second.equityCents).toBe(700);
  expect(second.eBoekhoudenEquityCents).toBeNull();
  expect((await openingEntrySum()).entries).toBe(1);
  expect(await count("ledger_entries")).toBe(1);
});

it("gives an empty opening when none was typed", async () => {
  const opening = await getOpening(env.DB, 2028, NOW);
  expect(opening).toMatchObject({ year: 2028, lines: [], equityCents: 0, eBoekhoudenEquityCents: null });
});

it("refuses an income or expense account in the opening balance", async () => {
  await expect(
    setOpening(env.DB, 2027, { lines: [{ accountCode: "8011", amountCents: 100 }], eBoekhoudenEquityCents: null }, NOW),
  ).rejects.toMatchObject({ code: "not_balance_account", status: 400 });
  expect(await count("ledger_entries")).toBe(0);
});

it("does not take equity (1400) as typed, nor an unknown account", async () => {
  await expect(
    setOpening(env.DB, 2027, { lines: [{ accountCode: "1400", amountCents: 100 }], eBoekhoudenEquityCents: null }, NOW),
  ).rejects.toMatchObject({ code: "equity_computed", status: 400 });
  await expect(
    setOpening(env.DB, 2027, { lines: [{ accountCode: "9999", amountCents: 100 }], eBoekhoudenEquityCents: null }, NOW),
  ).rejects.toBeInstanceOf(LedgerError);
});

it("only opens the first year of the ledger", async () => {
  await expect(setOpening(env.DB, 2028, { lines: [], eBoekhoudenEquityCents: null }, NOW)).rejects.toMatchObject({
    code: "not_first_year",
    status: 409,
  });
});

it("tells what belonged in the kluisje at a moment", async () => {
  await handover("open", "opening", "2026-12-01T10:00:00.000Z", 5000);
  await cashSale("a", 220, "2027-01-10T10:00:00.000Z");
  await cashSale("b", 110, "2027-01-10T12:00:00.000Z");
  expect(await expectedCashAt(env.DB, "2027-01-10T11:00:00.000Z")).toBe(5220);
  expect(await expectedCashAt(env.DB, "2027-01-10T13:00:00.000Z")).toBe(5330);
  expect(await expectedCashAt(env.DB, "2026-11-30T00:00:00.000Z")).toBe(0);
});

it("counts only paid cash sales, with reversals", async () => {
  await handover("open", "opening", "2026-12-01T10:00:00.000Z", 1000);
  await cashSale("a", 500, "2027-01-10T10:00:00.000Z");
  await cashSale("r", -500, "2027-01-10T10:30:00.000Z");
  await env.DB.prepare(
    "INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date) VALUES ('p','pin','paid',900,'2027-01-10T10:00:00.000Z','2027-01-10T10:00:00.000Z','2027-01-10')",
  ).run();
  await env.DB.prepare(
    "INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date) VALUES ('f','cash','failed',700,'2027-01-10T10:00:00.000Z','2027-01-10T10:00:00.000Z','2027-01-10')",
  ).run();
  expect(await expectedCashAt(env.DB, "2027-01-11T00:00:00.000Z")).toBe(1000);
});

it("counts a sale that arrived after a handover but was sold before it, at a moment after that handover", async () => {
  await handover("open", "opening", "2026-12-01T10:00:00.000Z", 5000);
  await handover("h1", "handover", "2027-01-10T12:00:00.000Z", 2000);
  await cashSale("early", 300, "2027-01-10T11:00:00.000Z", "h1"); // closed by h1
  await cashSale("late", 400, "2027-01-10T11:30:00.000Z"); // sold before h1, arrived after: not closed
  // before h1 both count on top of the opening; after h1 only the late one counts on top of h1's left_cents
  expect(await expectedCashAt(env.DB, "2027-01-10T11:45:00.000Z")).toBe(5000 + 300 + 400);
  expect(await expectedCashAt(env.DB, "2027-01-10T13:00:00.000Z")).toBe(2000 + 400);
});

it("gives the expected cash at the end of the year before", async () => {
  await handover("open", "opening", "2026-12-01T10:00:00.000Z", 5000);
  await cashSale("dec", 250, "2026-12-31T22:30:00.000Z"); // 23:30 in Amsterdam on 31 December
  await cashSale("jan", 100, "2026-12-31T23:30:00.000Z"); // 00:30 on 1 January
  const opening = await setOpening(env.DB, 2027, { lines: [], eBoekhoudenEquityCents: null }, NOW);
  expect(opening.expectedCashCents).toBe(5250);
});
