import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { app } from "../worker/app";
import { isBlocked, registerFailure } from "../worker/lib/rate-limit";
import { TEST_PASSWORD, api, asAdmin, resetData } from "./helpers";

beforeEach(resetData);

it("walks through first-time setup", async () => {
  expect(await (await api("/api/admin/status")).json()).toEqual({ configured: false });
  expect(
    (await api("/api/admin/setup", { method: "POST", json: { setupToken: "wrong", password: TEST_PASSWORD } })).status,
  ).toBe(403);
  const short = await api("/api/admin/setup", { method: "POST", json: { setupToken: "test-setup-token", password: "kort" } });
  expect(short.status).toBe(400);
  expect(await short.json()).toEqual({ error: "password_too_short" });
  const ok = await api("/api/admin/setup", {
    method: "POST",
    json: { setupToken: "test-setup-token", password: TEST_PASSWORD },
  });
  expect(ok.status).toBe(201);
  expect(await (await api("/api/admin/status")).json()).toEqual({ configured: true });
  expect(
    (await api("/api/admin/setup", { method: "POST", json: { setupToken: "test-setup-token", password: TEST_PASSWORD } }))
      .status,
  ).toBe(409);
});

it("refuses setup while no setup code is configured", async () => {
  // An empty code must not match an empty guess.
  for (const setupToken of ["test-setup-token", ""]) {
    const res = await app.request(
      "/api/admin/setup",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupToken, password: TEST_PASSWORD }),
      },
      { ...env, SETUP_TOKEN: "" },
    );
    expect(res.status).toBe(403);
  }
  expect(await (await api("/api/admin/status")).json()).toEqual({ configured: false });
});

it("sets a locked-down session cookie on login", async () => {
  await asAdmin();
  const res = await api("/api/admin/login", { method: "POST", json: { password: TEST_PASSWORD } });
  const cookie = res.headers.get("Set-Cookie")!;
  for (const part of ["kassa_admin=", "HttpOnly", "Secure", "SameSite=Strict", "Path=/api/admin", "Max-Age=2592000"]) {
    expect(cookie).toContain(part);
  }
});

it("rejects a wrong password", async () => {
  await asAdmin();
  const res = await api("/api/admin/login", { method: "POST", json: { password: "helemaal-fout-123" } });
  expect(res.status).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
  expect(res.headers.get("Set-Cookie")).toBeNull();
});

it("guards /me", async () => {
  const { cookie } = await asAdmin();
  expect((await api("/api/admin/me")).status).toBe(401);
  expect((await api("/api/admin/me", { cookie: "kassa_admin=verzonnen" })).status).toBe(401);
  const me = await api("/api/admin/me", { cookie });
  expect(me.status).toBe(200);
  expect(await me.json()).toEqual({ authenticated: true });
});

it("blocks after five wrong passwords, even for the right one", async () => {
  await asAdmin();
  for (let i = 0; i < 5; i++) await api("/api/admin/login", { method: "POST", json: { password: "helemaal-fout-123" } });
  const res = await api("/api/admin/login", { method: "POST", json: { password: TEST_PASSWORD } });
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: "too_many_attempts" });
});

it("lifts the block when the fifteen minutes are over", async () => {
  const start = new Date("2026-11-20T10:00:00.000Z");
  for (let i = 0; i < 5; i++) await registerFailure(env.DB, "login:test", start);
  expect(await isBlocked(env.DB, "login:test", new Date("2026-11-20T10:14:59.000Z"))).toBe(true);
  expect(await isBlocked(env.DB, "login:test", new Date("2026-11-20T10:15:00.000Z"))).toBe(false);
  await registerFailure(env.DB, "login:test", new Date("2026-11-20T10:16:00.000Z"));
  expect(await isBlocked(env.DB, "login:test", new Date("2026-11-20T10:16:01.000Z"))).toBe(false);
});

it("requires the csrf header on writes", async () => {
  const { cookie } = await asAdmin();
  const res = await app.request("/api/admin/logout", { method: "POST", headers: { Cookie: cookie } }, env);
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "csrf" });
  expect((await api("/api/admin/me", { cookie })).status).toBe(200);
});

it("ends the session on logout", async () => {
  const { cookie } = await asAdmin();
  await api("/api/admin/logout", { method: "POST", cookie });
  expect((await api("/api/admin/me", { cookie })).status).toBe(401);
});

it("changes the password only with the current one", async () => {
  const { cookie } = await asAdmin();
  expect(
    (await api("/api/admin/password", { method: "POST", cookie, json: { current: "fout-fout-fout", next: "nieuw-wachtwoord-1" } }))
      .status,
  ).toBe(401);
  expect(
    (await api("/api/admin/password", { method: "POST", cookie, json: { current: TEST_PASSWORD, next: "nieuw-wachtwoord-1" } }))
      .status,
  ).toBe(200);
  expect((await api("/api/admin/login", { method: "POST", json: { password: TEST_PASSWORD } })).status).toBe(401);
  expect((await api("/api/admin/login", { method: "POST", json: { password: "nieuw-wachtwoord-1" } })).status).toBe(200);
});

it("logs out the other sessions on a password change", async () => {
  const { cookie } = await asAdmin();
  const other = await asAdmin();
  await api("/api/admin/password", { method: "POST", cookie, json: { current: TEST_PASSWORD, next: "nieuw-wachtwoord-1" } });
  expect((await api("/api/admin/me", { cookie })).status).toBe(200);
  expect((await api("/api/admin/me", { cookie: other.cookie })).status).toBe(401);
});

it("stores only a hash", async () => {
  await asAdmin();
  const row = await env.DB.prepare("SELECT password_hash, iterations FROM admin").first();
  expect(row!.password_hash).not.toContain(TEST_PASSWORD);
  expect(row!.iterations).toBe(100000);
});
