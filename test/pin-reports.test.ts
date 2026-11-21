import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import type { PinSaleInput } from "../shared/schemas";
import { businessDate } from "../shared/time";
import type { AdminPinAttempt, AdminSale, CashState, DayReport, MonthReport, Summary, WeekReport } from "../shared/types";
import { summary } from "../worker/db/reports";
import type { SaleRow } from "../worker/db/sales";
import { api, asAdmin, asDevice, cashSale, chooseTestTerminal, pinSale, pinStatusOf, postSales, resetData, startPinSale, useFakeMollie } from "./helpers";

const mollie = useFakeMollie();
let cookie: string;
let token: string;

beforeEach(async () => {
  await resetData();
  ({ cookie } = await asAdmin());
  ({ token } = await asDevice());
  await chooseTestTerminal();
  mollie.current.requests.length = 0;
});

const today = businessDate(new Date().toISOString());
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const row = (id: string) => env.DB.prepare("SELECT * FROM sales WHERE id = ?").bind(id).first<SaleRow>();
const get = <T>(path: string) => api(path, { cookie }).then((r) => r.json<T>());
const sales = (date: string) => get<{ sales: AdminSale[]; pinAttempts: AdminPinAttempt[] }>(`/api/admin/sales?date=${date}`);
const summaryOf = () => get<Summary>("/api/admin/summary");
const reverse = (id: string, reason = "terugbetaald via Mollie") => api(`/api/admin/sales/${id}/reverse`, { method: "POST", cookie, json: { reason } });
const lastPayment = () => mollie.current.payments.at(-1)!.id;

/** A pin sale that went through: started, paid at the terminal, and read by the kassa. */
async function paidPin(overrides: Partial<PinSaleInput> = {}): Promise<PinSaleInput> {
  const sale = pinSale(overrides);
  await startPinSale(token, sale);
  mollie.current.finish(lastPayment(), "paid");
  expect((await pinStatusOf(token, sale.id)).outcome).toBe("paid");
  return sale;
}

it("shows pin next to cash in the day, the month, the sales list and the downloads", async () => {
  await paidPin(); // Aardbeitje 110
  await postSales(token, [cashSale({ totalCents: 140, lines: [{ productId: "koffie", name: "Koffie", unitPriceCents: 140, qty: 1 }] })]);
  const day = await get<DayReport>(`/api/admin/reports/day?date=${today}`);
  expect(day.totals).toEqual({ cashCents: 140, pinCents: 110, totalCents: 250, saleCount: 2 });
  expect(day.byCategory).toContainEqual({ categoryId: "ijs", categoryName: "IJs", qty: 1, cashCents: 0, pinCents: 110, totalCents: 110 });
  const month = await get<MonthReport>(`/api/admin/reports/month?month=${today.slice(0, 7)}`);
  expect(month.days).toEqual([{ date: today, cashCents: 140, pinCents: 110, totalCents: 250, saleCount: 2 }]);
  expect((await sales(today)).sales.map((s) => s.method).sort()).toEqual(["cash", "pin"]);
  const csv = await (await api(`/api/admin/reports/month.csv?month=${today.slice(0, 7)}&kind=sales`, { cookie })).text();
  expect(csv).toMatch(/;pin;Aardbeitje;/);
  const days = await (await api(`/api/admin/reports/month.csv?month=${today.slice(0, 7)}&kind=days`, { cookie })).text();
  expect(days).toMatch(/;1,40;1,10;2,50;2;/);
  const figures = await summaryOf();
  expect(figures.today).toMatchObject({ cashCents: 140, pinCents: 110 });
  expect(figures.cashExpectedCents).toBe(140); // pin never passes through the cash box
  expect(figures.pinAttention).toEqual([]);
});

it("shows a paid pin sale under pin in the kassa's own Omzet, of the day and of the week", async () => {
  await paidPin();
  await startPinSale(token, pinSale()); // a second one, still waiting: counts nowhere
  const day = await (await api(`/api/kassa/reports/day?date=${today}`, { token })).json<DayReport>();
  expect(day.totals).toEqual({ cashCents: 0, pinCents: 110, totalCents: 110, saleCount: 1 });
  const week = await (await api(`/api/kassa/reports/week?date=${today}`, { token })).json<WeekReport>();
  expect(week.totals).toEqual({ cashCents: 0, pinCents: 110, totalCents: 110, saleCount: 1 });
  expect(week.days).toEqual([{ date: today, cashCents: 0, pinCents: 110, totalCents: 110, saleCount: 1 }]);
});

