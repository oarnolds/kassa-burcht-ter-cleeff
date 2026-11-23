import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { Entry } from "../shared/ledger-types";
import { shiftDate } from "../shared/time";
import { getCashState, recordHandover } from "../worker/db/cash";
import { syncKassa } from "../worker/db/kassa-ledger";
import { balancesOn, getEntry } from "../worker/db/ledger";
import { exportAll } from "../worker/db/maintenance";
import { getOpening, setOpening } from "../worker/db/opening";
import { dayReport } from "../worker/db/reports";
import { meteredDb, resetData } from "./helpers";

// The kassa routes stamp sales with today's date (2026), before the ledger starts. These tests set up the
// kassa's rows for 2027 and later directly, as the kassa itself would have written them.

const IN_USE = "2026-11-21T09:00:00.000Z";

beforeEach(async () => {
  await resetData();
  await setInUse(IN_USE);
});

async function setInUse(value: string | null) {
  await env.DB.prepare("DELETE FROM settings WHERE key = 'in_use_since'").run();
  if (value !== null) await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('in_use_since', ?)").bind(value).run();
}

type Item = { productId: string; name: string; categoryId: string; categoryName: string; priceCents: number };
const AARDBEITJE: Item = { productId: "aardbeitje", name: "Aardbeitje", categoryId: "ijs", categoryName: "IJs", priceCents: 110 };
const LIMONADE: Item = { productId: "limonade", name: "Limonade", categoryId: "koud", categoryName: "Koude dranken", priceCents: 65 };
const KOFFIE: Item = { productId: "koffie", name: "Koffie", categoryId: "warm", categoryName: "Warme dranken", priceCents: 140 };
const ENTREE: Item = { productId: "entreegeld", name: "Entreegeld", categoryId: "entree", categoryName: "Entree", priceCents: 60 };
const STATIEGELD: Item = { productId: "statiegeld", name: "Statiegeld", categoryId: "statiegeld", categoryName: "Statiegeld", priceCents: 15 };
/** A category the boekhouding has no account for: it books on 8011. */
const BAL: Item = { productId: "bal", name: "Bal", categoryId: "speelgoed", categoryName: "Speelgoed", priceCents: 250 };

type Sale = {
  id: string;
  date: string;
  method: "cash" | "pin";
  status: "paid" | "pending" | "failed";
  lines: [Item, number][];
  receivedAt: string;
  settledAt: string | null;
  reverses: string | null;
};

function saleOf(spec: Partial<Sale> & Pick<Sale, "date" | "lines">): Sale {
  return {
    id: crypto.randomUUID(),
    method: "cash",
    status: "paid",
    receivedAt: `${spec.date}T10:00:00.000Z`,
    settledAt: null,
    reverses: null,
    ...spec,
  };
}

