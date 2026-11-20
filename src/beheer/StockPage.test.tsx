import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import type { StockItem, StockOrder } from "../../shared/types";
import { calls, mockApi, mockLoggedIn, renderAt, rowIn, tap } from "../test-utils";

const item = (o: Partial<StockItem> = {}): StockItem => ({
  productId: "aardbeitje",
  name: "Aardbeitje",
  categoryName: "IJs",
  stock: 10,
  unitsPerBox: 24,
  reorderAt: 12,
  belowReorder: true,
  ...o,
});
const items = [
  item(),
  item({ productId: "bosfruit", name: "Bosfruit", stock: 3, unitsPerBox: null }),
  item({ productId: "mango-passie", name: "Mango passie", stock: 40, belowReorder: false }),
];
const order: StockOrder = {
  id: "o1",
  createdAt: "2026-07-28T09:00:00.000Z",
  note: null,
  status: "open",
  receivedAt: null,
  receivedBy: null,
  lines: [{ productId: "aardbeitje", name: "Aardbeitje", boxes: 2, looseUnits: 0, units: 48 }],
};
const open = async (extra: Record<string, unknown> = {}) => {
  mockLoggedIn();
  mockApi({ "/api/admin/stock": { items }, "/api/admin/stock/orders": { orders: [order] }, "POST /api/admin/stock/orders": [201, order], ...extra });
  renderAt("/beheer/voorraad");
  await screen.findByText("2 dozen Aardbeitje (48 stuks)");
};

it("lists what to reorder, lowest first", async () => {
  await open();
  expect(screen.getByRole("heading", { name: "Voorraad" })).toBeInTheDocument();
  const list = within(screen.getByRole("region", { name: "Bijbestellen" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent);
  expect(list).toEqual(["Bosfruit: nog 3", "Aardbeitje: nog 10"]);
});

it("says so when nothing is below its reorder level", async () => {
  await open({ "/api/admin/stock": { items: [item({ stock: 40, belowReorder: false })] } });
  expect(within(screen.getByRole("region", { name: "Bijbestellen" })).getByText("Niets onder de bestelgrens.")).toBeInTheDocument();
});

it("shows the stock, the box size and the reorder level per product", async () => {
  await open();
  expect(within(screen.getByRole("region", { name: "Stand" })).getByRole("row", { name: /Aardbeitje.*10.*24.*12/ })).toBeInTheDocument();
  for (const column of ["Product", "Voorraad", "Per doos", "Bestelgrens"]) {
    expect(within(screen.getByRole("region", { name: "Stand" })).getByRole("columnheader", { name: column })).toBeInTheDocument();
  }
});

it("posts only the lines that have a quantity", async () => {
  await open();
  expect(screen.getByRole("button", { name: "Bestelling opslaan" })).toBeDisabled(); // nothing to order yet
  await userEvent.type(rowIn("Bestelling invoeren", "Aardbeitje").getByLabelText("Dozen"), "2");
  expect(rowIn("Bestelling invoeren", "Aardbeitje").getByText("48 stuks")).toBeInTheDocument();
  await tap("Bestelling opslaan");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({ url: "/api/admin/stock/orders", body: { note: null, lines: [{ productId: "aardbeitje", boxes: 2, looseUnits: 0 }] } });
  expect((calls("POST")[0]!.body as { lines: unknown[] }).lines).toHaveLength(1);
  // The form is empty again and the list of orders is fetched anew.
  await waitFor(() => expect(rowIn("Bestelling invoeren", "Aardbeitje").getByLabelText("Dozen")).toHaveValue(null));
  await waitFor(() => expect(calls("GET").filter((c) => c.url === "/api/admin/stock/orders")).toHaveLength(2));
});

it("sends loose pieces and a note along", async () => {
  await open();
  await userEvent.type(rowIn("Bestelling invoeren", "Bosfruit").getByLabelText("Los"), "6");
  await userEvent.type(screen.getByLabelText("Notitie"), "komt donderdag");
  await tap("Bestelling opslaan");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]!.body).toEqual({ note: "komt donderdag", lines: [{ productId: "bosfruit", boxes: 0, looseUnits: 6 }] });
});

it("points to the product page when the box size is missing, and sends nothing", async () => {
  await open();
  await userEvent.type(rowIn("Bestelling invoeren", "Bosfruit").getByLabelText("Dozen"), "1");
  await tap("Bestelling opslaan");
  expect(await screen.findByText("Vul bij Bosfruit eerst het aantal per doos in (bij Producten).")).toBeInTheDocument();
  expect(calls("POST")).toHaveLength(0);
});

