import { act, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { calls, catalog, mockApi, mockOffline, renderAt, tap, user } from "../test-utils";
import { loadCatalog, saveCatalog, soldSinceFetch } from "./store/catalog";
import { getDb, setMeta } from "./store/db";
import { pendingCount, rejectedCount } from "./store/outbox";

const NBSP = String.fromCharCode(160);
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

it("queues a sale and offers to reverse it", async () => {
  await paired();
  mockOffline();
  renderAt("/");
  await sellOne();
  await waitFor(async () => expect(await pendingCount()).toBe(1));
  expect(await screen.findByText("1 verkoop wacht op verzending")).toBeInTheDocument();
  expect(screen.getByText("Laatste verkoop: € 1,10 contant")).toBeInTheDocument();
  await waitFor(async () => expect(await soldSinceFetch()).toEqual({ aardbeitje: 1 }));
  await tap("Terugdraaien");
  expect(screen.getByRole("dialog", { name: `Laatste verkoop van €${NBSP}1,10 terugdraaien?` })).toBeInTheDocument();
  await tap("Ja, terugdraaien");
  await waitFor(async () => expect(await pendingCount()).toBe(2));
  expect(screen.queryByText(/Laatste verkoop/)).not.toBeInTheDocument();
  expect(await screen.findByText("Verkoop teruggedraaid")).toBeInTheDocument();
  const [sale, reversal] = await queued();
  expect(reversal).toMatchObject({ kind: "reversal", reversesSaleId: sale.id });
  expect(reversal.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(reversal.id).not.toBe(sale.id);
  expect(await soldSinceFetch()).toEqual({});
  expect(await screen.findByText("2 verkopen wachten op verzending")).toBeInTheDocument();
});

it("keeps the sale when the reversal is not confirmed", async () => {
  await paired();
  mockOffline();
  renderAt("/");
  await sellOne();
  await tap("Terugdraaien");
  await tap("Nee");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("Laatste verkoop: € 1,10 contant")).toBeInTheDocument();
  expect(await pendingCount()).toBe(1);
});

it("offers to reverse only the last sale", async () => {
  await paired();
  mockOffline();
  renderAt("/");
  await sellOne();
  await tap(/Koffie/);
  await tap("Contant");
  await tap("Gepast");
  expect(await screen.findByText("Laatste verkoop: € 1,40 contant")).toBeInTheDocument();
  expect(screen.queryByText("Laatste verkoop: € 1,10 contant")).not.toBeInTheDocument();
  await tap("Terugdraaien");
  await tap("Ja, terugdraaien");
  await waitFor(async () => expect(await pendingCount()).toBe(3));
  const [, second, reversal] = await queued();
  expect(reversal).toMatchObject({ kind: "reversal", reversesSaleId: second.id });
});

it("hides the reversal offer after five minutes", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await paired();
  mockOffline();
  renderAt("/");
  await sellOne();
  expect(await screen.findByText(/Laatste verkoop/)).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(5 * 60_000 - 1000);
  });
  expect(screen.getByText(/Laatste verkoop/)).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.queryByText(/Laatste verkoop/)).not.toBeInTheDocument();
});

const TOO_LATE = "Terugdraaien kan tot vijf minuten na de verkoop. Meld het aan de penningmeester.";

it("does not reverse a sale of more than five minutes ago, also when the offer is still on screen", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await paired();
  mockOffline();
  renderAt("/");
  await sellOne();
  expect(await screen.findByText(/Laatste verkoop/)).toBeInTheDocument();
  // The iPad slept: the clock went on, the timers did not.
  vi.setSystemTime(Date.now() + 5 * 60_000 + 1000);
  await tap("Terugdraaien");
  await tap("Ja, terugdraaien");
  // The server would refuse it; saying "teruggedraaid" would leave the books and the cash box apart.
  expect(await screen.findByText(TOO_LATE)).toBeInTheDocument();
  expect(screen.queryByText("Verkoop teruggedraaid")).not.toBeInTheDocument();
  expect(screen.queryByText(/Laatste verkoop/)).not.toBeInTheDocument();
  expect(await pendingCount()).toBe(1);
});

it("takes the reversal offer away when the iPad wakes up after five minutes", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await paired();
  mockOffline();
  renderAt("/");
  await sellOne();
  expect(await screen.findByText(/Laatste verkoop/)).toBeInTheDocument();
  vi.setSystemTime(Date.now() + 5 * 60_000 + 1000);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(screen.queryByText(/Laatste verkoop/)).not.toBeInTheDocument();
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
  expect(await screen.findByText(/Kassa is ontkoppeld/)).toBeInTheDocument();
  await waitFor(async () => expect(await pendingCount()).toBe(1));
  expect(screen.getByRole("link", { name: "Opnieuw koppelen" })).toHaveAttribute("href", "/koppelen");
  expect(await loadCatalog()).toEqual(catalog);
});

it("sends the kept sales after pairing again (Review Focus 5)", async () => {
  await paired();
  mockApi({ "/api/kassa/catalog": [401, { error: "unauthorized" }], "POST /api/kassa/sales": [401, { error: "unauthorized" }] });
  const first = renderAt("/");
  await sellOne();
  expect(await screen.findByText(/Kassa is ontkoppeld/)).toBeInTheDocument();
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
    expect(screen.queryByText(/Laatste verkoop/)).not.toBeInTheDocument();
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
  await tap("Terugdraaien");
  await tap("Ja, terugdraaien");
  expect(await screen.findByText("nog 3")).toBeInTheDocument();
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
