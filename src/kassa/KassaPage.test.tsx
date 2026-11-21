import { act, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Catalog, PinStatus } from "../../shared/types";
import { calls, catalog, mockApi, mockOffline, renderAt, tap, user } from "../test-utils";
import { loadCatalog, saveCatalog, soldSinceFetch } from "./store/catalog";
import { getDb, setMeta } from "./store/db";
import { pendingCount, rejectedCount } from "./store/outbox";
import type { Parked } from "./store/pin";

const paired = async () => {
  await setMeta("deviceToken", "tok");
  await saveCatalog(catalog);
};
const sellOne = async () => {
  await tap(/Aardbeitje/);
  await tap("Contant");
  await tap("Gepast");
};
const acceptAll = (req: { body: { items: { id: string }[] } }) => ({
  results: req.body.items.map((i) => ({ id: i.id, status: "accepted" })),
});
const queued = async () => (await (await getDb()).getAll("outbox")).map((row) => row.item);

it("sends an unpaired iPad to the pairing page", async () => {
  renderAt("/");
  expect(await screen.findByRole("heading", { name: "Kassa koppelen" })).toBeInTheDocument();
});

it("starts from the cached catalog without a network", async () => {
  await paired();
  mockOffline();
  renderAt("/");
  expect(await screen.findByRole("button", { name: /Aardbeitje/ })).toBeInTheDocument();
  expect(await screen.findByText("Offline · contant werkt door")).toBeInTheDocument();
});

it("says what is needed when there is neither a cache nor a network", async () => {
  await setMeta("deviceToken", "tok");
  mockOffline();
  renderAt("/");
  expect(await screen.findByText("Geen verbinding. De kassa heeft één keer internet nodig om te starten.")).toBeInTheDocument();
});

it("starts by itself once the connection is there", async () => {
  await setMeta("deviceToken", "tok");
  mockOffline();
  renderAt("/");
  expect(await screen.findByText(/De kassa heeft één keer internet nodig/)).toBeInTheDocument();
  mockApi({ "/api/kassa/catalog": catalog });
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  expect(await screen.findByRole("button", { name: /Aardbeitje/ })).toBeInTheDocument();
  expect(await loadCatalog()).toEqual(catalog);
});

it("queues a sale and does not offer to take it back on the kassa", async () => {
  await paired();
  mockOffline();
  renderAt("/");
  await sellOne();
  await waitFor(async () => expect(await pendingCount()).toBe(1));
  expect(await screen.findByText("1 verkoop wacht op verzending")).toBeInTheDocument();
  await waitFor(async () => expect(await soldSinceFetch()).toEqual({ aardbeitje: 1 }));
  expect(await queued()).toMatchObject([{ kind: "sale", totalCents: 110 }]);
  // Taking a paid sale back is the penningmeester's work, in beheer: one wrong tap here would undo a sale.
  expect(screen.queryByText(/Laatste verkoop/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /terugdraaien/i })).not.toBeInTheDocument();
});

it("sends a sale and then has nothing waiting", async () => {
  await paired();
  mockApi({ "/api/kassa/catalog": catalog, "POST /api/kassa/sales": acceptAll });
  renderAt("/");
  await sellOne();
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  await waitFor(async () => expect(await pendingCount()).toBe(0));
  expect(calls("POST")[0]!.url).toBe("/api/kassa/sales");
  expect(calls("POST")[0]!.body).toMatchObject({ items: [{ kind: "sale", totalCents: 110, cashGivenCents: 110 }] });
  expect(await screen.findByText("Online")).toBeInTheDocument();
  expect(screen.queryByText(/wacht op verzending/)).not.toBeInTheDocument();
});

it("sends what was waiting as soon as the connection is back", async () => {
  await paired();
  mockOffline();
  renderAt("/");
  await sellOne();
  expect(await screen.findByText("1 verkoop wacht op verzending")).toBeInTheDocument();
  mockApi({ "/api/kassa/catalog": catalog, "POST /api/kassa/sales": acceptAll });
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  await waitFor(async () => expect(await pendingCount()).toBe(0));
  expect(await screen.findByText("Online")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText(/wacht op verzending/)).not.toBeInTheDocument());
});

