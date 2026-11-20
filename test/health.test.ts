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
