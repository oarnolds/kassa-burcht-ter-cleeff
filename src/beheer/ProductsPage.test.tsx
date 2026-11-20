import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import type { AdminProduct } from "../../shared/types";
import { calls, mockApi, mockLoggedIn, renderAt, rowIn, tap } from "../test-utils";

const product = (o: Partial<AdminProduct> = {}): AdminProduct => ({
  id: "koffie",
  name: "Koffie",
  priceCents: 140,
  categoryId: "warm",
  sort: 16,
  quantityPad: false,
  trackStock: false,
  reorderAt: null,
  unitsPerBox: null,
  active: true,
  ...o,
});
const data = {
  categories: [
    { id: "warm", name: "Warme dranken", color: "brown", sort: 3 },
    { id: "snacks", name: "Snacks", color: "yellow", sort: 4 },
  ],
  products: [product(), product({ id: "thee", name: "Thee", sort: 17 })],
};
const open = async (extra: Record<string, unknown> = {}) => {
  mockLoggedIn();
  mockApi({
    "/api/admin/products": data,
    "PATCH /api/admin/products/koffie": product(),
    "PUT /api/admin/products/order": { ok: true },
    "POST /api/admin/products": [201, product({ id: "n1", name: "Tosti" })],
    ...extra,
  });
  renderAt("/beheer/producten");
  await screen.findByRole("region", { name: "Warme dranken" });
};
const edit = (name: string) => userEvent.click(rowIn("Warme dranken", name).getByRole("button", { name: "Bewerken" }));
const fetched = () => calls("GET").filter((c) => c.url === "/api/admin/products").length;

it("lists the products per category with their price and marks", async () => {
  await open({
    "/api/admin/products": { ...data, products: [product({ active: false }), product({ id: "thee", name: "Thee", sort: 17, trackStock: true })] },
  });
  expect(screen.getByRole("heading", { name: "Producten" })).toBeInTheDocument();
  expect(rowIn("Warme dranken", "Koffie").getByText("€ 1,40")).toBeInTheDocument();
  expect(rowIn("Warme dranken", "Koffie").getByText("Verborgen")).toBeInTheDocument();
  expect(rowIn("Warme dranken", "Koffie").queryByText("Voorraad")).not.toBeInTheDocument();
  expect(rowIn("Warme dranken", "Thee").getByText("Voorraad")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Snacks" })).getByText("Nog geen producten in deze categorie.")).toBeInTheDocument();
});

it("changes a price in cents", async () => {
  await open();
  await edit("Koffie");
  expect(screen.getByLabelText("Naam")).toHaveValue("Koffie");
  const prijs = screen.getByLabelText("Prijs");
  await userEvent.clear(prijs);
  await userEvent.type(prijs, "1,50");
  await tap("Opslaan");
  await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
  expect(calls("PATCH")[0]).toMatchObject({ url: "/api/admin/products/koffie", body: { priceCents: 150 } });
  // Saved: the dialog is gone and the list is fetched again.
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(fetched()).toBe(2));
});

it("hides a product", async () => {
  await open();
  await edit("Koffie");
  await userEvent.click(screen.getByLabelText("Zichtbaar op de kassa"));
  await tap("Opslaan");
  await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
  expect(calls("PATCH")[0]!.body).toMatchObject({ active: false });
});

it("shows the stock fields only when stock is tracked", async () => {
  await open();
  await edit("Koffie");
  expect(screen.queryByLabelText("Stuks per doos")).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Voorraad bijhouden"));
  await userEvent.type(screen.getByLabelText("Stuks per doos"), "24");
  await userEvent.type(screen.getByLabelText("Bestelgrens (stuks)"), "12");
  await tap("Opslaan");
  await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
  expect(calls("PATCH")[0]!.body).toMatchObject({ trackStock: true, unitsPerBox: 24, reorderAt: 12 });
});

it("leaves the box size and the reorder level open when they are not filled in", async () => {
  await open();
  await edit("Koffie");
  await userEvent.click(screen.getByLabelText("Voorraad bijhouden"));
  await userEvent.click(screen.getByLabelText("Opent een cijferblok voor het aantal"));
  await tap("Opslaan");
  await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
  expect(calls("PATCH")[0]!.body).toMatchObject({ trackStock: true, unitsPerBox: null, reorderAt: null, quantityPad: true });
});

it("refuses a box size that is not a whole number of pieces", async () => {
  await open();
  await edit("Koffie");
  await userEvent.click(screen.getByLabelText("Voorraad bijhouden"));
  await userEvent.type(screen.getByLabelText("Stuks per doos"), "0");
  await tap("Opslaan");
  expect(await screen.findByText("Stuks per doos is een heel getal van 1 tot 500.")).toBeInTheDocument();
  expect(calls("PATCH")).toHaveLength(0);
});

it("moves a product within its category", async () => {
  await open();
  expect(rowIn("Warme dranken", "Koffie").getByRole("button", { name: "Omhoog" })).toBeDisabled(); // already first
  expect(rowIn("Warme dranken", "Thee").getByRole("button", { name: "Omlaag" })).toBeDisabled(); // already last
  await userEvent.click(rowIn("Warme dranken", "Thee").getByRole("button", { name: "Omhoog" }));
  await waitFor(() => expect(calls("PUT")).toHaveLength(1));
  expect(calls("PUT")[0]).toMatchObject({ url: "/api/admin/products/order", body: { ids: ["thee", "koffie"] } });
  await waitFor(() => expect(fetched()).toBe(2));
});