it("reports a sale the server refused, without holding up the rest", async () => {
  await paired();
  mockApi({
    "/api/kassa/catalog": catalog,
    "POST /api/kassa/sales": (req: { body: { items: { id: string }[] } }) => ({
      results: req.body.items.map((i) => ({ id: i.id, status: "rejected", reason: "total_mismatch" })),
    }),
  });
  renderAt("/");
  await sellOne();
  expect(await screen.findByRole("button", { name: "1 verkoop afgekeurd · bekijken" })).toBeInTheDocument();
  expect(await rejectedCount()).toBe(1);
  expect(await pendingCount()).toBe(0);
});

it("shows what the server refused, and forgets it once it has been passed on", async () => {
  await paired();
  mockApi({
    "/api/kassa/catalog": catalog,
    "POST /api/kassa/sales": (req: { body: { items: { id: string }[] } }) => ({
      results: req.body.items.map((i) => ({ id: i.id, status: "rejected", reason: "total_mismatch" })),
    }),
  });
  renderAt("/");
  await tap(/Aardbeitje/);
  await sellOne();
  await tap("1 verkoop afgekeurd · bekijken");
  const dialog = within(await screen.findByRole("dialog", { name: "Afgekeurde verkopen" }));
  // Enough to pass on: when, how much, what, and why.
  expect(await dialog.findByText(/^Verkoop van \d\d-\d\d-\d{4} \d\d:\d\d · € 2,20 contant$/)).toBeInTheDocument();
  expect(dialog.getByText("2× Aardbeitje")).toBeInTheDocument();
  expect(dialog.getByText("Het totaal klopte niet met de regels.")).toBeInTheDocument();
  expect(dialog.getByText("Niet geboekt. Het geld zit wel in het kluisje.")).toBeInTheDocument();
  await user().click(dialog.getByRole("button", { name: "Doorgegeven" }));
  await waitFor(() => expect(screen.queryByText(/afgekeurd/)).not.toBeInTheDocument());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(await rejectedCount()).toBe(0);
});

it("shows a changed price within thirty seconds", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await paired();
  mockApi({ "/api/kassa/catalog": catalog });
  renderAt("/");
  expect(await screen.findByRole("button", { name: /Koffie.*1,40/ })).toBeInTheDocument();
  mockApi({
    "/api/kassa/catalog": { ...catalog, products: catalog.products.map((p) => (p.id === "koffie" ? { ...p, priceCents: 150 } : p)) },
  });
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(await screen.findByRole("button", { name: /Koffie.*1,50/ })).toBeInTheDocument();
});

it("does not fetch the catalog while sales are waiting, so the stock is counted once", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await paired();
  mockApi({ "/api/kassa/catalog": catalog, "POST /api/kassa/sales": [500, { error: "server" }] });
  renderAt("/");
  await screen.findByRole("button", { name: /Aardbeitje/ });
  await waitFor(() => expect(calls("GET")).toHaveLength(1));
  await sellOne();
  expect(await screen.findByText("1 verkoop wacht op verzending")).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  await waitFor(() => expect(calls("POST").length).toBeGreaterThanOrEqual(2));
  expect(calls("GET")).toHaveLength(1);
  expect(await soldSinceFetch()).toEqual({ aardbeitje: 1 });
});

it("says so when the device has been unpaired, and keeps the sales (Review Focus 5)", async () => {
  await paired();
  mockApi({ "/api/kassa/catalog": [401, { error: "unauthorized" }], "POST /api/kassa/sales": [401, { error: "unauthorized" }] });
  renderAt("/");
  await sellOne();
  expect(await screen.findByText(/Kassa is ontkoppeld\. Vraag de penningmeester/)).toBeInTheDocument();
  await waitFor(async () => expect(await pendingCount()).toBe(1));
  expect(screen.getByRole("link", { name: "Opnieuw koppelen" })).toHaveAttribute("href", "/koppelen");
  expect(await loadCatalog()).toEqual(catalog);
});

