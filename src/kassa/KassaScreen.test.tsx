import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { cashSaleInput } from "../../shared/schemas";
import { catalog, render, tap } from "../test-utils";
import { KassaScreen } from "./KassaScreen";

const NBSP = String.fromCharCode(160);
const line = (name: string) => within(screen.getByRole("listitem", { name }));
const total = () => screen.getByTestId("total");

it("sells three products for cash in five taps", async () => {
  const onSale = vi.fn();
  render(<KassaScreen catalog={catalog} onSale={onSale} />);
  await tap(/Aardbeitje/);
  await tap(/Aardbeitje/);
  await tap(/Koffie/);
  await tap("Contant");
  await tap("Gepast");
  expect(onSale).toHaveBeenCalledTimes(1);
  expect(onSale.mock.calls[0]![0]).toMatchObject({
    kind: "sale",
    totalCents: 360,
    cashGivenCents: 360,
    lines: [
      { productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 2 },
      { productId: "koffie", name: "Koffie", unitPriceCents: 140, qty: 1 },
    ],
  });
  expect(onSale.mock.calls[0]![0].id).toMatch(/^[0-9a-f-]{36}$/);
  expect(screen.getByText("Tik op een product om te beginnen.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByText("Contant ontvangen")).toBeInTheDocument();
});

it("hands over a sale the server accepts", async () => {
  const onSale = vi.fn();
  const before = Date.now();
  render(<KassaScreen catalog={catalog} onSale={onSale} />);
  await tap(/Koffie/);
  await tap("Contant");
  await tap("Gepast");
  const sale = cashSaleInput.parse(onSale.mock.calls[0]![0]);
  expect(Date.parse(sale.soldAt)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(sale.soldAt)).toBeLessThanOrEqual(Date.now());
});

it("shows the change for a banknote", async () => {
  const onSale = vi.fn();
  render(<KassaScreen catalog={catalog} onSale={onSale} />);
  await tap(/Aardbeitje/);
  await tap(/Aardbeitje/);
  await tap(/Koffie/);
  await tap("Contant");
  expect(screen.getByRole("dialog", { name: "Contant, te betalen" })).toBeInTheDocument();
  expect(screen.getByText("Wat geeft de klant?")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: `€${NBSP}5` })).toBeInTheDocument(); // every note above the amount
  await tap(`€${NBSP}10`);
  expect(screen.getByText("Wisselgeld")).toBeInTheDocument();
  expect(screen.getByText("€ 6,40")).toBeInTheDocument();
  expect(screen.getByText("Gekregen € 10,00, te betalen € 3,60")).toBeInTheDocument();
  expect(onSale).not.toHaveBeenCalled();
  await tap("Klaar");
  expect(onSale.mock.calls[0]![0].cashGivenCents).toBe(1000);
  expect(onSale.mock.calls[0]![0].totalCents).toBe(360);
});

it("records one sale on a double tap (Review Focus 4)", async () => {
  const onSale = vi.fn();
  render(<KassaScreen catalog={catalog} onSale={onSale} />);
  await tap(/Koffie/);
  await tap("Contant");
  await userEvent.dblClick(screen.getByRole("button", { name: "Gepast" }));
  expect(onSale).toHaveBeenCalledTimes(1);
});

it("goes back from paying without selling anything", async () => {
  const onSale = vi.fn();
  render(<KassaScreen catalog={catalog} onSale={onSale} />);
  await tap(/Koffie/);
  await tap("Contant");
  expect(screen.getByRole("button", { name: "Contant" })).toBeDisabled();
  await tap("Terug");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(onSale).not.toHaveBeenCalled();
  expect(total()).toHaveTextContent("€ 1,40");
  expect(screen.getByRole("button", { name: "Contant" })).toBeEnabled();
  // The next time the dialog starts at the beginning again.
  await tap("Contant");
  await tap(`€${NBSP}5`);
  await tap("Klaar");
  await tap(/Koffie/);
  await tap("Contant");
  expect(screen.getByText("Wat geeft de klant?")).toBeInTheDocument();
});

it("corrects the receipt", async () => {
  render(<KassaScreen catalog={catalog} onSale={vi.fn()} />);
  await tap(/Aardbeitje/);
  await tap(/Aardbeitje/);
  await tap(/Koffie/);
  await userEvent.click(line("Aardbeitje").getByRole("button", { name: "Eén minder" }));
  expect(total()).toHaveTextContent("€ 2,50");
  await userEvent.click(line("Aardbeitje").getByRole("button", { name: "Eén meer" }));
  expect(total()).toHaveTextContent("€ 3,60");
  expect(line("Aardbeitje").getByText("€ 2,20")).toBeInTheDocument();
  await userEvent.click(line("Aardbeitje").getByRole("button", { name: "Verwijder" }));
  expect(screen.queryByRole("listitem", { name: "Aardbeitje" })).not.toBeInTheDocument();
  await userEvent.click(line("Koffie").getByRole("button", { name: "Eén minder" })); // minus on the last piece removes the line
  expect(screen.getByText("Tik op een product om te beginnen.")).toBeInTheDocument();
});

