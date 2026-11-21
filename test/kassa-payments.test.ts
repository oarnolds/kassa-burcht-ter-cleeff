import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { businessDate } from "../shared/time";
import type { KassaPayments } from "../shared/types";
import { api, asAdmin, asDevice, cashSale, chooseTestTerminal, meteredDb, pinSale, pinStatusOf, postSales, resetData, startPinSale, useFakeMollie } from "./helpers";
import { kassaPayments } from "../worker/db/reports";

// The kassa's list "Betalingen": every payment of the day, to look at only.

const mollie = useFakeMollie();
let cookie: string;
let token: string;

beforeEach(async () => {
  await resetData();
  ({ cookie } = await asAdmin());
  ({ token } = await asDevice());
  await chooseTestTerminal();
});

const today = businessDate(new Date().toISOString());
const lastPayment = () => mollie.current.payments.at(-1)!.id;
const payments = (date = today) => api(`/api/kassa/payments?date=${date}`, { token });

/** A pin payment started on the kassa and ended at the terminal as `status`, or left waiting. */
async function pin(status: "paid" | "failed" | null, totalCents: number) {
  const sale = pinSale({ totalCents, lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: totalCents, qty: 1 }] });
  await startPinSale(token, sale);
  if (status) {
    mollie.current.finish(lastPayment(), status);
    await pinStatusOf(token, sale.id);
  }
  return sale;
}

it("gives the kassa the day's payments as beheer sees them: the sales, and the pin payments that did not go through or still wait", async () => {
  await postSales(token, [cashSale()]);
  await pin("paid", 110);
  await pin("failed", 220);
  await pin(null, 330);
  const asked = mollie.current.requests.length;
  const forKassa = await (await payments()).json<KassaPayments>();
  // The kassa's list asks Mollie nothing: the iPad follows its own waiting payments.
  expect(mollie.current.requests.length).toBe(asked);
  expect(forKassa.sales.map((sale) => [sale.method, sale.totalCents])).toEqual([
    ["cash", 110],
    ["pin", 110],
  ]);
  expect(forKassa.pinAttempts.map((attempt) => [attempt.outcome, attempt.totalCents])).toEqual([
    ["declined", 220],
    [null, 330],
  ]);
  // The moment of each, so that the kassa can put sales and attempts in one order.
  for (const attempt of forKassa.pinAttempts) expect(Date.parse(attempt.soldAt)).toBeGreaterThan(Date.now() - 60_000);
  expect(forKassa).toEqual(await (await api(`/api/admin/sales?date=${today}`, { cookie })).json<KassaPayments>());
});

it("shows the payments only to a paired kassa, and only for a real date", async () => {
  expect((await api(`/api/kassa/payments?date=${today}`)).status).toBe(401);
  expect((await payments("2026-02-30")).status).toBe(400);
  expect((await api("/api/kassa/payments", { token })).status).toBe(400);
});

it("reads the day in two database round trips", async () => {
  await postSales(token, [cashSale(), cashSale()]);
  const metered = meteredDb(env.DB);
  await kassaPayments(metered.db, today);
  expect(metered.calls()).toBeLessThanOrEqual(2);
});