it("sends the kept sales after pairing again (Review Focus 5)", async () => {
  await paired();
  mockApi({ "/api/kassa/catalog": [401, { error: "unauthorized" }], "POST /api/kassa/sales": [401, { error: "unauthorized" }] });
  const first = renderAt("/");
  await sellOne();
  expect(await screen.findByText(/Kassa is ontkoppeld\. Vraag de penningmeester/)).toBeInTheDocument();
  await waitFor(async () => expect(await pendingCount()).toBe(1));
  first.unmount();
  await setMeta("deviceToken", "nieuw");
  mockApi({ "/api/kassa/catalog": catalog, "POST /api/kassa/sales": acceptAll });
  renderAt("/");
  await waitFor(async () => expect(await pendingCount()).toBe(0));
  expect(await screen.findByText("Online")).toBeInTheDocument();
});

it("says so when a sale could not be stored on the iPad", async () => {
  await paired();
  mockOffline();
  renderAt("/");
  await screen.findByRole("button", { name: /Aardbeitje/ });
  const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(() => {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  });
  try {
    await sellOne();
    expect(await screen.findByText("Opslaan mislukt. Noteer deze verkoop op papier en meld het aan de penningmeester.")).toBeInTheDocument();
  } finally {
    add.mockRestore();
  }
  expect(await pendingCount()).toBe(0);
});

const lowStock = { ...catalog, products: catalog.products.map((p) => (p.id === "aardbeitje" ? { ...p, stock: 3, reorderAt: 12 } : p)) };
const tile = async (name: RegExp) => within(await screen.findByRole("button", { name }));

it("shows what is left on a tile and counts down with every sale, also offline", async () => {
  await setMeta("deviceToken", "tok");
  await saveCatalog(lowStock);
  mockOffline();
  renderAt("/");
  expect((await tile(/Aardbeitje/)).getByText("nog 3")).toBeInTheDocument();
  expect((await tile(/Koffie/)).queryByText(/nog|op\?/)).not.toBeInTheDocument();
  await sellOne();
  expect(await screen.findByText("nog 2")).toBeInTheDocument();
});

it("remembers what was sold since the last catalog when the kassa is opened again", async () => {
  await setMeta("deviceToken", "tok");
  await saveCatalog(lowStock);
  mockOffline();
  const first = renderAt("/");
  await sellOne();
  expect(await screen.findByText("nog 2")).toBeInTheDocument();
  first.unmount();
  renderAt("/");
  expect((await tile(/Aardbeitje/)).getByText("nog 2")).toBeInTheDocument();
});

const delivery = {
  id: "o1",
  createdAt: "2026-07-30T08:00:00.000Z",
  note: null,
  lines: [{ productId: "aardbeitje", name: "Aardbeitje", boxes: 2, looseUnits: 0, units: 48 }],
};

it("confirms a delivery on the kassa and shows the new stock", async () => {
  const before = { ...lowStock, openOrders: [delivery] };
  const after = { ...catalog, products: catalog.products.map((p) => (p.id === "aardbeitje" ? { ...p, stock: 51, reorderAt: 12 } : p)) };
  let received = false;
  await setMeta("deviceToken", "tok");
  await saveCatalog(before);
  mockApi({
    "/api/kassa/catalog": () => (received ? after : before),
    "POST /api/kassa/orders/o1/receive": () => {
      received = true;
      return { ok: true };
    },
  });
  renderAt("/");
  expect((await tile(/Aardbeitje/)).getByText("nog 3")).toBeInTheDocument();
  await tap("Levering onderweg");
  expect(screen.getByText("2 dozen Aardbeitje (48 stuks)")).toBeInTheDocument();
  await tap("Ontvangen");
  expect(await screen.findByText("Levering ontvangen, voorraad bijgewerkt")).toBeInTheDocument();
  expect(calls("POST").map((call) => call.url)).toEqual(["/api/kassa/orders/o1/receive"]);
  await waitFor(() => expect(screen.queryByText("nog 3")).not.toBeInTheDocument());
  await waitFor(async () => expect((await loadCatalog())?.openOrders).toEqual([]));
  expect(screen.queryByRole("button", { name: "Levering onderweg" })).not.toBeInTheDocument();
});

it("treats a delivery someone else already confirmed as received", async () => {
  await setMeta("deviceToken", "tok");
  await saveCatalog({ ...catalog, openOrders: [delivery] });
  mockApi({ "/api/kassa/catalog": { ...catalog, openOrders: [delivery] }, "POST /api/kassa/orders/o1/receive": [409, { error: "not_open" }] });
  renderAt("/");
  await tap("Levering onderweg");
  await tap("Ontvangen");
  expect(await screen.findByText("Levering ontvangen, voorraad bijgewerkt")).toBeInTheDocument();
});

