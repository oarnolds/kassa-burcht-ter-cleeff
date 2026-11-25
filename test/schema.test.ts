import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("seeds six categories in order", async () => {
  const { results } = await env.DB.prepare("SELECT name FROM categories ORDER BY sort").all();
  expect(results.map((r) => r.name)).toEqual(["IJs", "Koude dranken", "Warme dranken", "Snacks", "Entree", "Statiegeld"]);
});

it("seeds 22 active products", async () => {
  const { results } = await env.DB.prepare("SELECT id, name, price_cents FROM products WHERE active = 1 ORDER BY sort").all();
  expect(results).toHaveLength(22);
  expect(results[0]).toMatchObject({ id: "aardbeitje", name: "Aardbeitje", price_cents: 110 });
  expect(results[21]).toMatchObject({ id: "statiegeld", price_cents: 15 });
  expect(results.reduce((sum, r) => sum + (r.price_cents as number), 0)).toBe(3140);
});

it("tracks stock for the ten ice creams only", async () => {
  const { results } = await env.DB.prepare("SELECT category_id FROM products WHERE track_stock = 1").all();
  expect(results).toHaveLength(10);
  expect(new Set(results.map((r) => r.category_id))).toEqual(new Set(["ijs"]));
});

it("gives only statiegeld a quantity pad", async () => {
  const { results } = await env.DB.prepare("SELECT id FROM products WHERE quantity_pad = 1").all();
  expect(results.map((r) => r.id)).toEqual(["statiegeld"]);
});

it("rejects an unknown payment method", async () => {
  await expect(
    env.DB.prepare(
      "INSERT INTO sales (id, method, total_cents, sold_at, received_at, business_date) VALUES ('x','cheque',1,'a','a','2026-01-01')",
    ).run(),
  ).rejects.toThrow(/CHECK constraint failed/);
});

it("allows only one reversal per sale", async () => {
  const insert = (id: string, reverses: string | null) =>
    env.DB.prepare(
      "INSERT INTO sales (id, method, total_cents, sold_at, received_at, business_date, reverses_sale_id) VALUES (?, 'cash', 1, 'a', 'a', '2026-01-01', ?)",
    )
      .bind(id, reverses)
      .run();
  await insert("s1", null);
  await insert("r1", "s1");
  await expect(insert("r2", "s1")).rejects.toThrow(/UNIQUE constraint failed/);
});

it("keeps what Mollie said about a pin sale", async () => {
  const { results } = await env.DB.prepare("SELECT name FROM pragma_table_info('sales')").all<{ name: string }>();
  const columns = results.map((column) => column.name);
  for (const name of ["mollie_payment_id", "mollie_mode", "pin_outcome", "pin_reason", "settled_at", "instead_of_sale_id"]) expect(columns).toContain(name);
});

it("ties a Mollie payment to one sale", async () => {
  const insert = (id: string) =>
    env.DB.prepare(
      `INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date, mollie_payment_id)
       VALUES (?1, 'pin', 'pending', 110, '2026-07-30T10:00:00.000Z', '2026-07-30T10:00:00.000Z', '2026-07-30', 'tr_dubbel')`,
    )
      .bind(id)
      .run();
  await insert("pin-een");
  await expect(insert("pin-twee")).rejects.toThrow(/UNIQUE/);
  await env.DB.prepare("DELETE FROM sales WHERE id = 'pin-een'").run();
});

it("rejects a pin outcome and a Mollie mode it does not know", async () => {
  const insert = (column: string, value: string) =>
    env.DB.prepare(
      `INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date, ${column})
       VALUES ('pin-raar', 'pin', 'pending', 110, '2026-07-30T10:00:00.000Z', '2026-07-30T10:00:00.000Z', '2026-07-30', ?1)`,
    )
      .bind(value)
      .run();
  await expect(insert("pin_outcome", "misschien")).rejects.toThrow(/CHECK/);
  await expect(insert("mollie_mode", "proef")).rejects.toThrow(/CHECK/);
});

it("starts the books with 2026 open, from the seed alone", async () => {
  expect(await env.DB.prepare("SELECT status FROM ledger_years WHERE year = 2026").first()).toEqual({ status: "open" });
});

const insertEntry = (id: string, year: number, number: number, source: string, sourceRef: string | null) =>
  env.DB.prepare(
    `INSERT INTO ledger_entries (id, year, number, date, description, source, source_ref, created_at, updated_at)
     VALUES (?1, ?2, ?3, '2026-03-01', 'Test', ?4, ?5, '2026-03-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z')`,
  )
    .bind(id, year, number, source, sourceRef)
    .run();

