import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { app } from "../worker/app";

it("answers the health check", async () => {
  const res = await app.request("/api/health", {}, env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

it("answers unknown api paths with a JSON 404", async () => {
  const res = await app.request("/api/nope", {}, env);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
});

// The kassa token, the pairing code and the beheer password must never be accepted over a connection anyone
// on the same wifi can read. The address also answers over plain http, so the Worker has to refuse it itself.
it("refuses every api call over plain http, also the ones that need no login", async () => {
  for (const path of ["/api/health", "/api/admin/status", "/api/kassa/catalog", "/api/pair", "/api/nope"]) {
    const res = await app.request(`http://kassa.example${path}`, {}, env);
    expect(res.status, path).toBe(400);
    expect(await res.json(), path).toEqual({ error: "https_required" });
  }
});

it("answers over https, and tells the browser to keep using it", async () => {
  const res = await app.request("https://kassa.example/api/health", {}, env);
  expect(res.status).toBe(200);
  expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
  // Also on a refusal: the header belongs to the address, not to the answer.
  const closed = await app.request("https://kassa.example/api/kassa/catalog", {}, env);
  expect(closed.status).toBe(401);
  expect(closed.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
});

it("leaves the computer's own addresses alone, where development and the tests run without https", async () => {
  for (const host of ["localhost", "localhost:5173", "127.0.0.1:4173", "[::1]:5173", "kassa.localhost:5173"]) {
    const res = await app.request(`http://${host}/api/health`, {}, env);
    expect(res.status, host).toBe(200);
    expect(res.headers.get("Strict-Transport-Security"), host).toBeNull();
  }
});
