import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { adminApi, kassaApi } from "./api";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const initOf = (call: Parameters<typeof fetch>) => call[1] ?? {};
const headersOf = (call: Parameters<typeof fetch>) => new Headers(initOf(call).headers);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("adds the csrf header on writes only", async () => {
  await adminApi("/api/admin/me");
  await adminApi("/api/admin/logout", { method: "POST" });
  expect(headersOf(fetchMock.mock.calls[0]!).has("X-Requested-With")).toBe(false);
  expect(headersOf(fetchMock.mock.calls[1]!).get("X-Requested-With")).toBe("kassa");
  expect(initOf(fetchMock.mock.calls[1]!).method).toBe("POST");
  expect(initOf(fetchMock.mock.calls[0]!).credentials).toBe("same-origin");
});

it("sends a body as JSON", async () => {
  await adminApi("/api/admin/login", { method: "POST", json: { password: "geheim" } });
  const call = fetchMock.mock.calls[0]!;
  expect(call[0]).toBe("/api/admin/login");
  expect(headersOf(call).get("Content-Type")).toBe("application/json");
  expect(initOf(call).body).toBe('{"password":"geheim"}');
});

it("sends the device token as a bearer", async () => {
  await kassaApi("/api/kassa/catalog", "tok");
  expect(headersOf(fetchMock.mock.calls[0]!).get("Authorization")).toBe("Bearer tok");
});

it("hands back the data of a good answer", async () => {
  fetchMock.mockResolvedValueOnce(json({ configured: true }));
  expect(await adminApi("/api/admin/status")).toEqual({ ok: true, data: { configured: true } });
});

it("reports a network failure as offline", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Load failed"));
  expect(await kassaApi("/api/kassa/catalog", "tok")).toEqual({ ok: false, status: 0, error: "offline" });
});

it("passes on the server's error code", async () => {
  fetchMock.mockResolvedValueOnce(json({ error: "unauthorized" }, 401));
  expect(await adminApi("/api/admin/me")).toEqual({ ok: false, status: 401, error: "unauthorized" });
  fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
  expect(await adminApi("/api/admin/me")).toEqual({ ok: false, status: 502, error: "server" });
});

it("gives up after the time it was given", async () => {
  // A server that never answers: the request ends only when it is called off.
  fetchMock.mockImplementation(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
      }),
  );
  const started = Date.now();
  expect(await kassaApi("/api/kassa/pin/x", "tok", { timeoutMs: 50 })).toEqual({ ok: false, status: 0, error: "offline" });
  expect(Date.now() - started).toBeLessThan(2000);
});