it("explains the server's refusal when the box size went missing in the meantime", async () => {
  await open({ "POST /api/admin/stock/orders": [400, { error: "units_per_box_missing" }] });
  await userEvent.type(rowIn("Bestelling invoeren", "Aardbeitje").getByLabelText("Dozen"), "2");
  await tap("Bestelling opslaan");
  expect(await screen.findByText("Vul eerst het aantal per doos in (bij Producten).")).toBeInTheDocument();
  expect(rowIn("Bestelling invoeren", "Aardbeitje").getByLabelText("Dozen")).toHaveValue(2); // nothing typed is lost
});

it("records a count", async () => {
  await open({ "POST /api/admin/stock/counts": { stock: 40, delta: 30 } });
  await userEvent.click(rowIn("Stand", "Aardbeitje").getByRole("button", { name: "Tellen" }));
  await tap("Opslaan");
  expect(await screen.findByText("Vul het getelde aantal in.")).toBeInTheDocument();
  expect(calls("POST")).toHaveLength(0);
  await userEvent.type(screen.getByLabelText("Geteld aantal"), "40");
  await tap("Opslaan");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({ url: "/api/admin/stock/counts", body: { productId: "aardbeitje", counted: 40, note: null } });
  expect(await screen.findByText("Telling opgeslagen: Aardbeitje staat nu op 40.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(calls("GET").filter((c) => c.url === "/api/admin/stock")).toHaveLength(2));
});

it("receives or cancels an open order", async () => {
  await open({ "POST /api/admin/stock/orders/o1/receive": { ok: true }, "POST /api/admin/stock/orders/o1/cancel": { ok: true } });
  expect(within(screen.getByRole("region", { name: "Onderweg" })).getByText("Besteld op 28-07-2026")).toBeInTheDocument();
  await tap("Markeer als ontvangen");
  await waitFor(() => expect(calls("POST")[0]?.url).toBe("/api/admin/stock/orders/o1/receive"));
  await tap("Laat vervallen");
  await waitFor(() => expect(calls("POST")[1]?.url).toBe("/api/admin/stock/orders/o1/cancel"));
});

it("receives a delivery once on a double click (Review Focus 4)", async () => {
  await open({ "POST /api/admin/stock/orders/o1/receive": { ok: true } });
  await userEvent.dblClick(screen.getByRole("button", { name: "Markeer als ontvangen" }));
  expect(await screen.findByText("Levering ontvangen, voorraad bijgewerkt")).toBeInTheDocument();
  expect(calls("POST")).toHaveLength(1);
});

it("lets a failed confirmation be tried again", async () => {
  await open({ "POST /api/admin/stock/orders/o1/receive": [500, { error: "server" }] });
  await tap("Markeer als ontvangen");
  expect(await screen.findByText("Dat lukte niet. Probeer het opnieuw.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Markeer als ontvangen" })).toBeEnabled());
});

it("takes an order that was already handled for what it is", async () => {
  await open({ "POST /api/admin/stock/orders/o1/receive": [409, { error: "not_open" }] });
  await tap("Markeer als ontvangen");
  expect(await screen.findByText("Deze bestelling was al afgehandeld.")).toBeInTheDocument();
  await waitFor(() => expect(calls("GET").filter((c) => c.url === "/api/admin/stock/orders")).toHaveLength(2));
});

it("lists earlier orders with how they ended", async () => {
  const received: StockOrder = { ...order, id: "o2", status: "received", receivedAt: "2026-07-30T08:15:00.000Z", receivedBy: "device" };
  const byAdmin: StockOrder = { ...order, id: "o3", status: "received", receivedAt: "2026-07-20T09:30:00.000Z", receivedBy: "admin" };
  const cancelled: StockOrder = { ...order, id: "o4", status: "cancelled" };
  mockLoggedIn();
  mockApi({ "/api/admin/stock": { items }, "/api/admin/stock/orders": { orders: [received, byAdmin, cancelled] } });
  renderAt("/beheer/voorraad");
  const earlier = within(await screen.findByRole("region", { name: "Eerdere bestellingen" }));
  expect(await earlier.findByText("Ontvangen op 30-07-2026 om 10:15 door de kassa")).toBeInTheDocument();
  expect(earlier.getByText("Ontvangen op 20-07-2026 om 11:30 door de penningmeester")).toBeInTheDocument();
  expect(earlier.getByText("Vervallen")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Onderweg" })).getByText("Geen levering onderweg.")).toBeInTheDocument();
});

it("says where to switch stock keeping on when no product has it", async () => {
  mockLoggedIn();
  mockApi({ "/api/admin/stock": { items: [] }, "/api/admin/stock/orders": { orders: [] } });
  renderAt("/beheer/voorraad");
  expect(await screen.findByText(/Van geen enkel product wordt de voorraad bijgehouden/)).toBeInTheDocument();
});