it("cannot confirm a delivery without a connection, and says the server refused when it did", async () => {
  await setMeta("deviceToken", "tok");
  await saveCatalog({ ...catalog, openOrders: [delivery] });
  mockApi({ "/api/kassa/catalog": { ...catalog, openOrders: [delivery] }, "POST /api/kassa/orders/o1/receive": [500, { error: "server" }] });
  renderAt("/");
  await tap("Levering onderweg");
  await tap("Ontvangen");
  expect(await screen.findByText("Dat lukte niet. Probeer het nog eens.")).toBeInTheDocument();
  mockOffline();
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(await screen.findByText("Bevestigen kan pas als er weer internet is.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ontvangen" })).toBeDisabled();
});

// Pin (fase 2)

const NBSP = String.fromCharCode(160);
const pinStatus = (id: string, over: Partial<PinStatus> = {}): PinStatus => ({ id, outcome: null, reason: null, sent: true, testUrl: null, ...over });
type PinRequest = { url: string; body: { id: string } };
const idOf = (req: PinRequest) => req.url.split("/")[4]!;
const startedPin = () => calls("POST").find((c) => c.url === "/api/kassa/pin")!.body as { id: string };
const pinButton = () => screen.getByRole("button", { name: "Pin" });
const serverDown: [number, unknown] = [500, { error: "server" }];

/** A receipt the kassa is not done with, as the iPad keeps it: one Aardbeitje of € 1,10, waiting for its outcome. */
const kept = async (over: Partial<Parked> = {}): Promise<Parked> => {
  const receipt: Parked = {
    id: crypto.randomUUID(),
    soldAt: "2026-07-30T12:32:00.000Z",
    totalCents: 110,
    lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 1 }],
    parked: true,
    failed: false,
    cashTaken: false,
    ...over,
  };
  await (await getDb()).put("pin", receipt);
  return receipt;
};
const twoIcesAndACoffee = {
  totalCents: 360,
  lines: [
    { productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 2 },
    { productId: "koffie", name: "Koffie", unitPriceCents: 140, qty: 1 },
  ],
};

it("shows the TEST bar in Mollie's test mode only", async () => {
  await setMeta("deviceToken", "tok");
  await saveCatalog({ ...catalog, pin: { mode: "test", ready: true } });
  mockOffline();
  const first = renderAt("/");
  expect(await screen.findByText("TEST")).toBeInTheDocument();
  expect(screen.getByText("Pinbetalingen zijn nagespeeld: er wordt geen geld afgeschreven.")).toBeInTheDocument();
  first.unmount();
  await saveCatalog(catalog); // mode "live"
  renderAt("/");
  await screen.findByRole("button", { name: /Aardbeitje/ });
  expect(screen.queryByText("TEST")).not.toBeInTheDocument();
});

it("keeps Pin off without a connection and says why, while cash goes on", async () => {
  await paired();
  mockOffline();
  renderAt("/");
  await tap(/Aardbeitje/);
  expect(await screen.findByText("Geen internet: pin kan nu niet. Contant werkt door.")).toBeInTheDocument();
  expect(pinButton()).toBeDisabled();
  await tap("Contant");
  await tap("Gepast");
  expect(await screen.findByText("1 verkoop wacht op verzending")).toBeInTheDocument();
});

it("keeps Pin off until a terminal is chosen, and on an iPad that still has a fase 1 catalog", async () => {
  await setMeta("deviceToken", "tok");
  const noTerminal: Catalog = { ...catalog, pin: { mode: "test", ready: false } };
  await saveCatalog(noTerminal);
  mockApi({ "/api/kassa/catalog": noTerminal });
  const first = renderAt("/");
  await tap(/Aardbeitje/);
  expect(await screen.findByText("Pin is nog niet ingesteld.")).toBeInTheDocument();
  expect(pinButton()).toBeDisabled();
  first.unmount();
  // What fase 1 left on the iPad knows nothing of pin, and the server cannot be asked for better right now.
  const { pin: _pin, ...fase1 } = catalog;
  await saveCatalog(fase1 as Catalog);
  mockApi({ "/api/kassa/catalog": serverDown });
  renderAt("/");
  await tap(/Aardbeitje/);
  expect(screen.getByTestId("total")).toHaveTextContent("€ 1,10");
  expect(await screen.findByText("Pin is nog niet ingesteld.")).toBeInTheDocument();
  expect(pinButton()).toBeDisabled();
  expect(screen.queryByText("TEST")).not.toBeInTheDocument();
});

