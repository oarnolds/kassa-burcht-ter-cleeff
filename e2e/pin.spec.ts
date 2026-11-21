import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { AdminPinAttempt, AdminSale, Summary } from "../shared/types";
import { MOLLIE, atTerminal, expectToday, molliePayments, pair, prepare, today, usePin, type Beheer } from "./setup";

// Pin, end to end: the kassa in Safari's engine, the real server, and a Mollie that is played on this computer.

const tile = (page: Page, name: RegExp) => page.getByRole("button", { name });
const receipt = (page: Page) => page.getByRole("complementary", { name: "Bon" });
const tap = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();
const pinButton = (page: Page) => page.getByRole("button", { name: "Pin", exact: true });
const pinDialog = (page: Page, name: string) => page.getByRole("dialog", { name });

const HOLD = "Houd pas of telefoon tegen de betaalterminal";
const NOTHING = { pinCents: 0, cashCents: 0, saleCount: 0 };
const WAITING = "1 pinbetaling wacht op bevestiging";

/** A paired kassa with the test terminal chosen, and beheer to look at what was booked. */
async function open(page: Page, request: APIRequestContext): Promise<Beheer> {
  const { code, beheer } = await prepare(request);
  await usePin(request, beheer);
  await pair(page, code);
  return beheer;
}

/** A coffee of € 1,40 on the receipt, Pin tapped, and the terminal asked. */
async function pinACoffee(page: Page): Promise<void> {
  await tile(page, /Koffie/).click();
  await tap(page, "Pin");
  await expect(pinDialog(page, "Pin, te betalen").getByText(HOLD)).toBeVisible();
}

/** The connection drops while the customer pays: the kassa parks the receipt and says so. */
async function loseTheConnection(page: Page): Promise<void> {
  await page.context().setOffline(true);
  await expect(pinDialog(page, "Uitkomst onbekend")).toBeVisible({ timeout: 20_000 });
}

const dayOf = (beheer: Beheer) => beheer.get<{ sales: AdminSale[]; pinAttempts: AdminPinAttempt[] }>(`/api/admin/sales?date=${today()}`);
const paymentStatuses = async (request: APIRequestContext) => (await molliePayments(request)).map((payment) => payment.status);

test("test mode: the TEST bar shows, and a payment approved on Mollie's test page is paid on the iPad and in beheer", async ({ page, request }) => {
  const beheer = await open(page, request);
  await expect(page.getByText("TEST", { exact: true })).toBeVisible();
  await expect(page.getByText("Pinbetalingen zijn nagespeeld: er wordt geen geld afgeschreven.")).toBeVisible();
  await tile(page, /Aardbeitje/).click();
  await tile(page, /Koffie/).click();
  await tap(page, "Pin");
  const dialog = pinDialog(page, "Pin, te betalen");
  await expect(dialog.getByText(HOLD)).toBeVisible();
  await expect(dialog.getByText(/^€\s2,50$/)).toBeVisible();
  // The receipt stays until Mollie approves, and nothing is booked yet.
  await expect(receipt(page).getByText("Koffie")).toBeVisible();
  await expectToday(beheer, NOTHING, 2000);
  const [testPage] = await Promise.all([page.waitForEvent("popup"), dialog.getByRole("link", { name: "Test: kies de uitkomst bij Mollie" }).click()]);
  await Promise.all([expect(page.getByText("Pin betaald")).toBeVisible(), testPage.getByRole("button", { name: "Betaald" }).click()]);
  await expect(dialog).toBeHidden();
  await expect(receipt(page).getByText("Tik op een product om te beginnen.")).toBeVisible();
  await expectToday(beheer, { pinCents: 250, cashCents: 0, saleCount: 1 });
  // Pin never counts toward the cash box.
  expect((await beheer.get<{ expectedCents: number }>("/api/admin/cash")).expectedCents).toBe(0);
  const day = await dayOf(beheer);
  expect(day.sales.map((sale) => [sale.method, sale.totalCents])).toEqual([["pin", 250]]);
  expect(day.pinAttempts).toEqual([]);
  // The beheerder's own revenue screen shows it as pin.
  await tap(page, "Omzet");
  await expect(page.getByRole("dialog", { name: "Omzet" }).getByText(/pin €\s2,50/)).toBeVisible();
});