it("accepts an entry from e-Boekhouden", async () => {
  await insertEntry("eb-1", 2026, 901, "eboekhouden", "tx-1");
  expect(await env.DB.prepare("SELECT source FROM ledger_entries WHERE id = 'eb-1'").first()).toEqual({ source: "eboekhouden" });
  await expect(insertEntry("eb-2", 2026, 902, "onbekend", null)).rejects.toThrow(/CHECK/);
  await env.DB.prepare("DELETE FROM ledger_entries WHERE id = 'eb-1'").run();
});

it("keeps every entry, line, number and link through the rebuild", async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO ledger_years (year, status) VALUES (2026, 'open')"),
    env.DB.prepare(
      `INSERT INTO ledger_entries (id, year, number, date, description, source, source_ref, created_at, updated_at)
       VALUES ('e-a', 2026, 1, '2026-03-01', 'Een', 'bank', 'ref-a', '2026-03-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z'),
              ('e-b', 2026, 2, '2026-03-02', 'Twee', 'manual', NULL, '2026-03-02T10:00:00.000Z', '2026-03-02T10:00:00.000Z')`,
    ),
    env.DB.prepare("INSERT INTO ledger_lines (entry_id, account_code, amount_cents) VALUES ('e-a', '1010', 500), ('e-a', '8010', -500)"),
    env.DB.prepare("INSERT INTO ledger_history (entry_id, at, before_json, after_json) VALUES ('e-a', '2026-03-03T10:00:00.000Z', NULL, '{}')"),
    env.DB.prepare(
      "INSERT INTO ledger_attachments (id, entry_id, r2_key, filename, content_type, size_bytes, uploaded_at) VALUES ('att-1', 'e-a', 'k', 'bon.pdf', 'application/pdf', 10, '2026-03-03T10:00:00.000Z')",
    ),
    env.DB.prepare("INSERT OR IGNORE INTO money_accounts (account_code, identifier, source) VALUES ('1010', NULL, 'file')"),
    env.DB.prepare(
      `INSERT INTO bank_lines (id, account_code, booking_date, amount_cents, description, content_key, origin, status, entry_id, imported_at)
       VALUES ('bl-1', '1010', '2026-03-01', 500, 'x', 'ck-rebuild', 'file', 'booked', 'e-a', '2026-03-01T10:00:00.000Z')`,
    ),
  ]);
  const snapshot = async () => ({
    entries: (await env.DB.prepare("SELECT * FROM ledger_entries ORDER BY id").all()).results,
    lines: (await env.DB.prepare("SELECT * FROM ledger_lines ORDER BY id").all()).results,
    history: (await env.DB.prepare("SELECT * FROM ledger_history ORDER BY id").all()).results,
    attachments: (await env.DB.prepare("SELECT * FROM ledger_attachments ORDER BY id").all()).results,
    bankLines: (await env.DB.prepare("SELECT * FROM bank_lines ORDER BY id").all()).results,
  });
  const before = await snapshot();
  expect(before.entries).toHaveLength(2);

  // The setup already applied every migration; running 0012 again must rebuild the table without losing a row.
  const migration = env.TEST_MIGRATIONS.find((m) => m.name === "0012_eboekhouden.sql");
  if (!migration) throw new Error("migration 0012_eboekhouden.sql not found");
  await env.DB.batch(migration.queries.map((query) => env.DB.prepare(query)));

  expect(await snapshot()).toEqual(before);
  expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  const indexes = (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'ledger_entries'").all<{ name: string }>()).results.map((i) => i.name);
  expect(indexes).toContain("ledger_entries_by_year_date");
  expect(indexes).toContain("ledger_entries_by_date");
  await expect(insertEntry("e-c", 2026, 3, "bank", "ref-a")).rejects.toThrow(/UNIQUE/);
  await expect(insertEntry("e-d", 2026, 1, "manual", null)).rejects.toThrow(/UNIQUE/);
  await insertEntry("e-e", 2026, 3, "eboekhouden", "tx-9");

  await env.DB.batch([
    env.DB.prepare("DELETE FROM bank_lines WHERE id = 'bl-1'"),
    env.DB.prepare("DELETE FROM ledger_attachments WHERE id = 'att-1'"),
    env.DB.prepare("DELETE FROM ledger_history WHERE entry_id = 'e-a'"),
    env.DB.prepare("DELETE FROM ledger_lines WHERE entry_id = 'e-a'"),
    env.DB.prepare("DELETE FROM ledger_entries WHERE id IN ('e-a','e-b','e-e')"),
  ]);
});