it("keeps Pin off on a kassa that was unpaired", async () => {
  await paired();
  mockApi({ "/api/kassa/catalog": [401, { error: "unauthorized" }] });
  renderAt("/");
  await tap(/Aardbeitje/);
  expect(await screen.findByText("Kassa is ontkoppeld: pin kan nu niet.")).toBeInTheDocument();
  expect(pinButton()).toBeDisabled();
});

it("books nothing in the outbox for a paid pin sale and counts the stock down on the tile", async () => {
  await setMeta("deviceToken", "tok");
  await saveCatalog(lowStock);
  let paid = false;
  mockApi({
    // No new catalog after the payment: what the tile then shows is what the iPad counted itself.
    "/api/kassa/catalog": () => (paid ? serverDown : lowStock),
    "POST /api/kassa/pin": (req: PinRequest) => pinStatus(req.body.id),
    "/api/kassa/pin/*": (req: PinRequest) => {
      paid = true;
      return pinStatus(idOf(req), { outcome: "paid" });
    },
  });
  renderAt("/");
  await tap(/Aardbeitje/);
  await tap("Pin");
  expect(await screen.findByText("Pin betaald", {}, { timeout: 3000 })).toBeInTheDocument();
  expect(await screen.findByText("nog 2")).toBeInTheDocument();
  // The kassa asks for the new stock at once, instead of at the next half minute.
  await waitFor(() => expect(calls("GET").filter((c) => c.url === "/api/kassa/catalog").length).toBeGreaterThanOrEqual(2));
  expect(await pendingCount()).toBe(0);
  expect(calls("POST").map((c) => c.url)).toEqual(["/api/kassa/pin"]);
  expect(screen.queryByText(/wacht op bevestiging/i)).not.toBeInTheDocument();
});

