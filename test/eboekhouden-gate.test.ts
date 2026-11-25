import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { CamtLine } from "../shared/camt";
import { autoBook, importLines, openLines } from "../worker/db/bank";
import { eboekhoudenDone } from "../worker/db/eboekhouden";
import { createEntry } from "../worker/db/ledger";
import { syncKassa } from "../worker/db/kassa-ledger";
import { overview } from "../worker/db/ledger-reports";
import { syncMolliePayments } from "../worker/db/mollie-ledger";
import type { Env } from "../worker/env";
import { meteredDb, openGate, resetData, useFakeMollie } from "./helpers";

// Until the auditfile of e-Boekhouden is read in, the app books nothing by itself: it stores what arrives
// (bank lines, Mollie payments, balances) and waits. Nothing it leaves undone may be skipped later.

const mollie = useFakeMollie();

beforeEach(async () => {
  await resetData();
  await env.DB.prepare("DELETE FROM settings WHERE key = 'in_use_since'").run();
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('in_use_since', '2026-11-21T09:00:00.000Z')").run();
});

const count = async (from: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${from}`).first<{ n: number }>())!.n;
const setting = async (key: string) => (await env.DB.prepare("SELECT value FROM ledger_settings WHERE key = ?").bind(key).first<{ value: string }>())?.value ?? null;

async function cashSale(date: string) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date) VALUES (?1, 'cash', 'paid', 110, ?2, ?2, ?3)`,
    ).bind(id, `${date}T10:00:00.000Z`, date),
    env.DB.prepare(
      `INSERT INTO sale_lines (sale_id, product_id, name, category_id, category_name, unit_price_cents, qty) VALUES (?1, 'aardbeitje', 'Aardbeitje', 'ijs', 'IJs', 110, 1)`,
    ).bind(id),
  ]);
}

const kasstorting: CamtLine = {
  bookingDate: "2026-11-26",
  amountCents: 5470,
  description: "kasstorting",
  counterpartyName: null,
  counterpartyIban: null,
  bankRef: null,
};

const orgEnv = (): Env => ({ ...env, MOLLIE_ORG_TOKEN: "org_fake" });
const syncMollie = (now: string) => syncMolliePayments(orgEnv(), new Date(now));
const paid = (id: string, amount: string, description: string, paidAt: string) =>
  mollie.current.addPayment({ id, method: "ideal", amount, description, status: "paid", createdAt: new Date(Date.parse(paidAt) - 60_000).toISOString(), paidAt });

it("is closed until finishImport has written its key", async () => {
  expect(await eboekhoudenDone(env.DB)).toBe(false);
  await openGate();
  expect(await eboekhoudenDone(env.DB)).toBe(true);
});

it("books no kassa day while 2026 waits for e-Boekhouden", async () => {
  await cashSale("2026-11-21");
  expect(await syncKassa(env.DB, new Date("2026-11-22T08:00:00.000Z"))).toEqual({ days: 0, late: 0, handovers: 0, left: 0 });
  expect(await count("ledger_entries")).toBe(0);
  // The closed gate leaves no marker behind that would make the next run skip the day.
  expect(await setting("ledger_kassa_synced_at")).toBeNull();

  await openGate();
  expect(await syncKassa(env.DB, new Date("2026-11-22T08:00:00.000Z"))).toEqual({ days: 1, late: 0, handovers: 0, left: 0 });
  expect(await count("ledger_entries WHERE source = 'kassa_day' AND source_ref = '2026-11-21'")).toBe(1);
});

it("stores bank lines but books none while it waits", async () => {
  await importLines(env.DB, "1010", [kasstorting], "file", new Date("2026-11-27T08:00:00.000Z"));
  expect(await autoBook(env.DB, new Date("2026-11-27T08:00:00.000Z"))).toBe(0);
  expect((await openLines(env.DB, { accountCode: "1010" })).map((line) => line.status)).toEqual(["open"]);
  expect(await count("ledger_entries")).toBe(0);

  await openGate();
  expect(await autoBook(env.DB, new Date("2026-11-27T08:00:00.000Z"))).toBe(1);
  expect(await openLines(env.DB, { accountCode: "1010" })).toEqual([]);
  expect(await count("ledger_entries WHERE source = 'bank'")).toBe(1);
});