it("keeps pin out of the cash box, also across a handover", async () => {
  const state = () => get<CashState>("/api/admin/cash");
  const handover = (json: object) => api("/api/admin/cash/handovers", { method: "POST", cookie, json });
  await handover({ kind: "opening", countedAt: ago(120), receivedCents: 0, leftCents: 5000, note: null });
  const pin = await paidPin({ soldAt: ago(90) });
  expect((await state()).expectedCents).toBe(5000);
  const cash = cashSale({ soldAt: ago(80) });
  await postSales(token, [cash]);
  expect((await state()).expectedCents).toBe(5110);
  const counted = await handover({ kind: "handover", countedAt: ago(10), receivedCents: 110, leftCents: 5000, note: null });
  expect(counted.status).toBe(201);
  const recorded = await counted.json<{ id: string; expectedCents: number; differenceCents: number }>();
  expect(recorded).toMatchObject({ expectedCents: 5110, differenceCents: 0 });
  expect((await row(pin.id))!.handover_id).toBeNull();
  expect((await row(cash.id))!.handover_id).toBe(recorded.id);
  expect((await row(pin.id))!.late).toBe(0);
});

it("reverses a pin sale for the whole amount, as pin, and puts the stock back", async () => {
  const pin = await paidPin();
  const asked = mollie.current.requests.length;
  const answer = await reverse(pin.id);
  expect(answer.status).toBe(201);
  const { id } = await answer.json<{ id: string }>();
  const day = await get<DayReport>(`/api/admin/reports/day?date=${today}`);
  expect(day.totals).toEqual({ cashCents: 0, pinCents: 0, totalCents: 0, saleCount: 1 });
  expect((await env.DB.prepare("SELECT SUM(delta) AS n FROM stock_movements WHERE product_id = 'aardbeitje'").first<{ n: number }>())!.n).toBe(0);
  expect(await row(id)).toMatchObject({ method: "pin", status: "paid", total_cents: -110, reverses_sale_id: pin.id, mollie_payment_id: null, pin_outcome: null });
  expect((await get<CashState>("/api/admin/cash")).expectedCents).toBe(0);
  // The refund itself is done in Mollie's dashboard: the kassa only writes it down.
  expect(mollie.current.requests.length).toBe(asked);
  expect((await reverse(pin.id)).status).toBe(409);
});

it("refuses to reverse a pin payment that is still open or did not go through", async () => {
  const open = pinSale();
  await startPinSale(token, open);
  const stillOpen = await reverse(open.id);
  expect(stillOpen.status).toBe(409);
  expect(await stillOpen.json()).toEqual({ error: "not_paid" });
  mollie.current.finish(lastPayment(), "failed", "card_declined");
  expect((await pinStatusOf(token, open.id)).outcome).toBe("declined");
  const declined = await reverse(open.id);
  expect(declined.status).toBe(409);
  expect(await declined.json()).toEqual({ error: "not_paid" });
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sales").first()).toEqual({ n: 1 });
});

it.each(["pin", "cash"] as const)("marks both sales when cash was taken and the pin payment went through after all, until the %s sale is reversed", async (which) => {
  const pin = pinSale();
  await startPinSale(token, pin); // outcome not known yet
  const cash = cashSale({ insteadOfSaleId: pin.id });
  expect(await postSales(token, [cash])).toEqual([{ id: cash.id, status: "accepted" }]);
  expect((await row(cash.id))!.instead_of_sale_id).toBe(pin.id);
  expect((await sales(today)).sales.map((s) => s.possiblyDouble)).toEqual([false]); // only the cash sale is a sale so far
  expect((await summaryOf()).pinAttention).toEqual([]);
  mollie.current.finish("tr_fake1", "paid");
  const list = (await sales(today)).sales; // opening the day asks Mollie
  expect(list).toHaveLength(2);
  expect(list.every((s) => s.possiblyDouble)).toBe(true);
  expect((await summaryOf()).pinAttention).toEqual([{ kind: "double", date: today, totalCents: 110 }]);
  expect((await reverse(which === "pin" ? pin.id : cash.id)).status).toBe(201);
  const after = (await sales(today)).sales;
  expect(after).toHaveLength(3);
  expect(after.some((s) => s.possiblyDouble)).toBe(false);
  expect((await summaryOf()).pinAttention).toEqual([]);
});