function saleStatements(sale: Sale): D1PreparedStatement[] {
  const total = sale.lines.reduce((sum, [item, qty]) => sum + item.priceCents * qty, 0);
  return [
    env.DB.prepare(
      `INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date, reverses_sale_id, settled_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(sale.id, sale.method, sale.status, total, `${sale.date}T10:00:00.000Z`, sale.receivedAt, sale.date, sale.reverses, sale.settledAt),
    ...sale.lines.map(([item, qty]) =>
      env.DB.prepare(
        "INSERT INTO sale_lines (sale_id, product_id, name, category_id, category_name, unit_price_cents, qty) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      ).bind(sale.id, item.productId, item.name, item.categoryId, item.categoryName, item.priceCents, qty),
    ),
  ];
}

/** A paid cash sale sold at 10:00 UTC on `date` and received then, unless told otherwise. */
async function sale(spec: Partial<Sale> & Pick<Sale, "date" | "lines">): Promise<Sale> {
  const made = saleOf(spec);
  await env.DB.batch(saleStatements(made));
  return made;
}

/** The kassa's counter-entry: the same lines negated, on the day it is made. */
function reverse(original: Sale, date: string, receivedAt = `${date}T10:00:00.000Z`): Promise<Sale> {
  return sale({ date, method: original.method, lines: original.lines.map(([item, qty]) => [item, -qty]), receivedAt, reverses: original.id });
}

async function handover(h: { kind?: "opening" | "handover"; countedAt: string; expected?: number; received?: number; left?: number; note?: string | null }) {
  const id = crypto.randomUUID();
  const expected = h.expected ?? 0;
  const received = h.received ?? 0;
  const left = h.left ?? 0;
  await env.DB.prepare(
    `INSERT INTO handovers (id, kind, counted_at, expected_cents, received_cents, left_cents, difference_cents, note, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?3)`,
  )
    .bind(id, h.kind ?? "handover", h.countedAt, expected, received, left, expected - received - left, h.note ?? null)
    .run();
  return id;
}

async function entry(source: string, ref: string): Promise<Entry | null> {
  const row = await env.DB.prepare("SELECT id FROM ledger_entries WHERE source = ? AND source_ref = ?").bind(source, ref).first<{ id: string }>();
  return row ? getEntry(env.DB, row.id) : null;
}

const amounts = (e: Entry | null) => e?.lines.map((line) => [line.accountCode, line.amountCents]);

const refs = async (source: string) =>
  (await env.DB.prepare("SELECT source_ref FROM ledger_entries WHERE source = ? ORDER BY source_ref").bind(source).all<{ source_ref: string }>()).results.map(
    (row) => row.source_ref,
  );

const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

const marker = async () =>
  (await env.DB.prepare("SELECT value FROM ledger_settings WHERE key = 'ledger_kassa_synced_at'").first<{ value: string }>())?.value ?? null;

const NOTHING = { days: 0, late: 0, handovers: 0, left: 0 };

it("books a day of the kassa per kind, cash to Kas and pin to Mollie", async () => {
  await sale({ date: "2027-03-06", lines: [[AARDBEITJE, 2]] });
  await sale({ date: "2027-03-06", method: "pin", lines: [[ENTREE, 1]] });
  // A pin payment that did not go through, or has not yet, is not revenue.
  await sale({ date: "2027-03-06", method: "pin", status: "pending", lines: [[KOFFIE, 1]] });
  await sale({ date: "2027-03-06", method: "pin", status: "failed", lines: [[KOFFIE, 3]] });

  expect(await syncKassa(env.DB, new Date("2027-03-07T08:00:00.000Z"))).toEqual({ days: 1, late: 0, handovers: 0, left: 0 });
  const day = await entry("kassa_day", "2027-03-06");
  expect(day).toMatchObject({ year: 2027, date: "2027-03-06", description: "Kassa 6-3-2027", source: "kassa_day", sourceRef: "2027-03-06", editable: false });
  expect(amounts(day)).toEqual([
    ["1000", 220],
    ["1030", 60],
    ["8011", -220],
    ["8012", -60],
  ]);
  expect(await count("ledger_entries")).toBe(1);
});

it("equals the kassa's own day report, also after a reversal", async () => {
  const first = await sale({ date: "2027-06-05", lines: [[AARDBEITJE, 2], [LIMONADE, 1]] });
  const pin = await sale({ date: "2027-06-05", method: "pin", lines: [[ENTREE, 3], [KOFFIE, 1]] });
  await sale({ date: "2027-06-05", lines: [[STATIEGELD, 2], [BAL, 1]] });
  await reverse(first, "2027-06-05");
  await reverse(pin, "2027-06-06"); // a reversal counts on the day it is made
  await sale({ date: "2027-06-06", lines: [[KOFFIE, 2]] });

  expect(await syncKassa(env.DB, new Date("2027-06-07T08:00:00.000Z"))).toEqual({ days: 2, late: 0, handovers: 0, left: 0 });

  const accountOf = new Map(
    (await env.DB.prepare("SELECT category_id, account_code FROM category_accounts").all<{ category_id: string; account_code: string }>()).results.map((row) => [
      row.category_id,
      row.account_code,
    ]),
  );
  for (const date of ["2027-06-05", "2027-06-06"]) {
    const report = await dayReport(env.DB, date);
    const expected = new Map<string, number>([
      ["1000", report.totals.cashCents],
      ["1030", report.totals.pinCents],
    ]);
    for (const row of report.byCategory) {
      const code = accountOf.get(row.categoryId) ?? "8011";
      expected.set(code, (expected.get(code) ?? 0) - row.totalCents);
    }
    const nonZero = [...expected].filter(([, cents]) => cents !== 0).sort(([a], [b]) => (a < b ? -1 : 1));
    expect(amounts(await entry("kassa_day", date))).toEqual(nonZero);
  }
  // The figures themselves: ijs and koud are reversed away; statiegeld, the bal (no account: 8011) and koffie stay.
  expect(amounts(await entry("kassa_day", "2027-06-05"))).toEqual([
    ["1000", 280],
    ["1030", 320],
    ["8011", -420],
    ["8012", -180],
  ]);
  expect(amounts(await entry("kassa_day", "2027-06-06"))).toEqual([
    ["1000", 280],
    ["1030", -320],
    ["8011", -140],
    ["8012", 180],
  ]);
});

it("takes a late sale into its own day while the year is open", async () => {
  await sale({ date: "2027-05-01", lines: [[AARDBEITJE, 1]], receivedAt: "2027-05-01T10:00:00.000Z" });
  const pending = await sale({ date: "2027-05-01", method: "pin", status: "pending", lines: [[ENTREE, 2]], receivedAt: "2027-05-01T11:00:00.000Z" });
  expect(await syncKassa(env.DB, new Date("2027-05-01T20:00:00.000Z"))).toEqual({ days: 1, late: 0, handovers: 0, left: 0 });
  expect(amounts(await entry("kassa_day", "2027-05-01"))).toEqual([
    ["1000", 110],
    ["8011", -110],
  ]);
  await sale({ date: "2027-05-02", lines: [[KOFFIE, 1]], receivedAt: "2027-05-02T10:00:00.000Z" });
  expect(await syncKassa(env.DB, new Date("2027-05-02T20:00:00.000Z"))).toEqual({ days: 1, late: 0, handovers: 0, left: 0 });

  // The iPad was offline: a sale of 1 May arrives on 3 May. It belongs to 1 May.
  await sale({ date: "2027-05-01", lines: [[LIMONADE, 2]], receivedAt: "2027-05-03T09:00:00.000Z" });
  expect(await syncKassa(env.DB, new Date("2027-05-03T20:00:00.000Z"))).toEqual({ days: 1, late: 0, handovers: 0, left: 0 });
  expect(amounts(await entry("kassa_day", "2027-05-01"))).toEqual([
    ["1000", 240],
    ["8011", -240],
  ]);

  // The pin payment of 1 May goes through later: the sale keeps its received_at and gets a settled_at.
  await env.DB.prepare("UPDATE sales SET status = 'paid', settled_at = ?2 WHERE id = ?1").bind(pending.id, "2027-05-04T09:00:00.000Z").run();
  expect(await syncKassa(env.DB, new Date("2027-05-04T20:00:00.000Z"))).toEqual({ days: 1, late: 0, handovers: 0, left: 0 });
  expect(amounts(await entry("kassa_day", "2027-05-01"))).toEqual([
    ["1000", 240],
    ["1030", 120],
    ["8011", -240],
    ["8012", -120],
  ]);

  expect(await refs("kassa_day")).toEqual(["2027-05-01", "2027-05-02"]);
  expect(await refs("kassa_late")).toEqual([]);
  // Nothing new: nothing written.
  expect(await syncKassa(env.DB, new Date("2027-05-05T20:00:00.000Z"))).toEqual(NOTHING);
});

it("books a late sale for a closed year on 1 January of the open year", async () => {
  await sale({ date: "2027-12-31", lines: [[AARDBEITJE, 2]], receivedAt: "2027-12-31T15:00:00.000Z" });
  await syncKassa(env.DB, new Date("2027-12-31T20:00:00.000Z"));
  const booked = await entry("kassa_day", "2027-12-31");
  expect(amounts(booked)).toEqual([
    ["1000", 220],
    ["8011", -220],
  ]);
  await env.DB.prepare("UPDATE ledger_years SET status = 'closed', closed_at = '2028-01-02T10:00:00.000Z' WHERE year = 2027").run();

  // The iPad was offline over New Year: a pin sale of 31 December arrives after 2027 was closed.
  await sale({ date: "2027-12-31", method: "pin", lines: [[ENTREE, 1]], receivedAt: "2028-01-03T10:00:00.000Z" });
  expect(await syncKassa(env.DB, new Date("2028-01-03T12:00:00.000Z"))).toEqual({ days: 0, late: 1, handovers: 0, left: 0 });
  const late = await entry("kassa_late", "2027-12-31");
  expect(late).toMatchObject({ year: 2028, date: "2028-01-01", description: "Nagekomen kassaverkoop 31-12-2027", source: "kassa_late" });
  expect(amounts(late)).toEqual([
    ["1030", 60],
    ["8012", -60],
  ]);
  expect(await entry("kassa_day", "2027-12-31")).toEqual(booked);
  expect(await env.DB.prepare("SELECT status FROM ledger_years WHERE year = 2028").first()).toEqual({ status: "open" });

  // Another one for that day: the late entry holds everything that came after the year was closed.
  await sale({ date: "2027-12-31", lines: [[KOFFIE, 1]], receivedAt: "2028-01-04T10:00:00.000Z" });
  expect(await syncKassa(env.DB, new Date("2028-01-04T12:00:00.000Z"))).toEqual({ days: 0, late: 1, handovers: 0, left: 0 });
  expect(amounts(await entry("kassa_late", "2027-12-31"))).toEqual([
    ["1000", 140],
    ["1030", 60],
    ["8011", -140],
    ["8012", -60],
  ]);
  expect(await entry("kassa_day", "2027-12-31")).toEqual(booked);
  expect(await refs("kassa_late")).toEqual(["2027-12-31"]);
  expect(await syncKassa(env.DB, new Date("2028-01-05T12:00:00.000Z"))).toEqual(NOTHING);
});

it("leaves a day for the next run when its year is closed while the run writes", async () => {
  await sale({ date: "2027-12-30", lines: [[AARDBEITJE, 1]], receivedAt: "2027-12-30T15:00:00.000Z" });
  // The penningmeester closes 2027 in another window at the very moment the run writes: after its reads, before
  // its first write (recognised by the ledger's statement that opens the entry's year).
  let writing = false;
  let closedNow = false;
  const racing = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          if (sql.includes("INTO ledger_years")) writing = true;
          return target.prepare(sql);
        };
      }
      if (prop === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (writing && !closedNow) {
            closedNow = true;
            await target.prepare("UPDATE ledger_years SET status = 'closed' WHERE year = 2027").run();
          }
          return target.batch(statements);
        };
      }
      return Reflect.get(target, prop);
    },
  });
  const now = new Date("2028-01-02T12:00:00.000Z");
  expect(await syncKassa(racing, now)).toEqual({ days: 0, late: 0, handovers: 0, left: 1 });
  expect(closedNow).toBe(true);
  expect(await count("ledger_entries")).toBe(0);
  expect(await marker()).toBeNull();

  // The next run finds the day again, now in a closed year.
  expect(await syncKassa(env.DB, now)).toEqual({ days: 0, late: 1, handovers: 0, left: 0 });
  expect(await entry("kassa_late", "2027-12-30")).toMatchObject({ year: 2028, date: "2028-01-01", description: "Nagekomen kassaverkoop 30-12-2027" });
  expect(amounts(await entry("kassa_late", "2027-12-30"))).toEqual([
    ["1000", 110],
    ["8011", -110],
  ]);
});

it("books nothing before the ingebruikname or before 2027", async () => {
  // Not in use yet: nothing at all.
  await setInUse(null);
  await sale({ date: "2027-01-04", lines: [[AARDBEITJE, 1]] });
  await handover({ countedAt: "2027-01-05T16:00:00.000Z", expected: 110, received: 110 });
  expect(await syncKassa(env.DB, new Date("2027-01-06T12:00:00.000Z"))).toEqual(NOTHING);
  expect(await count("ledger_entries")).toBe(0);

  // In use since 21 November 2026: what was sold or counted in 2026 stays in e-Boekhouden, the opening count too.
  await setInUse(IN_USE);
  await handover({ kind: "opening", countedAt: IN_USE, left: 5000 });
  await sale({ date: "2026-12-31", lines: [[KOFFIE, 1]] });
  await handover({ countedAt: "2026-12-31T16:00:00.000Z", expected: 5140, received: 140, left: 5000 });
  expect(await syncKassa(env.DB, new Date("2027-01-06T12:00:00.000Z"))).toEqual({ days: 1, late: 0, handovers: 1, left: 0 });
  expect(await refs("kassa_day")).toEqual(["2027-01-04"]);
  expect(await count("ledger_entries")).toBe(2);

  // Had the kassa come into use on 10 March 2027, the days and counts before it would stay out as well.
  await setInUse("2027-03-10T08:00:00.000Z");
  await handover({ kind: "opening", countedAt: "2027-03-10T08:00:00.000Z", left: 5000 });
  await sale({ date: "2027-03-09", lines: [[KOFFIE, 1]], receivedAt: "2027-03-10T12:00:00.000Z" });
  await sale({ date: "2027-03-10", lines: [[KOFFIE, 2]], receivedAt: "2027-03-10T12:00:00.000Z" });
  await handover({ countedAt: "2027-03-09T16:00:00.000Z", expected: 140, received: 140 });
  expect(await syncKassa(env.DB, new Date("2027-03-11T12:00:00.000Z"))).toEqual({ days: 1, late: 0, handovers: 0, left: 0 });
  expect(await refs("kassa_day")).toEqual(["2027-01-04", "2027-03-10"]);
  expect(await count("ledger_entries")).toBe(3);
});

it("books a handover with its difference", async () => {
  await handover({ kind: "opening", countedAt: IN_USE, left: 5000 });
  const short = await handover({ countedAt: "2027-04-12T15:30:00.000Z", expected: 5470, received: 400, left: 5000, note: "Tekort van 70 cent" });
  expect(await syncKassa(env.DB, new Date("2027-04-13T12:00:00.000Z"))).toEqual({ days: 0, late: 0, handovers: 1, left: 0 });
  const booked = await entry("handover", short);
  expect(booked).toMatchObject({ year: 2027, date: "2027-04-12", description: "Afdracht kluisje – Tekort van 70 cent", source: "handover" });
  expect(amounts(booked)).toEqual([
    ["1000", -470],
    ["1080", 400],
    ["4515", 70],
  ]);

  // A surplus is a credit on 4515; an exact count has no 4515 line. Dated in Amsterdam: 00:30 on 20 April.
  const surplus = await handover({ countedAt: "2027-04-19T22:30:00.000Z", expected: 5300, received: 350, left: 5000 });
  const exact = await handover({ countedAt: "2027-04-26T15:30:00.000Z", expected: 5200, received: 200, left: 5000, note: "  " });
  expect(await syncKassa(env.DB, new Date("2027-04-27T12:00:00.000Z"))).toEqual({ days: 0, late: 0, handovers: 2, left: 0 });
  expect(await entry("handover", surplus)).toMatchObject({ date: "2027-04-20", description: "Afdracht kluisje" });
  expect(amounts(await entry("handover", surplus))).toEqual([
    ["1000", -300],
    ["1080", 350],
    ["4515", -50],
  ]);
  expect(await entry("handover", exact)).toMatchObject({ date: "2027-04-26", description: "Afdracht kluisje" });
  expect(amounts(await entry("handover", exact))).toEqual([
    ["1000", -200],
    ["1080", 200],
  ]);

  // The opening count is in the beginbalans, not an entry; and each handover is booked once.
  expect(await count("ledger_entries")).toBe(3);
  expect(await syncKassa(env.DB, new Date("2027-04-28T12:00:00.000Z"))).toEqual(NOTHING);
});

it("books a handover dated in a closed year on 1 January of the open year", async () => {
  await env.DB.prepare("UPDATE ledger_years SET status = 'closed', closed_at = '2028-01-02T10:00:00.000Z' WHERE year = 2027").run();
  const id = await handover({ countedAt: "2027-12-31T15:00:00.000Z", expected: 2000, received: 1900, left: 0, note: "Laatste dag" });
  expect(await syncKassa(env.DB, new Date("2028-01-05T12:00:00.000Z"))).toEqual({ days: 0, late: 0, handovers: 1, left: 0 });
  const booked = await entry("handover", id);
  expect(booked).toMatchObject({ year: 2028, date: "2028-01-01", description: "Afdracht kluisje – Laatste dag" });
  expect(amounts(booked)).toEqual([
    ["1000", -2000],
    ["1080", 1900],
    ["4515", 100],
  ]);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE year = 2027").first()).toEqual({ n: 0 });
});

it("keeps Kas equal to what belongs in the kluisje", async () => {
  // The kassa came into use with € 50 in the kluisje; a sale in December 2026 is still in e-Boekhouden.
  await recordHandover(env.DB, { kind: "opening", countedAt: IN_USE, receivedCents: 0, leftCents: 5000, note: null }, new Date(IN_USE));
  await sale({ date: "2026-12-20", lines: [[KOFFIE, 2]] });
  const { expectedCashCents } = await getOpening(env.DB, 2027, new Date("2027-01-02T12:00:00.000Z"));
  expect(expectedCashCents).toBe(5280);
  await setOpening(env.DB, 2027, { lines: [{ accountCode: "1000", amountCents: expectedCashCents }], eBoekhoudenEquityCents: null }, new Date("2027-01-02T12:00:00.000Z"));

  await sale({ date: "2027-01-10", lines: [[AARDBEITJE, 2]] });
  await sale({ date: "2027-01-10", method: "pin", lines: [[ENTREE, 4]] });
  const lemonade = await sale({ date: "2027-01-10", lines: [[LIMONADE, 2]] });
  await reverse(lemonade, "2027-01-11");
  await recordHandover(
    env.DB,
    { kind: "handover", countedAt: "2027-01-12T16:00:00.000Z", receivedCents: 400, leftCents: 5000, note: "Tekort" },
    new Date("2027-01-12T16:01:00.000Z"),
  );
  await sale({ date: "2027-01-13", lines: [[KOFFIE, 1], [STATIEGELD, 1]] });

  expect(await syncKassa(env.DB, new Date("2027-01-14T12:00:00.000Z"))).toEqual({ days: 3, late: 0, handovers: 1, left: 0 });
  const kas = (await balancesOn(env.DB, "2027-01-14")).get("1000");
  expect(kas).toBe((await getCashState(env.DB)).expectedCents);
  expect(kas).toBe(5000 + 155);
  // What was taken out is on its way to the bank.
  expect((await balancesOn(env.DB, "2027-01-14")).get("1080")).toBe(400);
});

it("writes one entry per day when two syncs run at once", async () => {
  for (const date of ["2027-08-01", "2027-08-02", "2027-08-03"]) {
    await sale({ date, lines: [[AARDBEITJE, 1], [LIMONADE, 1]] });
    await sale({ date, method: "pin", lines: [[ENTREE, 2]] });
  }
  const id = await handover({ countedAt: "2027-08-03T16:00:00.000Z", expected: 5525, received: 525, left: 5000 });

  const now = new Date("2027-08-04T02:00:00.000Z");
  const runs = await Promise.all([syncKassa(env.DB, now), syncKassa(env.DB, now)]);
  for (const run of runs) expect(run.left).toBe(0);

  expect(await refs("kassa_day")).toEqual(["2027-08-01", "2027-08-02", "2027-08-03"]);
  expect(await refs("handover")).toEqual([id]);
  // No line twice: three days of four lines and one handover of two.
  expect(await count("ledger_lines")).toBe(3 * 4 + 2);
  const balances = await balancesOn(env.DB, "2027-08-31");
  expect(balances.get("1000")).toBe(3 * 175 - 525);
  expect(balances.get("1030")).toBe(3 * 120);
  const numbers = await env.DB.prepare("SELECT number FROM ledger_entries WHERE year = 2027 ORDER BY number").all<{ number: number }>();
  expect(numbers.results.map((row) => row.number)).toEqual([1, 2, 3, 4]);

  // And once more at the same time, with a late sale for the first day.
  await sale({ date: "2027-08-01", lines: [[KOFFIE, 1]], receivedAt: "2027-08-05T10:00:00.000Z" });
  const later = new Date("2027-08-05T12:00:00.000Z");
  await Promise.all([syncKassa(env.DB, later), syncKassa(env.DB, later)]);
  expect(await count("ledger_entries")).toBe(4);
  expect(await count("ledger_lines")).toBe(3 * 4 + 2);
  expect(amounts(await entry("kassa_day", "2027-08-01"))).toEqual([
    ["1000", 315],
    ["1030", 120],
    ["8011", -315],
    ["8012", -120],
  ]);
});

it("stays within the free plan for a long offline day", async () => {
  // The iPad was offline for weeks: 300 sales over 40 days arrive at once.
  const items = [AARDBEITJE, LIMONADE, KOFFIE, ENTREE, STATIEGELD];
  const sales = Array.from({ length: 300 }, (_, i) =>
    saleOf({
      date: shiftDate("2027-04-01", i % 40),
      method: i % 3 === 0 ? "pin" : "cash",
      lines: [
        [items[i % items.length]!, 1 + (i % 2)],
        [items[(i + 2) % items.length]!, 1],
      ],
      receivedAt: "2027-05-11T09:00:00.000Z",
    }),
  );
  await env.DB.batch(sales.flatMap(saleStatements));

  const metered = meteredDb(env.DB);
  expect(await syncKassa(metered.db, new Date("2027-05-11T12:00:00.000Z"))).toEqual({ days: 40, late: 0, handovers: 0, left: 0 });
  expect(metered.calls()).toBeLessThanOrEqual(20);

  const total = (method: string) =>
    sales.filter((s) => s.method === method).reduce((sum, s) => sum + s.lines.reduce((t, [item, qty]) => t + item.priceCents * qty, 0), 0);
  const balances = await balancesOn(env.DB, "2027-05-31");
  expect(balances.get("1000")).toBe(total("cash"));
  expect(balances.get("1030")).toBe(total("pin"));
  expect((await refs("kassa_day")).length).toBe(40);

  // The next night there is nothing new, and it costs next to nothing.
  const again = meteredDb(env.DB);
  expect(await syncKassa(again.db, new Date("2027-05-12T02:00:00.000Z"))).toEqual(NOTHING);
  expect(again.calls()).toBeLessThanOrEqual(5);
});

it("leaves what does not fit for the next run, oldest first", async () => {
  for (const date of ["2027-07-01", "2027-07-02", "2027-07-03", "2027-07-04", "2027-07-05"]) {
    await sale({ date, lines: [[KOFFIE, 1]], receivedAt: "2027-07-05T18:00:00.000Z" });
  }
  const id = await handover({ countedAt: "2027-07-03T16:00:00.000Z", expected: 5420, received: 420, left: 5000 });
  const now = new Date("2027-07-06T02:00:00.000Z");

  expect(await syncKassa(env.DB, now, 3)).toEqual({ days: 3, late: 0, handovers: 0, left: 3 });
  expect(await refs("kassa_day")).toEqual(["2027-07-01", "2027-07-02", "2027-07-03"]);
  expect(await marker()).toBeNull();

  expect(await syncKassa(env.DB, now, 3)).toEqual({ days: 2, late: 0, handovers: 1, left: 0 });
  expect(await refs("kassa_day")).toEqual(["2027-07-01", "2027-07-02", "2027-07-03", "2027-07-04", "2027-07-05"]);
  expect(await refs("handover")).toEqual([id]);
  expect(await marker()).toBe("2027-07-05T18:00:00.000Z");

  expect(await syncKassa(env.DB, now, 3)).toEqual(NOTHING);
  // The marker is the boekhouding's own: the kassa's settings hold only the ingebruikname.
  expect((await env.DB.prepare("SELECT key FROM settings").all()).results).toEqual([{ key: "in_use_since" }]);

  // A sale stamped before the marker but stored after a run read: its day has no entry yet, so it is still booked.
  await sale({ date: "2027-06-30", lines: [[KOFFIE, 1]], receivedAt: "2027-07-01T09:00:00.000Z" });
  expect(await syncKassa(env.DB, now, 3)).toEqual({ days: 1, late: 0, handovers: 0, left: 0 });
  expect(await refs("kassa_day")).toEqual(["2027-06-30", "2027-07-01", "2027-07-02", "2027-07-03", "2027-07-04", "2027-07-05"]);

  // A change stamped just before a run: the marker stays ten minutes behind the run, so the next one looks again.
  await sale({ date: "2027-07-05", lines: [[KOFFIE, 1]], receivedAt: "2027-07-06T01:59:00.000Z" });
  expect(await syncKassa(env.DB, now, 3)).toEqual({ days: 1, late: 0, handovers: 0, left: 0 });
  expect(await marker()).toBe("2027-07-06T01:50:00.000Z");
});

it("lets the ledger refuse a day that does not add up, and books the others", async () => {
  await sale({ date: "2027-09-01", lines: [[KOFFIE, 1]] });
  // A sale whose total is not the sum of its lines. The kassa refuses those (total_mismatch); this one is made by hand.
  const odd = await sale({ date: "2027-09-02", lines: [[KOFFIE, 1]] });
  await env.DB.prepare("UPDATE sales SET total_cents = 150 WHERE id = ?").bind(odd.id).run();
  await sale({ date: "2027-09-03", lines: [[KOFFIE, 1]] });

  await expect(syncKassa(env.DB, new Date("2027-09-04T02:00:00.000Z"))).rejects.toMatchObject({ code: "unbalanced" });
  expect(await refs("kassa_day")).toEqual(["2027-09-01", "2027-09-03"]);
  expect(await count("ledger_lines")).toBe(4);
  // Not caught up: the next run looks at the day again.
  expect(await marker()).toBeNull();
});

it("never writes in the kassa's tables", async () => {
  await recordHandover(env.DB, { kind: "opening", countedAt: IN_USE, receivedCents: 0, leftCents: 5000, note: null }, new Date(IN_USE));
  const first = await sale({ date: "2027-02-01", lines: [[AARDBEITJE, 2], [STATIEGELD, 1]] });
  await sale({ date: "2027-02-01", method: "pin", lines: [[ENTREE, 2]] });
  await sale({ date: "2027-02-01", method: "pin", status: "pending", lines: [[ENTREE, 1]] });
  await reverse(first, "2027-02-02");
  await recordHandover(
    env.DB,
    { kind: "handover", countedAt: "2027-02-02T16:00:00.000Z", receivedCents: 1000, leftCents: 4000, note: null },
    new Date("2027-02-02T16:01:00.000Z"),
  );
  const tables = ["sales", "sale_lines", "handovers", "categories", "products", "settings"];
  const counts = async () => Promise.all(tables.map(count));
  const kassa = async () => {
    const { categories, products, sales, saleLines, handovers } = await exportAll(env.DB, new Date("2027-02-03T12:00:00.000Z"));
    const settings = (await env.DB.prepare("SELECT * FROM settings ORDER BY key").all()).results;
    return { categories, products, sales, saleLines, handovers, settings };
  };
  const countsBefore = await counts();
  const before = await kassa();

  expect(await syncKassa(env.DB, new Date("2027-02-03T02:00:00.000Z"))).toEqual({ days: 2, late: 0, handovers: 1, left: 0 });
  expect(await count("ledger_entries")).toBe(3);

  expect(await counts()).toEqual(countsBefore);
  expect(await kassa()).toEqual(before);
});
