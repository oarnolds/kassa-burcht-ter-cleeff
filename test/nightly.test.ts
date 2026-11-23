import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import type { NightlyReport } from "../shared/ledger-types";
import worker from "../worker/index";
import { LedgerError } from "../worker/db/ledger";
import { exportAll } from "../worker/db/maintenance";
import { runNightly } from "../worker/nightly";
import { api, asAdmin, resetData } from "./helpers";

beforeEach(async () => {
  await resetData();
  const { objects } = await env.BACKUPS.list();
  await Promise.all(objects.map((o) => env.BACKUPS.delete(o.key)));
  await env.DB.prepare("DELETE FROM settings WHERE key = 'in_use_since'").run();
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('in_use_since', '2026-11-21T09:00:00.000Z')").run();
});

const stored = async () =>
  (await env.DB.prepare("SELECT value FROM ledger_settings WHERE key = 'ledger_nightly_last'").first<{ value: string }>())?.value ?? null;

async function kassaSale(date: string) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date, reverses_sale_id, settled_at)
       VALUES (?1, 'cash', 'paid', 110, ?2, ?2, ?3, NULL, NULL)`,
    ).bind(id, `${date}T10:00:00.000Z`, date),
    env.DB.prepare(
      "INSERT INTO sale_lines (sale_id, product_id, name, category_id, category_name, unit_price_cents, qty) VALUES (?1, 'aardbeitje', 'Aardbeitje', 'ijs', 'IJs', 110, 1)",
    ).bind(id),
  ]);
}

it("runs the kassa step at night and remembers how it went", async () => {
  await kassaSale("2027-03-06");
  const now = new Date("2027-03-07T02:00:00.000Z");
  const report = await runNightly(env, now);
  expect(report).toEqual({ at: now.toISOString(), steps: { kassa: "ok", ing: "skipped", mollie: "skipped" } });
  expect(JSON.parse((await stored())!)).toEqual(report);
  expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE source = 'kassa_day'").first<{ n: number }>())!.n).toBe(1);
});

it("goes on with the other steps when one fails", async () => {
  const report = await runNightly(env, new Date("2027-03-07T02:00:00.000Z"), {
    kassa: async () => {
      throw new LedgerError("unbalanced", 400);
    },
    ing: async () => "ok",
    mollie: async () => {
      throw new Error("secret-token-in-message");
    },
  });
  expect(report.steps).toEqual({ kassa: "unbalanced", ing: "ok", mollie: "error" });
  expect(JSON.parse((await stored())!).steps).toEqual({ kassa: "unbalanced", ing: "ok", mollie: "error" });
});

function fire(cron: string): Promise<unknown> {
  const waiting: Promise<unknown>[] = [];
  worker.scheduled!({ cron, scheduledTime: Date.now(), noRetry() {} } as ScheduledController, env, { waitUntil: (p: Promise<unknown>) => void waiting.push(p), passThroughOnException() {} } as unknown as ExecutionContext);
  return Promise.all(waiting);
}

it("still makes the weekly copy on Monday", async () => {
  await fire("0 3 * * MON");
  expect((await env.BACKUPS.list()).objects).toHaveLength(1);
  expect(await stored()).toBeNull();
});

it("runs the nightly job on its own schedule and does nothing on an unknown one", async () => {
  await fire("0 2 * * *");
  expect(await stored()).not.toBeNull();
  expect((await env.BACKUPS.list()).objects).toHaveLength(0);
  await env.DB.prepare("DELETE FROM ledger_settings WHERE key = 'ledger_nightly_last'").run();
  await fire("5 5 * * *");
  expect(await stored()).toBeNull();
  expect((await env.BACKUPS.list()).objects).toHaveLength(0);
});

it("takes the boekhouding along in the weekly copy", async () => {
  await kassaSale("2027-03-06");
  await runNightly(env, new Date("2027-03-07T02:00:00.000Z"));
  const file = await exportAll(env.DB, new Date("2027-03-08T03:00:00.000Z"));
  expect(file.ledger.ledger_entries).toHaveLength(1);
  expect(file.ledger.ledger_lines).toHaveLength(2);
  expect(file.ledger.ledger_accounts.length).toBeGreaterThan(10);
  for (const table of ["ledger_years", "ledger_history", "ledger_year_events", "ledger_attachments", "ledger_settings", "money_accounts", "bank_lines", "bank_balances", "category_accounts", "comparison_figures"]) {
    expect(Array.isArray(file.ledger[table]), table).toBe(true);
  }
});

it("lets the penningmeester bring it up to date by hand", async () => {
  expect((await api("/api/admin/boekhouding/sync", { method: "POST" })).status).toBe(401);
  const { cookie } = await asAdmin();
  await kassaSale("2027-03-06");
  const answer = await api("/api/admin/boekhouding/sync", { method: "POST", cookie });
  expect(answer.status).toBe(200);
  const report = (await answer.json()) as NightlyReport;
  expect(report.steps).toEqual({ kassa: "ok", ing: "skipped", mollie: "skipped" });
  const overview = await (await api("/api/admin/boekhouding/overview", { cookie })).json();
  expect((overview as { lastNightly: NightlyReport }).lastNightly).toEqual(report);
});

it("logs only the step and the kind of error, never its message", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    class KeyError extends Error {
      override name = "KeyError";
    }
    await runNightly(env, new Date("2027-03-07T02:00:00.000Z"), {
      kassa: async () => {
        throw new LedgerError("unbalanced", 400);
      },
      ing: async () => {
        throw new KeyError("-----BEGIN PRIVATE KEY----- org_fake secret");
      },
      mollie: async () => {
        throw "org_fake as a string";
      },
    });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toMatch(/PRIVATE KEY|org_fake|secret/);
    expect(log.mock.calls).toEqual([
      ["nightly step failed:", "kassa", "unbalanced"],
      ["nightly step failed:", "ing", "KeyError"],
      ["nightly step failed:", "mollie", "unknown"],
    ]);
  } finally {
    log.mockRestore();
  }
});
