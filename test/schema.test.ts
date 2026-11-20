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