test("a declined payment: three choices, nothing in the overview, and trying again pays", async ({ page, request }) => {
  const beheer = await open(page, request);
  await pinACoffee(page);
  await atTerminal(request, "failed", "insufficient_funds");
  const declined = pinDialog(page, "Betaling geweigerd");
  await expect(declined.getByText("Onvoldoende saldo.")).toBeVisible();
  for (const name of ["Opnieuw proberen", "Toch contant", "Terug naar de bon"]) await expect(declined.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(receipt(page).getByText("Koffie")).toBeVisible();
  await expectToday(beheer, NOTHING, 2000);
  await tap(page, "Opnieuw proberen");
  await expect(pinDialog(page, "Pin, te betalen").getByText(HOLD)).toBeVisible();
  await Promise.all([expect(page.getByText("Pin betaald")).toBeVisible(), atTerminal(request, "paid")]);
  await expect(receipt(page).getByText("Tik op een product om te beginnen.")).toBeVisible();
  await expectToday(beheer, { pinCents: 140, cashCents: 0, saleCount: 1 });
  // A new attempt is a new sale; the one that failed stays on record, apart from the sales.
  const day = await dayOf(beheer);
  expect(day.sales.map((sale) => [sale.method, sale.totalCents])).toEqual([["pin", 140]]);
  expect(day.pinAttempts.map((attempt) => [attempt.outcome, attempt.reason, attempt.totalCents])).toEqual([["declined", "insufficient_funds", 140]]);
});

test("a payment cancelled on the iPad: back to the receipt, nothing in the overview", async ({ page, request }) => {
  const beheer = await open(page, request);
  await pinACoffee(page);
  await tap(page, "Annuleren");
  const canceled = pinDialog(page, "Betaling geannuleerd");
  await expect(canceled).toBeVisible();
  await tap(page, "Terug naar de bon");
  await expect(canceled).toBeHidden();
  await expect(receipt(page).getByText("Koffie")).toBeVisible();
  await expect(pinButton(page)).toBeEnabled();
  expect(await paymentStatuses(request)).toEqual(["canceled"]);
  await expectToday(beheer, NOTHING, 2000);
  expect((await dayOf(beheer)).pinAttempts.map((attempt) => attempt.outcome)).toEqual(["canceled"]);
});

test("a payment cancelled on the terminal, and one that expired", async ({ page, request }) => {
  const beheer = await open(page, request);
  await pinACoffee(page);
  await atTerminal(request, "canceled");
  await expect(pinDialog(page, "Betaling geannuleerd")).toBeVisible();
  await tap(page, "Opnieuw proberen");
  await expect(pinDialog(page, "Pin, te betalen").getByText(HOLD)).toBeVisible();
  await atTerminal(request, "expired");
  await expect(pinDialog(page, "Betaling verlopen")).toBeVisible();
  await expectToday(beheer, NOTHING, 2000);
  expect((await dayOf(beheer)).pinAttempts.map((attempt) => attempt.outcome).sort()).toEqual(["canceled", "expired"]);
});

test("cancelling that Mollie refuses keeps waiting, and the payment that follows is booked", async ({ page, request }) => {
  const beheer = await open(page, request);
  // The customer is already paying: the terminal no longer lets go.
  expect((await request.post(`${MOLLIE}/control/cancelable`, { data: { value: false } })).ok()).toBe(true);
  await pinACoffee(page);
  await tap(page, "Annuleren");
  const dialog = pinDialog(page, "Pin, te betalen");
  await expect(dialog.getByText("Annuleren lukte niet. Kijk op de betaalterminal.")).toBeVisible();
  await expect(receipt(page).getByText("Koffie")).toBeVisible();
  await Promise.all([expect(page.getByText("Pin betaald")).toBeVisible(), atTerminal(request, "paid")]);
  await expectToday(beheer, { pinCents: 140, cashCents: 0, saleCount: 1 });
});

test("cash after a declined payment books cash only", async ({ page, request }) => {
  const beheer = await open(page, request);
  await pinACoffee(page);
  await atTerminal(request, "failed", "invalid_pin");
  await expect(pinDialog(page, "Betaling geweigerd").getByText("Onjuiste pincode.")).toBeVisible();
  await tap(page, "Toch contant");
  await expect(page.getByRole("dialog", { name: "Contant, te betalen" })).toBeVisible();
  await tap(page, "Gepast");
  await expect(receipt(page).getByText("Tik op een product om te beginnen.")).toBeVisible();
  await expectToday(beheer, { cashCents: 140, pinCents: 0, saleCount: 1 });
  const day = await dayOf(beheer);
  expect(day.sales.map((sale) => [sale.method, sale.possiblyDouble])).toEqual([["cash", false]]);
});

test("a double tap on Toch contant does not press anything in the cash dialog (Review Focus 4)", async ({ page, request }) => {
  const beheer = await open(page, request);
  await pinACoffee(page);
  await atTerminal(request, "failed");
  await pinDialog(page, "Betaling geweigerd").getByRole("button", { name: "Toch contant", exact: true }).dblclick();
  const cash = page.getByRole("dialog", { name: "Contant, te betalen" });
  await expect(cash.getByText("Wat geeft de klant?")).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(cash.getByText("Wat geeft de klant?")).toBeVisible();
  await expect(receipt(page).getByText("Koffie")).toBeVisible();
  await expectToday(beheer, NOTHING, 2000);
  // And the kassa goes on: the shield steps aside.
  await tap(page, "Gepast");
  await expectToday(beheer, { cashCents: 140, pinCents: 0, saleCount: 1 });
});

test("a double tap on Pin and on Opnieuw proberen starts one payment each (Review Focus 4)", async ({ page, request }) => {
  await open(page, request);
  await tile(page, /Koffie/).click();
  await pinButton(page).dblclick();
  await expect(pinDialog(page, "Pin, te betalen").getByText(HOLD)).toBeVisible();
  expect(await paymentStatuses(request)).toEqual(["open"]);
  await atTerminal(request, "failed");
  await pinDialog(page, "Betaling geweigerd").getByRole("button", { name: "Opnieuw proberen", exact: true }).dblclick();
  await expect(pinDialog(page, "Pin, te betalen").getByText(HOLD)).toBeVisible();
  // One new payment, and the second tap did not cancel it.
  await page.waitForTimeout(2500);
  expect(await paymentStatuses(request)).toEqual(["failed", "open"]);
  await expect(pinDialog(page, "Pin, te betalen").getByText(HOLD)).toBeVisible();
});

test("the connection drops while paying: the receipt is parked, the kassa goes on, and the outcome arrives when the connection is back", async ({ page, context, request }) => {
  const beheer = await open(page, request);
  await pinACoffee(page);
  await loseTheConnection(page);
  await tap(page, "Volgende klant");
  await expect(page.getByRole("button", { name: WAITING })).toBeVisible();
  await expect(receipt(page).getByText("Tik op een product om te beginnen.")).toBeVisible();
  // The next customer: pin is off and says why, cash goes on.
  await tile(page, /Thee/).click();
  await expect(pinButton(page)).toBeDisabled();
  await expect(page.getByText("Geen internet: pin kan nu niet. Contant werkt door.")).toBeVisible();
  await tap(page, "Contant");
  await tap(page, "Gepast");
  await expect(page.getByText("1 verkoop wacht op verzending")).toBeVisible();
  await atTerminal(request, "paid"); // meanwhile the customer did pay
  await context.setOffline(false);
  await expect(page.getByText(/Pinbetaling van €\s1,40 is gelukt/)).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText(/wacht op bevestiging/)).toBeHidden({ timeout: 40_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectToday(beheer, { pinCents: 140, cashCents: 140, saleCount: 2 }, 40_000);
  const day = await dayOf(beheer);
  expect(day.sales.map((sale) => sale.possiblyDouble)).toEqual([false, false]); // two customers, two sales
});

test("a parked payment that failed is reported with its amount", async ({ page, context, request }) => {
  const beheer = await open(page, request);
  await pinACoffee(page);
  await loseTheConnection(page);
  await tap(page, "Volgende klant");
  await atTerminal(request, "failed", "insufficient_funds");
  await context.setOffline(false);
  const failed = page.getByRole("button", { name: /^Pinbetaling van €\s1,40 niet gelukt$/ });
  await expect(failed).toBeVisible({ timeout: 40_000 });
  // Nothing opened by itself, and the kassa is not held up.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/wacht op bevestiging/)).toBeHidden();
  await tile(page, /Thee/).click();
  await expect(receipt(page).getByText("Thee")).toBeVisible();
  await failed.click();
  const list = page.getByRole("dialog", { name: "Pinbetalingen" });
  await expect(list.getByText(/^Niet gelukt · Pin van \d\d:\d\d · €\s1,40$/)).toBeVisible();
  await expect(list.getByText("1× Koffie")).toBeVisible();
  await list.getByRole("button", { name: "Gezien", exact: true }).click();
  await expect(list).toBeHidden();
  await expect(failed).toBeHidden();
  await expect(receipt(page).getByText("Thee")).toBeVisible();
  await expectToday(beheer, NOTHING, 2000);
  expect((await dayOf(beheer)).pinAttempts.map((attempt) => attempt.outcome)).toEqual(["declined"]);
});

test("cash for a parked receipt and a pin payment that went through after all: both are marked in beheer", async ({ page, context, request }) => {
  const beheer = await open(page, request);
  await pinACoffee(page);
  await loseTheConnection(page);
  await tap(page, "Volgende klant");
  await tap(page, WAITING);
  const list = page.getByRole("dialog", { name: "Pinbetalingen" });
  await expect(list.getByText(/^Wacht op bevestiging · Pin van \d\d:\d\d · €\s1,40$/)).toBeVisible();
  await list.getByRole("button", { name: "Toch contant", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Contant, te betalen" })).toBeVisible();
  await tap(page, "Gepast");
  await expect(page.getByText("1 verkoop wacht op verzending")).toBeVisible();
  await atTerminal(request, "paid");
  await context.setOffline(false);
  await expect(page.getByText(/wacht op bevestiging/)).toBeHidden({ timeout: 40_000 });
  await expectToday(beheer, { pinCents: 140, cashCents: 140, saleCount: 2 }, 40_000);
  const day = await dayOf(beheer);
  expect(day.sales.map((sale) => sale.possiblyDouble)).toEqual([true, true]);
  expect((await beheer.get<Summary>("/api/admin/summary")).pinAttention).toMatchObject([{ kind: "double", date: today(), totalCents: 140 }]);
});

test("a kassa that is reloaded while paying finds its receipt parked (Review Focus 3)", async ({ page, request }) => {
  const beheer = await open(page, request);
  await pinACoffee(page);
  await page.reload();
  await expect(page.getByRole("button", { name: WAITING })).toBeVisible();
  await expectToday(beheer, NOTHING, 2000);
  await atTerminal(request, "paid");
  await expect(page.getByText(/wacht op bevestiging/)).toBeHidden({ timeout: 40_000 });
  await expectToday(beheer, { pinCents: 140, cashCents: 0, saleCount: 1 });
});

test("the penningmeester chooses the terminal in beheer, and only then Pin works", async ({ page, context, request }) => {
  const { code, beheer } = await prepare(request);
  expect((await request.post(`${MOLLIE}/control/reset`)).ok()).toBe(true);
  await beheer.post("/api/admin/pin/terminal", { terminalId: null });
  await pair(page, code);
  await tile(page, /Koffie/).click();
  await expect(pinButton(page)).toBeDisabled();
  await expect(page.getByText("Pin is nog niet ingesteld.")).toBeVisible();

  // The penningmeester's own browser. The session cookie is handed over as it is: Safari's engine does not
  // keep a Secure cookie from a login over plain http, which is what this local run uses.
  const cut = beheer.cookie.indexOf("=");
  await context.addCookies([{ name: beheer.cookie.slice(0, cut), value: beheer.cookie.slice(cut + 1), domain: "localhost", path: "/" }]);
  const admin = await context.newPage();
  await admin.goto("/beheer");
  await admin.getByRole("link", { name: "Instellingen" }).click();
  const section = admin.getByRole("region", { name: "Pin via Mollie" });
  await expect(section.getByText("Testmodus: betalingen zijn nagespeeld, er wordt geen geld afgeschreven.")).toBeVisible();
  await expect(section.getByText("Kies een betaalterminal. Tot die tijd is de knop Pin op de kassa uit.")).toBeVisible();
  await section.getByRole("radio", { name: /Testterminal/ }).check();
  await section.getByRole("button", { name: "Opslaan" }).click();
  await expect(section.getByText("Betaalterminal opgeslagen.")).toBeVisible();
  await expect(section.getByText("Gekozen")).toBeVisible();
  await admin.close();

  // The kassa learns it with its next catalog, without anyone touching the iPad.
  await expect(pinButton(page)).toBeEnabled({ timeout: 40_000 });
  await expect(page.getByText("Pin is nog niet ingesteld.")).toBeHidden();
  await tap(page, "Pin");
  await expect(pinDialog(page, "Pin, te betalen").getByText(HOLD)).toBeVisible();
});

test("the pin dialog fits the iPad without scrolling, in every state", async ({ page, request }) => {
  await open(page, request);
  const fits = async (name: string, buttons: string[]) => {
    const dialog = pinDialog(page, name);
    await expect(dialog).toBeInViewport({ ratio: 1 });
    for (const button of buttons) {
      const found = dialog.getByRole("button", { name: button, exact: true });
      await expect(found).toBeInViewport({ ratio: 1 });
      expect((await found.boundingBox())!.height, button).toBeGreaterThanOrEqual(44);
    }
    expect(await dialog.evaluate((panel) => panel.scrollHeight <= panel.clientHeight), `${name} does not scroll`).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  };
  await pinACoffee(page);
  await expect(page.getByRole("link", { name: "Test: kies de uitkomst bij Mollie" })).toBeInViewport({ ratio: 1 });
  await fits("Pin, te betalen", ["Annuleren"]);
  await atTerminal(request, "failed", "terminal_unreachable"); // the longest explanation
  await expect(pinDialog(page, "Betaling geweigerd").getByText("De betaalterminal is niet bereikbaar. Staat hij aan en heeft hij internet?")).toBeVisible();
  await fits("Betaling geweigerd", ["Opnieuw proberen", "Toch contant", "Terug naar de bon"]);
  await tap(page, "Opnieuw proberen");
  await expect(pinDialog(page, "Pin, te betalen").getByText(HOLD)).toBeVisible();
  await loseTheConnection(page);
  await fits("Uitkomst onbekend", ["Volgende klant", "Toch contant"]);
});