it("clears the receipt at once, without a message or a way back", async () => {
  render(<KassaScreen catalog={catalog} onSale={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Wis alles" })).toBeDisabled();
  await tap(/Koffie/);
  await tap("Wis alles");
  expect(total()).toHaveTextContent("€ 0,00");
  expect(screen.getByText("Tik op een product om te beginnen.")).toBeInTheDocument();
  // The penningmeester found "Bon gewist · Ongedaan maken" confusing for the beheerder: nothing pops up.
  expect(screen.queryByText("Bon gewist")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Ongedaan maken" })).not.toBeInTheDocument();
});

it("enters statiegeld with the number pad", async () => {
  render(<KassaScreen catalog={catalog} onSale={vi.fn()} />);
  await tap(/Statiegeld/);
  expect(screen.getByText("Statiegeld, hoeveel stuks?")).toBeInTheDocument();
  await tap("4");
  await tap("0");
  expect(screen.getByText("40 × € 0,15 = € 6,00")).toBeInTheDocument();
  await tap("Toevoegen");
  expect(total()).toHaveTextContent("€ 6,00");
  await tap(/Statiegeld/);
  await tap("Toevoegen"); // nothing entered: the pad closes and adds nothing
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(total()).toHaveTextContent("€ 6,00");
  await tap(/Statiegeld/);
  for (const digit of ["1", "2", "3", "4"]) await tap(digit);
  expect(screen.getByText("123 × € 0,15 = € 18,45")).toBeInTheDocument(); // the fourth digit is ignored
});

it("takes back a digit and cancels the number pad", async () => {
  render(<KassaScreen catalog={catalog} onSale={vi.fn()} />);
  await tap(/Statiegeld/);
  await tap("4");
  await tap("0");
  await tap("Wis cijfer");
  expect(screen.getByText("4 × € 0,15 = € 0,60")).toBeInTheDocument();
  await tap("0");
  await tap("Toevoegen");
  expect(total()).toHaveTextContent("€ 6,00");
  await tap(/Statiegeld/);
  expect(screen.getByText("0 × € 0,15 = € 0,00")).toBeInTheDocument(); // the pad starts empty again
  await tap("0"); // a zero in front does not use up one of the three digits
  for (const digit of ["9", "9", "9"]) await tap(digit);
  expect(screen.getByText("999 × € 0,15 = € 149,85")).toBeInTheDocument();
  await tap("Annuleren");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(total()).toHaveTextContent("€ 6,00");
});

it("disables paying on an empty receipt, and pin always", async () => {
  render(<KassaScreen catalog={catalog} onSale={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Contant" })).toBeDisabled();
  await tap(/Koffie/);
  expect(screen.getByRole("button", { name: "Contant" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Pin" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Pin" })).toHaveAttribute("title", "Pin volgt in fase 2");
});

it("shows a note on a tile when given one", () => {
  render(<KassaScreen catalog={catalog} onSale={vi.fn()} tileNote={(id) => (id === "aardbeitje" ? "nog 5" : null)} />);
  expect(within(screen.getByRole("button", { name: /Aardbeitje/ })).getByText("nog 5")).toBeInTheDocument();
});

it("shows every product with its price, coloured by its category, and counts on the tile", async () => {
  render(<KassaScreen catalog={catalog} onSale={vi.fn()} />);
  const tile = screen.getByRole("button", { name: /Aardbeitje/ });
  expect(within(tile).getByText("€ 1,10")).toBeInTheDocument();
  expect(tile).toHaveStyle({ backgroundColor: "#F6DDE2", color: "#6E1F33" });
  expect(screen.getByRole("button", { name: /Koffie/ })).toHaveStyle({ backgroundColor: "#EADBCB" });
  expect(within(tile).queryByTestId("tile-qty")).not.toBeInTheDocument();
  await tap(/Aardbeitje/);
  await tap(/Aardbeitje/);
  expect(within(screen.getByRole("button", { name: /Aardbeitje/ })).getByTestId("tile-qty")).toHaveTextContent("2");
});

it("keeps the price of the first tap when the price changes while the receipt is open (Review Focus 3)", async () => {
  const onSale = vi.fn();
  const { rerender } = render(<KassaScreen catalog={catalog} onSale={onSale} />);
  await tap(/Koffie/);
  const dearer = { ...catalog, products: catalog.products.map((p) => (p.id === "koffie" ? { ...p, priceCents: 150 } : p)) };
  rerender(<KassaScreen catalog={dearer} onSale={onSale} />);
  await tap(/Koffie/);
  expect(total()).toHaveTextContent("€ 2,80");
  await tap("Contant");
  await tap("Gepast");
  expect(cashSaleInput.parse(onSale.mock.calls[0]![0])).toMatchObject({
    totalCents: 280,
    lines: [{ productId: "koffie", unitPriceCents: 140, qty: 2 }],
  });
});

it("shows what it is given above and below the screen", () => {
  render(<KassaScreen catalog={catalog} onSale={vi.fn()} header={<p>Levering onderweg</p>} footer={<p>Online</p>} />);
  expect(screen.getByText("Levering onderweg")).toBeInTheDocument();
  expect(screen.getByText("Online")).toBeInTheDocument();
});
