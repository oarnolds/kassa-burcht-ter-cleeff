import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { MOLLIE_API, mollieFor, pinOutcome } from "../worker/lib/mollie";
import { useFakeMollie } from "./helpers";

const mollie = useFakeMollie();
const client = (key = "test_fake") => mollieFor({ ...env, MOLLIE_API_KEY: key })!;
const saleId = "0b0f6f0e-6f0c-4f6e-9d0a-3d1c0f6e2a11";
const start = (amountCents = 360, origin = "https://kassa.example") => client().createPayment({ saleId, amountCents, terminalId: "term_test", origin });

it("asks the terminal for a payment the way Mollie documents it", async () => {
  const made = await start();
  expect(made).toEqual({
    ok: true,
    data: { id: "tr_fake1", status: "open", reason: null, saleId, testUrl: "https://fake.mollie.test/test/tr_fake1" },
  });
  const sent = mollie.current.requests[0]!;
  expect(sent).toMatchObject({ method: "POST", path: "/v2/payments", idempotencyKey: saleId, authorization: "Bearer test_fake" });
  expect(sent.body).toEqual({
    amount: { currency: "EUR", value: "3.60" },
    description: "Kassa bon 0b0f6f0e",
    method: "pointofsale",
    terminalId: "term_test",
    redirectUrl: "https://kassa.example/",
    webhookUrl: "https://kassa.example/api/mollie/webhook",
    metadata: { saleId },
  });
});

it("leaves the webhook out where Mollie cannot reach it", async () => {
  await start(60, "http://localhost:5173");
  const body = mollie.current.requests[0]!.body;
  expect(body).toMatchObject({ amount: { currency: "EUR", value: "0.60" }, redirectUrl: "http://localhost:5173/" });
  expect("webhookUrl" in body).toBe(false);
});

it("writes every amount as euros with two decimals", async () => {
  for (const cents of [1, 1000, 123456]) await client().createPayment({ saleId: crypto.randomUUID(), amountCents: cents, terminalId: "term_test", origin: "https://kassa.example" });
  expect(mollie.current.requests.map((request) => request.body.amount.value)).toEqual(["0.01", "10.00", "1234.56"]);
});

it("tells a refusal from no answer", async () => {
  const tryWith = async (what: number | "timeout") => {
    mollie.current.failNext(what);
    return client().getPayment("tr_x");
  };
  expect(await tryWith(401)).toEqual({ ok: false, failure: "unauthorized", status: 401 });
  expect(await tryWith(422)).toEqual({ ok: false, failure: "refused", status: 422 });
  expect(await tryWith(404)).toEqual({ ok: false, failure: "not_found", status: 404 });
  for (const what of [409, 429, 500, 503] as const) expect(await tryWith(what)).toEqual({ ok: false, failure: "unreachable", status: what });
  expect(await tryWith("timeout")).toEqual({ ok: false, failure: "unreachable", status: 0 });
});

it("reads a finished payment with Mollie's reason", async () => {
  await start();
  mollie.current.finish("tr_fake1", "failed", "insufficient_funds");
  expect(await client().getPayment("tr_fake1")).toEqual({
    ok: true,
    data: { id: "tr_fake1", status: "failed", reason: "insufficient_funds", saleId, testUrl: null },
  });
  expect(await client().getPayment("tr_bestaatniet")).toMatchObject({ ok: false, failure: "not_found" });
});

it("cancels a payment, and reports a refusal to cancel", async () => {
  await start();
  expect(await client().cancelPayment("tr_fake1")).toMatchObject({ ok: true, data: { id: "tr_fake1", status: "canceled" } });
  expect(mollie.current.requests.at(-1)).toMatchObject({ method: "DELETE", path: "/v2/payments/tr_fake1" });

  await client().createPayment({ saleId: crypto.randomUUID(), amountCents: 110, terminalId: "term_test", origin: "https://kassa.example" });
  mollie.current.cancelable = false;
  expect(await client().cancelPayment("tr_fake2")).toEqual({ ok: false, failure: "refused", status: 422 });
});

it("lists the terminals", async () => {
  mollie.current.terminals.push({ id: "term_kiosk", description: "Kiosk", status: "inactive", brand: "PAX", model: "A920", serialNumber: "123" });
  expect(await client().listTerminals()).toEqual({
    ok: true,
    data: [
      { id: "term_test", description: "Testterminal", status: "active", brand: "Tap", model: "Tap", serialNumber: null },
      { id: "term_kiosk", description: "Kiosk", status: "inactive", brand: "PAX", model: "A920", serialNumber: "123" },
    ],
  });
  expect(mollie.current.requests[0]).toMatchObject({ method: "GET", path: "/v2/terminals" });
});

it("maps Mollie's statuses to outcomes", () => {
  expect(["paid", "failed", "canceled", "expired"].map(pinOutcome)).toEqual(["paid", "declined", "canceled", "expired"]);
  expect(["open", "pending", "authorized", "something_new"].map(pinOutcome)).toEqual([null, null, null, null]);
});

it("has no client without a key, and takes the mode from the key", () => {
  expect(mollieFor({ ...env, MOLLIE_API_KEY: undefined })).toBeNull();
  expect(mollieFor({ ...env, MOLLIE_API_KEY: "" })).toBeNull();
  expect(client("test_x").mode).toBe("test");
  expect(client("live_x").mode).toBe("live");
});

it("only a local address can stand in for Mollie", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input));
    return mollie.current.handle(new Request(input, init));
  });
  await mollieFor({ ...env, MOLLIE_API_KEY: "test_fake", MOLLIE_API_BASE: "https://elsewhere.example/v2" })!.listTerminals();
  await mollieFor({ ...env, MOLLIE_API_KEY: "test_fake", MOLLIE_API_BASE: "http://localhost:4174/v2" })!.listTerminals();
  await mollieFor({ ...env, MOLLIE_API_KEY: "test_fake", MOLLIE_API_BASE: "geen adres" })!.listTerminals();
  expect(MOLLIE_API).toBe("https://api.mollie.com/v2");
  expect(urls).toEqual([
    "https://api.mollie.com/v2/terminals?limit=250",
    "http://localhost:4174/v2/terminals?limit=250",
    "https://api.mollie.com/v2/terminals?limit=250",
  ]);
});

it("gives no test link for a live payment", async () => {
  const made = await client("live_fake").createPayment({ saleId, amountCents: 60, terminalId: "term_test", origin: "https://kassa.example" });
  expect(made).toMatchObject({ ok: true, data: { id: "tr_fake1", testUrl: null } });
  expect(mollie.current.requests[0]!.authorization).toBe("Bearer live_fake");
});