it("moves a product down", async () => {
  await open();
  await userEvent.click(rowIn("Warme dranken", "Koffie").getByRole("button", { name: "Omlaag" }));
  await waitFor(() => expect(calls("PUT")).toHaveLength(1));
  expect(calls("PUT")[0]!.body).toEqual({ ids: ["thee", "koffie"] });
});

it("adds a product", async () => {
  await open();
  await tap("Nieuw product");
  expect(screen.getByRole("button", { name: "Opslaan" })).toBeDisabled(); // no name and no price yet
  await userEvent.type(screen.getByLabelText("Naam"), "Tosti");
  await userEvent.type(screen.getByLabelText("Prijs"), "2,50");
  await userEvent.selectOptions(screen.getByLabelText("Categorie"), "snacks");
  await tap("Opslaan");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({ url: "/api/admin/products", body: { name: "Tosti", priceCents: 250, categoryId: "snacks" } });
  expect(calls("PATCH")).toHaveLength(0);
});

it("adds a product that is not on the kassa yet", async () => {
  await open({ "PATCH /api/admin/products/n1": product({ id: "n1", name: "Tosti", active: false }) });
  await tap("Nieuw product");
  await userEvent.type(screen.getByLabelText("Naam"), "Tosti");
  await userEvent.type(screen.getByLabelText("Prijs"), "2,50");
  await userEvent.click(screen.getByLabelText("Zichtbaar op de kassa"));
  await tap("Opslaan");
  await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
  expect(calls("PATCH")[0]).toMatchObject({ url: "/api/admin/products/n1", body: { active: false } });
});

it("does not make a product twice when hiding it fails", async () => {
  await open({ "PATCH /api/admin/products/n1": [500, { error: "internal" }] });
  await tap("Nieuw product");
  await userEvent.type(screen.getByLabelText("Naam"), "Tosti");
  await userEvent.type(screen.getByLabelText("Prijs"), "2,50");
  await userEvent.click(screen.getByLabelText("Zichtbaar op de kassa"));
  await tap("Opslaan");
  // The product exists by now: the dialog must not invite a second "Opslaan".
  expect(await screen.findByText("Tosti is toegevoegd, maar verbergen is niet gelukt. Verberg het via Bewerken.")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(calls("POST")).toHaveLength(1);
  await waitFor(() => expect(fetched()).toBe(2));
});

it("does not save an unreadable price", async () => {
  await open();
  await edit("Koffie");
  const prijs = screen.getByLabelText("Prijs");
  await userEvent.clear(prijs);
  await userEvent.type(prijs, "abc");
  expect(screen.getByRole("button", { name: "Opslaan" })).toBeDisabled();
});

it("keeps the dialog open and says so when saving fails", async () => {
  await open({ "PATCH /api/admin/products/koffie": [400, { error: "invalid" }] });
  await edit("Koffie");
  await tap("Opslaan");
  expect(await screen.findByText("Opslaan is niet gelukt. Controleer wat je hebt ingevuld.")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("changes the colour of a category", async () => {
  await open({ "PATCH /api/admin/categories/warm": { id: "warm", name: "Warme dranken", color: "green", sort: 3 } });
  const kleur = screen.getByLabelText("Kleur van Warme dranken");
  expect(kleur).toHaveValue("brown");
  expect(within(kleur).getByRole("option", { name: "Bruin" })).toBeInTheDocument();
  await userEvent.selectOptions(kleur, "green");
  await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
  expect(calls("PATCH")[0]).toMatchObject({ url: "/api/admin/categories/warm", body: { color: "green" } });
  await waitFor(() => expect(fetched()).toBe(2));
});

it("renames a category", async () => {
  await open({ "PATCH /api/admin/categories/snacks": { id: "snacks", name: "Hartig", color: "yellow", sort: 4 } });
  const row = within(screen.getByRole("region", { name: "Categorieën" })).getAllByRole("listitem")[1]!;
  await userEvent.click(within(row).getByRole("button", { name: "Naam wijzigen" }));
  const naam = screen.getByLabelText("Categorienaam");
  expect(naam).toHaveValue("Snacks");
  await userEvent.clear(naam);
  await userEvent.type(naam, "Hartig");
  await tap("Opslaan");
  await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
  expect(calls("PATCH")[0]).toMatchObject({ url: "/api/admin/categories/snacks", body: { name: "Hartig" } });
});

it("adds a category with a colour", async () => {
  await open({ "POST /api/admin/categories": [201, { id: "c9", name: "Seizoen", color: "green", sort: 7 }] });
  await tap("Nieuwe categorie");
  await userEvent.type(screen.getByLabelText("Categorienaam"), "Seizoen");
  await userEvent.selectOptions(screen.getByLabelText("Kleur"), "green");
  await tap("Opslaan");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({ url: "/api/admin/categories", body: { name: "Seizoen", color: "green" } });
});