it("stores Mollie payments but books none while it waits", async () => {
  paid("tr_rule", "1.20", "2x dagkaartje", "2026-11-03T09:00:00+00:00");
  expect(await syncMollie("2026-11-04T02:00:00.000Z")).toBe("ok");
  expect(await env.DB.prepare("SELECT kind, booked FROM mollie_payments WHERE id = 'tr_rule'").first()).toEqual({ kind: "rule", booked: 0 });
  expect(await count("ledger_entries")).toBe(0);
});

it("books the Mollie payments that waited once the gate opens", async () => {
  paid("tr_rule", "1.20", "2x dagkaartje", "2026-11-03T09:00:00+00:00");
  expect(await syncMollie("2026-11-04T02:00:00.000Z")).toBe("ok");
  expect(await count("ledger_entries")).toBe(0);

  await openGate();
  // A newer payment moves the look-back window past the waiting one; it is found in the database instead.
  paid("tr_newer", "2.00", "dagticket", "2026-11-20T09:00:00+00:00");
  expect(await syncMollie("2026-11-21T02:00:00.000Z")).toBe("ok");
  expect(await env.DB.prepare("SELECT booked FROM mollie_payments WHERE id = 'tr_rule'").first()).toEqual({ booked: 1 });
  expect(await count("ledger_entries WHERE source = 'mollie_other' AND source_ref = '2026-11-03'")).toBe(1);
});

it("numbers the imported year before the app's own entries", async () => {
  await cashSale("2026-11-21");
  await syncKassa(env.DB, new Date("2026-11-22T08:00:00.000Z"));
  // finishImport writes the opening first, and only then opens the gate.
  const opening = await createEntry(
    env.DB,
    {
      date: "2026-01-01",
      description: "Openingsbalans",
      source: "opening",
      lines: [
        { accountCode: "1010", amountCents: 1000, note: null, assetId: null },
        { accountCode: "0130", amountCents: -1000, note: null, assetId: null },
      ],
    },
    new Date("2026-11-25T12:00:00.000Z"),
  );
  await openGate();
  await syncKassa(env.DB, new Date("2026-11-26T08:00:00.000Z"));
  const kassa = await env.DB.prepare("SELECT number FROM ledger_entries WHERE source = 'kassa_day'").first<{ number: number }>();
  expect(kassa!.number).toBeGreaterThan(opening.number);
});

it("tells the overview the books wait for e-Boekhouden", async () => {
  expect((await overview(env.DB, new Date("2026-11-26T08:00:00.000Z"))).eboekhoudenDone).toBe(false);
  await openGate();
  expect((await overview(env.DB, new Date("2026-11-26T08:00:00.000Z"))).eboekhoudenDone).toBe(true);
});

it("shows no kas difference while it waits", async () => {
  // € 50 in the kluisje at the first count and a cash sale: neither is in the books before the import.
  await env.DB.prepare(
    "INSERT INTO handovers (id, kind, counted_at, expected_cents, received_cents, left_cents, difference_cents, note, created_at) VALUES ('h0', 'opening', '2026-11-21T08:00:00.000Z', 0, 0, 5000, 0, NULL, '2026-11-21T08:00:00.000Z')",
  ).run();
  await cashSale("2026-11-22");
  const now = new Date("2026-11-26T08:00:00.000Z");
  expect((await overview(env.DB, now)).cashDifferenceCents).toBe(0);

  await openGate();
  await syncKassa(env.DB, now);
  // Once it is read in, the float that is no booking shows.
  expect((await overview(env.DB, now)).cashDifferenceCents).toBe(-5000);
});

it("adds no database call of its own", async () => {
  await importLines(env.DB, "1010", [kasstorting], "file", new Date("2026-11-27T08:00:00.000Z"));
  await openGate();
  const open = meteredDb(env.DB);
  await autoBook(open.db, new Date("2026-11-27T08:00:00.000Z"));
  const withOpen = open.calls();
  await env.DB.prepare("DELETE FROM ledger_settings WHERE key = 'eboekhouden_imported_at'").run();
  const closed = meteredDb(env.DB);
  await autoBook(closed.db, new Date("2026-11-27T08:00:00.000Z"));
  // Closed, autoBook reads the gate together with its other reads and stops: one call.
  expect(closed.calls()).toBe(1);
  expect(withOpen).toBeGreaterThan(1);
});