it("does not mark a cash sale whose pin attempt did not go through", async () => {
  const pin = pinSale();
  await startPinSale(token, pin);
  mollie.current.finish("tr_fake1", "failed", "card_declined");
  await pinStatusOf(token, pin.id);
  const cash = cashSale({ insteadOfSaleId: pin.id });
  await postSales(token, [cash]);
  expect((await row(cash.id))!.instead_of_sale_id).toBe(pin.id);
  const answer = await sales(today);
  expect(answer.sales.map((s) => s.possiblyDouble)).toEqual([false]);
  expect((await summaryOf()).pinAttention).toEqual([]);
});

it("books a cash sale whose pin attempt the server does not know, without the link", async () => {
  const other = cashSale();
  const unknown = cashSale({ insteadOfSaleId: crypto.randomUUID() });
  const notPin = cashSale({ insteadOfSaleId: other.id });
  const { insteadOfSaleId: _absent, ...oldApp } = cashSale({ insteadOfSaleId: null }); // an iPad with the old app sends no such field
  const explicitNull = cashSale({ insteadOfSaleId: null });
  expect(await postSales(token, [other, unknown, notPin, oldApp, explicitNull])).toEqual(
    [other, unknown, notPin, oldApp, explicitNull].map((sale) => ({ id: sale.id, status: "accepted" })),
  );
  for (const sale of [other, unknown, notPin, oldApp, explicitNull]) expect((await row(sale.id))!.instead_of_sale_id).toBeNull();
  expect((await sales(today)).sales.some((s) => s.possiblyDouble)).toBe(false);
  // The link is checked, not trusted: something that is not an id is refused like any malformed item.
  const malformed = { ...cashSale(), insteadOfSaleId: "geen-uuid" };
  expect(await postSales(token, [malformed as never])).toEqual([{ id: malformed.id, status: "rejected", reason: "invalid" }]);
});

it("lists what did not go through or is still open apart from the sales", async () => {
  await paidPin({ soldAt: ago(3) });
  const open = pinSale({ soldAt: ago(2) });
  await startPinSale(token, open); // tr_fake2 stays open
  const busy = pinSale({ soldAt: ago(1) });
  expect((await startPinSale(token, busy)).reason).toBe("terminal_busy"); // the terminal is still busy with the second
  const answer = await sales(today);
  expect(answer.sales).toHaveLength(1);
  expect(answer.pinAttempts).toEqual([
    { id: open.id, soldAtLocal: expect.stringMatching(/^\d\d:\d\d$/), totalCents: 110, outcome: null, reason: null, lines: [{ name: "Aardbeitje", categoryName: "IJs", unitPriceCents: 110, qty: 1 }] },
    { id: busy.id, soldAtLocal: expect.stringMatching(/^\d\d:\d\d$/), totalCents: 110, outcome: "declined", reason: "terminal_busy", lines: [{ name: "Aardbeitje", categoryName: "IJs", unitPriceCents: 110, qty: 1 }] },
  ]);
  // Another day shows neither.
  expect(await sales("2026-01-02")).toEqual({ sales: [], pinAttempts: [] });
});

it("asks Mollie about at most five open payments when a day is opened", async () => {
  const insert = env.DB.prepare(
    `INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date, mollie_payment_id, mollie_mode)
     VALUES (?1, 'pin', 'pending', 110, ?2, ?2, '2026-07-30', ?3, 'test')`,
  );
  await env.DB.batch(["a", "b", "c", "d", "e", "f", "g"].map((letter, index) => insert.bind(`pin-${letter}`, `2026-07-30T10:0${index}:00.000Z`, `tr_${letter}`)));
  const answer = await sales("2026-07-30");
  expect(answer.pinAttempts).toHaveLength(7);
  const asked = mollie.current.requests.filter((request) => request.method === "GET" && request.path.startsWith("/v2/payments/"));
  // The five that have waited longest, in any order: they are asked at the same time.
  expect(asked.map((request) => request.path).sort()).toEqual(["a", "b", "c", "d", "e"].map((letter) => `/v2/payments/tr_${letter}`));
  // Another day asks nothing.
  mollie.current.requests.length = 0;
  await sales(today);
  expect(mollie.current.requests).toHaveLength(0);
});

