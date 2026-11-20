import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { Device } from "../shared/types";
import { api, asAdmin, asDevice, resetData } from "./helpers";

beforeEach(resetData);

async function newCode(cookie: string): Promise<{ code: string; expiresAt: string }> {
  const res = await api("/api/admin/pairing-codes", { method: "POST", cookie });
  expect(res.status).toBe(201);
  return res.json();
}

it("pairs with a six-digit code, once", async () => {
  const { cookie } = await asAdmin();
  const { code, expiresAt } = await newCode(cookie);
  expect(code).toMatch(/^\d{6}$/);
  const minutesValid = (Date.parse(expiresAt) - Date.now()) / 60_000;
  expect(minutesValid).toBeGreaterThan(9.9);
  expect(minutesValid).toBeLessThanOrEqual(10);
  const wrong = code === "000000" ? "111111" : "000000";
  const refused = await api("/api/pair", { method: "POST", json: { code: wrong, name: "iPad" } });
  expect(refused.status).toBe(401);
  expect(await refused.json()).toEqual({ error: "invalid_code" });
  const ok = await api("/api/pair", { method: "POST", json: { code, name: "iPad kiosk" } });
  expect(ok.status).toBe(201);
  const { token } = await ok.json<{ token: string }>();
  expect((await api("/api/kassa/ping", { token })).status).toBe(200);
  expect((await api("/api/pair", { method: "POST", json: { code, name: "tweede" } })).status).toBe(401);
});

it("refuses an expired code", async () => {
  const { cookie } = await asAdmin();
  const { code } = await newCode(cookie);
  await env.DB.prepare("UPDATE pairing_codes SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  expect((await api("/api/pair", { method: "POST", json: { code, name: "iPad" } })).status).toBe(401);
});

it("a new code cancels the previous one", async () => {
  const { cookie } = await asAdmin();
  const first = await newCode(cookie);
  let second = await newCode(cookie);
  // One time in a million the new code equals the old one; draw again so the test means what it says.
  while (second.code === first.code) second = await newCode(cookie);
  expect((await api("/api/pair", { method: "POST", json: { code: first.code, name: "iPad" } })).status).toBe(401);
  expect((await api("/api/pair", { method: "POST", json: { code: second.code, name: "iPad" } })).status).toBe(201);
});

it("blocks after five wrong codes", async () => {
  for (let i = 0; i < 5; i++) await api("/api/pair", { method: "POST", json: { code: "000000", name: "x" } });
  const res = await api("/api/pair", { method: "POST", json: { code: "000000", name: "x" } });
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: "too_many_attempts" });
});

it("refuses a pairing request without a name", async () => {
  const { cookie } = await asAdmin();
  const { code } = await newCode(cookie);
  const res = await api("/api/pair", { method: "POST", json: { code, name: "   " } });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "invalid" });
  expect((await api("/api/pair", { method: "POST", json: { code, name: "iPad" } })).status).toBe(201);
});

it("guards device routes and honours revocation", async () => {
  const { cookie } = await asAdmin();
  const { token, deviceId } = await asDevice("iPad kiosk");
  expect((await api("/api/kassa/ping")).status).toBe(401);
  expect((await api("/api/kassa/ping", { token: "verzonnen" })).status).toBe(401);
  const list = await (await api("/api/admin/devices", { cookie })).json<{ devices: Device[] }>();
  expect(list.devices).toEqual([expect.objectContaining({ id: deviceId, name: "iPad kiosk", revoked: false })]);
  expect((await api(`/api/admin/devices/${deviceId}/revoke`, { method: "POST", cookie })).status).toBe(200);
  expect((await api("/api/kassa/ping", { token })).status).toBe(401);
  const after = await (await api("/api/admin/devices", { cookie })).json<{ devices: Device[] }>();
  expect(after.devices[0]!.revoked).toBe(true);
  expect((await api("/api/admin/devices/bestaat-niet/revoke", { method: "POST", cookie })).status).toBe(404);
});

it("keeps pairing and device management behind the beheer login", async () => {
  expect((await api("/api/admin/pairing-codes", { method: "POST" })).status).toBe(401);
  expect((await api("/api/admin/devices")).status).toBe(401);
});

it("notes when the device was last seen", async () => {
  const { cookie } = await asAdmin();
  const { token } = await asDevice();
  await api("/api/kassa/ping", { token });
  const { devices } = await (await api("/api/admin/devices", { cookie })).json<{ devices: Device[] }>();
  expect(Date.now() - Date.parse(devices[0]!.lastSeenAt!)).toBeLessThan(5000);
});

it("stores only the token hash", async () => {
  const { token } = await asDevice();
  const row = await env.DB.prepare("SELECT token_hash FROM devices").first();
  expect(row!.token_hash).not.toBe(token);
  const code = await env.DB.prepare("SELECT code_hash FROM pairing_codes").first();
  expect(code!.code_hash).toMatch(/^[0-9a-f]{64}$/);
});