it("parks the receipt when the connection drops, takes the next customer, and settles it when the connection is back", async () => {
  await setMeta("deviceToken", "tok");
  await saveCatalog(lowStock);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockApi({ "/api/kassa/catalog": lowStock, "POST /api/kassa/pin": (req: PinRequest) => pinStatus(req.body.id), "/api/kassa/pin/*": (req: PinRequest) => pinStatus(idOf(req)) });
  renderAt("/");
  await tap(/Aardbeitje/);
  await tap("Pin");
  expect(await screen.findByText("Houd pas of telefoon tegen de betaalterminal")).toBeInTheDocument();
  mockOffline();
  await act(() => vi.advanceTimersByTimeAsync(12_000));
  expect(await screen.findByRole("dialog", { name: "Uitkomst onbekend" })).toBeInTheDocument();
  await tap("Volgende klant");
  expect(await screen.findByRole("button", { name: "1 pinbetaling wacht op bevestiging" })).toBeInTheDocument();
  await tap(/Koffie/); // the next customer, in cash, offline
  await tap("Contant");
  await tap("Gepast");
  await waitFor(async () => expect(await pendingCount()).toBe(1));
  // Not counted as sold for as long as nobody knows whether it was paid.
  expect((await tile(/Aardbeitje/)).getByText("nog 3")).toBeInTheDocument();
  const parkedId = startedPin().id;
  mockApi({ [`/api/kassa/pin/${parkedId}`]: pinStatus(parkedId, { outcome: "paid" }), "POST /api/kassa/sales": acceptAll, "/api/kassa/catalog": serverDown });
  act(() => {
    // Twice: an outcome is told, and counted, once.
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
  });
  expect(await screen.findByText("Pinbetaling van € 1,10 is gelukt")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText(/wacht op bevestiging/i)).not.toBeInTheDocument());
  expect(await screen.findByText("nog 2")).toBeInTheDocument();
  await waitFor(async () => expect(await pendingCount()).toBe(0));
  expect(await soldSinceFetch()).toMatchObject({ aardbeitje: 1 });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("tells the beheerder with the amount when a parked payment did not go through, without opening anything by itself", async () => {
  await paired();
  await kept();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockApi({ "/api/kassa/catalog": catalog, "/api/kassa/pin/*": (req: PinRequest) => pinStatus(idOf(req), { outcome: "declined", reason: "insufficient_funds" }) });
  renderAt("/");
  expect(await screen.findByRole("button", { name: "1 pinbetaling wacht op bevestiging" })).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(5000)); // the kassa asks every five seconds
  const failedButton = `Pinbetaling van €${NBSP}1,10 niet gelukt`;
  expect(await screen.findByRole("button", { name: failedButton })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText(/wacht op bevestiging/i)).not.toBeInTheDocument();
  await tap(/Koffie/); // the kassa is not held up
  expect(screen.getByTestId("total")).toHaveTextContent("€ 1,40");
  await tap(failedButton);
  const dialog = within(await screen.findByRole("dialog", { name: "Pinbetalingen" }));
  expect(dialog.getByText(/^Niet gelukt · Pin van \d\d:\d\d · € 1,10$/)).toBeInTheDocument();
  expect(dialog.getByText("1× Aardbeitje")).toBeInTheDocument();
  expect(dialog.getByText("Deze pinbetaling is niet gelukt en is niet geboekt. Staat de klant er nog? Reken dan opnieuw af.")).toBeInTheDocument();
  await user().click(dialog.getByRole("button", { name: "Gezien" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.queryByRole("button", { name: /niet gelukt/ })).not.toBeInTheDocument());
  expect(screen.getByTestId("total")).toHaveTextContent("€ 1,40"); // the receipt in progress is untouched
  expect(await (await getDb()).getAll("pin")).toEqual([]);
});

it("still shows a failed payment after the kassa was closed and opened again, until it has been seen", async () => {
  await paired();
  await kept({ parked: false, failed: true, ...twoIcesAndACoffee });
  mockOffline();
  const first = renderAt("/");
  expect(await screen.findByRole("button", { name: `Pinbetaling van €${NBSP}3,60 niet gelukt` })).toBeInTheDocument();
  first.unmount();
  await kept({ parked: false, failed: true });
  renderAt("/");
  expect(await screen.findByRole("button", { name: "2 pinbetalingen niet gelukt" })).toBeInTheDocument();
});

it("keeps a payment that was seen in its place, greyed, while the list is open", async () => {
  await paired();
  const first = await kept({ parked: false, failed: true, soldAt: "2026-07-30T12:32:00.000Z" });
  await kept({ parked: false, failed: true, soldAt: "2026-07-30T12:40:00.000Z", ...twoIcesAndACoffee });
  mockOffline();
  renderAt("/");
  await tap("2 pinbetalingen niet gelukt");
  const dialog = within(await screen.findByRole("dialog", { name: "Pinbetalingen" }));
  await user().click(dialog.getAllByRole("button", { name: "Gezien" })[0]!);
  // The second tap of a double tap finds no button where the first one was.
  await waitFor(() => expect(dialog.getAllByRole("button", { name: "Gezien" })).toHaveLength(1));
  expect(dialog.getByText("Niet gelukt · Pin van 14:32 · € 1,10")).toBeInTheDocument();
  expect(dialog.getByText("Niet gelukt · Pin van 14:40 · € 3,60")).toBeInTheDocument();
  await waitFor(async () => expect((await (await getDb()).getAll("pin")).map((row) => row.id)).not.toContain(first.id));
  expect(await screen.findByRole("button", { name: `Pinbetaling van €${NBSP}3,60 niet gelukt` })).toBeInTheDocument();
  await user().click(dialog.getByRole("button", { name: "Gezien" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("rings up a parked receipt as cash, and then says nothing when the pin payment fails", async () => {
  await paired();
  const receipt = await kept();
  mockOffline();
  renderAt("/");
  await tap("1 pinbetaling wacht op bevestiging");
  const list = within(await screen.findByRole("dialog", { name: "Pinbetalingen" }));
  expect(list.getByText("Kijk op de betaalterminal of de betaling is gelukt. Zodra er verbinding is, haalt de kassa de uitkomst op.")).toBeInTheDocument();
  await user().click(list.getByRole("button", { name: "Toch contant" }));
  expect(await screen.findByRole("dialog", { name: "Contant, te betalen" })).toHaveTextContent("€ 1,10");
  await tap("Gepast");
  await waitFor(async () => expect(await queued()).toMatchObject([{ kind: "sale", totalCents: 110, cashGivenCents: 110, insteadOfSaleId: receipt.id }]));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await tap("1 pinbetaling wacht op bevestiging");
  const again = within(await screen.findByRole("dialog", { name: "Pinbetalingen" }));
  expect(await again.findByText("Contant afgerekend")).toBeInTheDocument();
  expect(again.queryByRole("button", { name: "Toch contant" })).not.toBeInTheDocument();
  mockApi({ "/api/kassa/catalog": catalog, "POST /api/kassa/sales": acceptAll, "/api/kassa/pin/*": (req: PinRequest) => pinStatus(idOf(req), { outcome: "declined" }) });
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  await waitFor(() => expect(screen.queryByText(/wacht op bevestiging/i)).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /niet gelukt/ })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByText(/is gelukt/)).not.toBeInTheDocument();
  expect(await (await getDb()).getAll("pin")).toEqual([]);
});

it("confirms a parked payment that went through after cash was taken", async () => {
  await paired();
  await kept();
  mockOffline();
  renderAt("/");
  await tap("1 pinbetaling wacht op bevestiging");
  await tap("Toch contant");
  await tap("Gepast");
  await waitFor(async () => expect(await pendingCount()).toBe(1));
  mockApi({ "/api/kassa/catalog": catalog, "POST /api/kassa/sales": acceptAll, "/api/kassa/pin/*": (req: PinRequest) => pinStatus(idOf(req), { outcome: "paid" }) });
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  // Both sales stand; beheer marks them for the penningmeester.
  expect(await screen.findByText("Pinbetaling van € 1,10 is gelukt")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText(/wacht op bevestiging/i)).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /niet gelukt/ })).not.toBeInTheDocument();
});

it("keeps Omzet where it was, with the pin buttons beside the status", async () => {
  await paired();
  await kept();
  await kept({ parked: false, failed: true, ...twoIcesAndACoffee });
  mockApi({ "/api/kassa/catalog": catalog, "/api/kassa/pin/*": (req: PinRequest) => pinStatus(idOf(req)) });
  renderAt("/");
  const footer = within(await screen.findByRole("contentinfo"));
  await footer.findByRole("button", { name: "1 pinbetaling wacht op bevestiging" });
  expect(footer.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "1 pinbetaling wacht op bevestiging",
    `Pinbetaling van €${NBSP}3,60 niet gelukt`,
    "Omzet",
  ]);
  const online = await footer.findByText("Online");
  expect(online.compareDocumentPosition(footer.getAllByRole("button")[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await tap("Omzet");
  expect(await screen.findByRole("dialog", { name: "Omzet" })).toBeInTheDocument();
});

it("brings back a receipt that was waiting when the kassa was closed (Review Focus 3)", async () => {
  await paired();
  await kept({ parked: false, failed: false, ...twoIcesAndACoffee });
  mockOffline();
  renderAt("/");
  await tap("1 pinbetaling wacht op bevestiging");
  const dialog = within(await screen.findByRole("dialog", { name: "Pinbetalingen" }));
  expect(dialog.getByText("Wacht op bevestiging · Pin van 14:32 · € 3,60")).toBeInTheDocument();
  expect(dialog.getByText("2× Aardbeitje, 1× Koffie")).toBeInTheDocument();
});

it("lists the payments that did not go through before the ones that are waiting", async () => {
  await paired();
  await kept({ soldAt: "2026-07-30T12:10:00.000Z" });
  await kept({ parked: false, failed: true, soldAt: "2026-07-30T12:32:00.000Z", ...twoIcesAndACoffee });
  mockOffline();
  renderAt("/");
  await tap("1 pinbetaling wacht op bevestiging");
  const dialog = within(await screen.findByRole("dialog", { name: "Pinbetalingen" }));
  expect(dialog.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent?.replaceAll(NBSP, " "))).toEqual([
    "Niet gelukt · Pin van 14:32 · € 3,60",
    "Wacht op bevestiging · Pin van 14:10 · € 1,10",
  ]);
});