it("opening a day never sends a payment request itself, and gives up on one that never got an answer", async () => {
  const creates = () => mollie.current.requests.filter((request) => request.method === "POST" && request.path === "/v2/payments");
  const unanswered = pinSale();
  mollie.current.failNext("timeout");
  await startPinSale(token, unanswered);
  expect(creates()).toHaveLength(1);
  // Beheer may be open on another address than the iPad: a request sent from here would not be the same request.
  expect((await sales(today)).pinAttempts).toMatchObject([{ id: unanswered.id, outcome: null }]);
  expect(creates()).toHaveLength(1);
  await env.DB.prepare("UPDATE sales SET received_at = ?1 WHERE id = ?2").bind(ago(16), unanswered.id).run();
  expect((await sales(today)).pinAttempts).toMatchObject([{ id: unanswered.id, outcome: "start_failed", reason: "no_answer" }]);
  expect(creates()).toHaveLength(1);
});

it("points the penningmeester at a payment that has waited more than five minutes", async () => {
  const now = new Date();
  await startPinSale(token, pinSale({ soldAt: new Date(now.getTime() - 60_000).toISOString() }));
  expect((await summary(env.DB, now)).pinAttention).toEqual([]);
  expect((await summary(env.DB, new Date(now.getTime() + 5 * 60_000))).pinAttention).toEqual([{ kind: "pending", date: today, totalCents: 110 }]);
  // Once it is settled, there is nothing left to look at.
  mollie.current.finish("tr_fake1", "canceled");
  await pinStatusOf(token, (await env.DB.prepare("SELECT id FROM sales").first<{ id: string }>())!.id);
  expect((await summary(env.DB, new Date(now.getTime() + 5 * 60_000))).pinAttention).toEqual([]);
});

it("lists at most five waiting payments and five possible doubles, oldest first", async () => {
  const insert = env.DB.prepare(
    `INSERT INTO sales (id, method, status, total_cents, sold_at, received_at, business_date, mollie_payment_id, mollie_mode, instead_of_sale_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, '2026-07-30', ?6, ?7, ?8)`,
  );
  const at = (minute: number) => `2026-07-30T10:${String(minute).padStart(2, "0")}:00.000Z`;
  const numbers = [1, 2, 3, 4, 5, 6];
  await env.DB.batch([
    ...numbers.map((n) => insert.bind(`wacht-${n}`, "pin", "pending", 100 + n, at(n), `tr_w${n}`, "test", null)),
    ...numbers.map((n) => insert.bind(`pin-${n}`, "pin", "paid", 200 + n, at(10 + n), `tr_p${n}`, "test", null)),
  ]);
  await env.DB.batch(numbers.map((n) => insert.bind(`contant-${n}`, "cash", "paid", 200 + n, at(20 + n), null, null, `pin-${n}`)));
  expect((await summary(env.DB, new Date("2026-07-30T12:00:00.000Z"))).pinAttention).toEqual([
    ...[1, 2, 3, 4, 5].map((n) => ({ kind: "pending", date: "2026-07-30", totalCents: 100 + n })),
    ...[1, 2, 3, 4, 5].map((n) => ({ kind: "double", date: "2026-07-30", totalCents: 200 + n })),
  ]);
});

it("wipes pin sales and their links with the trial data", async () => {
  const pin = pinSale();
  await startPinSale(token, pin);
  await postSales(token, [cashSale({ insteadOfSaleId: pin.id })]);
  mollie.current.finish("tr_fake1", "paid");
  await pinStatusOf(token, pin.id);
  const wiped = await api("/api/admin/wipe-trial", { method: "POST", cookie, json: { confirm: "WISSEN" } });
  expect(wiped.status).toBe(200);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sales").first()).toEqual({ n: 0 });
  // The iPad still asks about the payment it had: the answer is that there is none.
  expect((await api(`/api/kassa/pin/${pin.id}`, { token })).status).toBe(404);
});
