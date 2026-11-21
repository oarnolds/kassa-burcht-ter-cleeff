import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { BackupState } from "../shared/types";
import { businessDate } from "../shared/time";
import { app } from "../worker/app";
import { runBackup } from "../worker/backup";
import { api, asAdmin, resetData } from "./helpers";

beforeEach(async () => {
  await resetData();
  const { objects } = await env.BACKUPS.list();
  await Promise.all(objects.map((o) => env.BACKUPS.delete(o.key)));
});

it("writes a dated copy", async () => {
  const made = await runBackup(env, new Date("2026-08-03T03:00:00.000Z"));
  expect(made).toEqual({ key: "kassa-2026-08-03.json" });
  const file = JSON.parse(await (await env.BACKUPS.get("kassa-2026-08-03.json"))!.text());
  expect(file.products).toHaveLength(22);
});

it("keeps the 26 newest copies", async () => {
  for (let w = 0; w < 28; w++) await runBackup(env, new Date(Date.UTC(2026, 0, 5 + 7 * w, 3)));
  const { objects } = await env.BACKUPS.list();
  expect(objects).toHaveLength(26);
  expect(objects.map((o) => o.key).sort()[0]).toBe("kassa-2026-01-19.json");
});

const state = async (cookie: string) => (await (await api("/api/admin/backups", { cookie })).json()) as BackupState;

it("tells beheer when the last copy was made", async () => {
  const { cookie } = await asAdmin();
  expect(await state(cookie)).toEqual({ available: true, latest: null, count: 0 });
  await runBackup(env, new Date("2026-07-27T03:00:00.000Z"));
  await runBackup(env, new Date("2026-08-03T03:00:00.000Z"));
  const { latest, count } = await state(cookie);
  expect(count).toBe(2);
  expect(latest?.key).toBe("kassa-2026-08-03.json");
  expect(latest?.sizeBytes).toBeGreaterThan(1000);
  // When it was really written, not the date in its name: an old copy must look old.
  expect(Math.abs(Date.parse(latest!.at) - Date.now())).toBeLessThan(60_000);
});

it("makes a copy when beheer asks for one", async () => {
  const { cookie } = await asAdmin();
  const answer = await api("/api/admin/backups", { method: "POST", cookie });
  expect(answer.status).toBe(200);
  const today = `kassa-${businessDate(new Date().toISOString())}.json`;
  expect(((await answer.json()) as BackupState).latest?.key).toBe(today);
  expect((await env.BACKUPS.list()).objects.map((o) => o.key)).toEqual([today]);
});

it("shows and makes copies only for beheer", async () => {
  expect((await api("/api/admin/backups")).status).toBe(401);
  expect((await api("/api/admin/backups", { method: "POST" })).status).toBe(401);
  expect((await env.BACKUPS.list()).objects).toHaveLength(0);
});

// Cloudflare only gives a bucket once R2 is switched on in the account. Until then the kassa must work as before.
const withoutBucket = { ...env, BACKUPS: undefined };

it("says so when the bucket for the copies is not there, and makes no copy", async () => {
  const { cookie } = await asAdmin();
  const asked = await app.request("/api/admin/backups", { headers: { Cookie: cookie } }, withoutBucket);
  expect(await asked.json()).toEqual({ available: false, latest: null, count: 0 });
  const made = await app.request("/api/admin/backups", { method: "POST", headers: { Cookie: cookie, "X-Requested-With": "kassa" } }, withoutBucket);
  expect(made.status).toBe(409);
  expect(await made.json()).toEqual({ error: "not_available" });
  expect(await runBackup(withoutBucket, new Date("2026-08-03T03:00:00.000Z"))).toBeNull();
});
