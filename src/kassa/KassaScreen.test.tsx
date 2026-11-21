import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi, type Mock } from "vitest";
import { cashSaleInput, pinSaleInput } from "../../shared/schemas";
import { catalog, render, tap } from "../test-utils";
import { KassaScreen } from "./KassaScreen";
import type { PinEnd, PinProgress, PinReceipt } from "./store/pin";

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

/** A pin payment the test steers by hand. */
function fakePin(blocked: string | null = null) {
  const runs: { receipt: PinReceipt; progress(p: Partial<PinProgress>): void; end(e: PinEnd): Promise<void>; cancel: Mock }[] = [];
  const start = vi.fn((receipt: PinReceipt, onProgress: (p: PinProgress) => void) => {
    let end!: (e: PinEnd) => void;
    const done = new Promise<PinEnd>((resolve) => (end = resolve));
    const cancel = vi.fn();
    runs.push({
      receipt,
      progress: (p) => act(() => onProgress({ sent: true, testUrl: null, cancelFailed: false, ...p })),
      end: (e) => act(async () => end(e)),
      cancel,
    });
    return { done, cancel };
  });
  return { pin: { blocked, start }, runs, start };
}

/** One Koffie on the receipt, Pin tapped: the payment waits for the test to steer it. */
async function pinningKoffie() {
  const onSale = vi.fn();
  const onPinPaid = vi.fn();
  const { pin, runs, start } = fakePin();
  render(<KassaScreen catalog={catalog} onSale={onSale} pin={pin} onPinPaid={onPinPaid} />);
  await tap(/Koffie/);
  await tap("Pin");
  return { onSale, onPinPaid, runs, start };
}

it("disables paying on an empty receipt", async () => {
  render(<KassaScreen catalog={catalog} onSale={vi.fn()} pin={fakePin().pin} />);
  expect(screen.getByRole("button", { name: "Contant" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Pin" })).toBeDisabled();
  await tap(/Koffie/);
  expect(screen.getByRole("button", { name: "Contant" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Pin" })).toBeEnabled();
});

it("keeps Pin off on an empty receipt, without the pin prop, and when pin is blocked, with the reason shown", async () => {
  const { rerender } = render(<KassaScreen catalog={catalog} onSale={vi.fn()} />);
  await tap(/Koffie/);
  expect(screen.getByRole("button", { name: "Pin" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Pin" })).not.toHaveAttribute("title");
  expect(screen.getByRole("button", { name: "Contant" })).toBeEnabled();
  rerender(<KassaScreen catalog={catalog} onSale={vi.fn()} pin={fakePin("Geen internet: pin kan nu niet. Contant werkt door.").pin} />);
  expect(screen.getByRole("button", { name: "Pin" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Pin" })).toHaveAttribute("title", "Geen internet: pin kan nu niet. Contant werkt door.");
  expect(screen.getByTestId("pin-blocked")).toHaveTextContent("Geen internet: pin kan nu niet. Contant werkt door.");
  expect(screen.getByRole("button", { name: "Contant" })).toBeEnabled();
  rerender(<KassaScreen catalog={catalog} onSale={vi.fn()} pin={fakePin().pin} />);
  expect(screen.getByRole("button", { name: "Pin" })).toBeEnabled();
  expect(screen.queryByTestId("pin-blocked")).not.toBeInTheDocument();
});

it("pays by pin: shows the amount and what to do, and keeps the receipt until Mollie has approved", async () => {
  const onSale = vi.fn();
  const onPinPaid = vi.fn();
  const { pin, runs } = fakePin();
  const before = Date.now();
  render(<KassaScreen catalog={catalog} onSale={onSale} pin={pin} onPinPaid={onPinPaid} />);
  await tap(/Aardbeitje/);
  await tap(/Koffie/);
  await tap("Pin");
  const dialog = within(screen.getByRole("dialog", { name: "Pin, te betalen" }));
  expect(dialog.getByText("€ 2,50")).toBeInTheDocument();
  expect(dialog.getByText("Betaling wordt gestart…")).toBeInTheDocument();
  expect(dialog.getByRole("button", { name: "Annuleren" })).toBeDisabled();
  expect(dialog.getAllByRole("button")).toHaveLength(1);
  const receipt = runs[0]!.receipt;
  expect(pinSaleInput.parse(receipt)).toEqual(receipt);
  expect(receipt).toMatchObject({ totalCents: 250, lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 1 }, { productId: "koffie", qty: 1 }] });
  expect(Date.parse(receipt.soldAt)).toBeGreaterThanOrEqual(before);
  runs[0]!.progress({});
  expect(dialog.getByText("Houd pas of telefoon tegen de betaalterminal")).toBeInTheDocument();
  expect(dialog.queryByText("Betaling wordt gestart…")).not.toBeInTheDocument();
  expect(dialog.getByRole("button", { name: "Annuleren" })).toBeEnabled();
  expect(total()).toHaveTextContent("€ 2,50"); // the receipt is still there
  await runs[0]!.end({ kind: "paid" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByText("Pin betaald")).toBeInTheDocument();
  expect(screen.getByText("Tik op een product om te beginnen.")).toBeInTheDocument();
  expect(onPinPaid).toHaveBeenCalledTimes(1);
  expect(onPinPaid).toHaveBeenCalledWith(receipt);
  expect(onSale).not.toHaveBeenCalled();
});

it("starts one payment on a double tap on Pin (Review Focus 4)", async () => {
  const { pin, start } = fakePin();
  render(<KassaScreen catalog={catalog} onSale={vi.fn()} pin={pin} />);
  await tap(/Koffie/);
  await userEvent.dblClick(screen.getByRole("button", { name: "Pin" }));
  expect(start).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Contant" })).toBeDisabled();
});

it("offers three ways on after a payment that did not go through", async () => {
  const { runs, onSale, onPinPaid } = await pinningKoffie();
  await runs[0]!.end({ kind: "failed", outcome: "declined", reason: "insufficient_funds" });
  const dialog = within(await screen.findByRole("dialog", { name: "Betaling geweigerd" }));
  expect(dialog.getByText("€ 1,40")).toBeInTheDocument();
  expect(dialog.getByText("Onvoldoende saldo.")).toBeInTheDocument();
  expect(dialog.getAllByRole("button").map((b) => b.textContent)).toEqual(["Opnieuw proberen", "Toch contant", "Terug naar de bon"]);
  await tap("Terug naar de bon");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(total()).toHaveTextContent("€ 1,40");
  expect(screen.getByRole("button", { name: "Pin" })).toBeEnabled();
  expect(onSale).not.toHaveBeenCalled();
  expect(onPinPaid).not.toHaveBeenCalled();
});

it.each([
  ["canceled", "Betaling geannuleerd"],
  ["expired", "Betaling verlopen"],
  ["start_failed", "Pin starten lukt niet"],
] as const)("names a payment that ended as %s", async (outcome, title) => {
  const { runs } = await pinningKoffie();
  await runs[0]!.end({ kind: "failed", outcome, reason: outcome === "start_failed" ? "no_terminal" : null });
  const dialog = within(await screen.findByRole("dialog", { name: title }));
  expect(dialog.getAllByRole("button")).toHaveLength(3);
  if (outcome === "start_failed") expect(dialog.getByText("Pin is nog niet ingesteld. Meld het aan de penningmeester.")).toBeInTheDocument();
  expect(total()).toHaveTextContent("€ 1,40");
});

it("tries again with a new payment for the same receipt", async () => {
  const { runs, start, onPinPaid } = await pinningKoffie();
  await runs[0]!.end({ kind: "failed", outcome: "declined", reason: null });
  await userEvent.dblClick(await screen.findByRole("button", { name: "Opnieuw proberen" }));
  expect(start).toHaveBeenCalledTimes(2);
  expect(runs[1]!.receipt.id).not.toBe(runs[0]!.receipt.id);
  expect(runs[1]!.receipt).toMatchObject({ totalCents: 140, lines: runs[0]!.receipt.lines });
  const dialog = within(screen.getByRole("dialog", { name: "Pin, te betalen" }));
  expect(dialog.getByText("Betaling wordt gestart…")).toBeInTheDocument();
  // What the first payment still has to say no longer counts.
  runs[0]!.progress({ cancelFailed: true });
  expect(dialog.queryByText("Annuleren lukte niet. Kijk op de betaalterminal.")).not.toBeInTheDocument();
  await runs[1]!.end({ kind: "paid" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(onPinPaid).toHaveBeenCalledWith(runs[1]!.receipt);
});

it("rings up cash after a failed pin payment and names the pin attempt", async () => {
  const { runs, onSale } = await pinningKoffie();
  await runs[0]!.end({ kind: "failed", outcome: "declined", reason: null });
  await tap("Toch contant");
  const cash = within(screen.getByRole("dialog", { name: "Contant, te betalen" }));
  expect(cash.getByText("€ 1,40")).toBeInTheDocument();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  await tap("Gepast");
  expect(onSale).toHaveBeenCalledTimes(1);
  const sale = onSale.mock.calls[0]![0];
  expect(cashSaleInput.parse(sale)).toEqual(sale);
  expect(sale).toMatchObject({ totalCents: 140, cashGivenCents: 140, insteadOfSaleId: runs[0]!.receipt.id });
  expect(sale.id).not.toBe(runs[0]!.receipt.id);
  expect(screen.getByText("Tik op een product om te beginnen.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("goes back to the receipt from cash after a failed pin payment, and a later cash sale is an ordinary one", async () => {
  const { runs, onSale } = await pinningKoffie();
  await runs[0]!.end({ kind: "failed", outcome: "declined", reason: null });
  await tap("Toch contant");
  await tap("Terug");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(total()).toHaveTextContent("€ 1,40");
  expect(onSale).not.toHaveBeenCalled();
  // The customer adds something and pays cash: that is a new receipt, not the one the pin attempt was for.
  await tap(/Aardbeitje/);
  await tap("Contant");
  await tap("Gepast");
  expect(onSale.mock.calls[0]![0]).toMatchObject({ totalCents: 250 });
  expect(onSale.mock.calls[0]![0]).not.toHaveProperty("insteadOfSaleId");
});

it("names the pin attempt also when the beheerder went back to the receipt and then took cash for it", async () => {
  const { runs, onSale } = await pinningKoffie();
  await runs[0]!.end({ kind: "failed", outcome: "start_failed", reason: "no_answer" });
  await tap("Terug naar de bon");
  await tap("Contant");
  await tap("Gepast");
  expect(onSale.mock.calls[0]![0]).toMatchObject({ totalCents: 140, insteadOfSaleId: runs[0]!.receipt.id });
  // The next receipt has nothing to do with that attempt.
  await tap(/Koffie/);
  await tap("Contant");
  await tap("Gepast");
  expect(onSale.mock.calls[1]![0]).not.toHaveProperty("insteadOfSaleId");
});

it("parks the receipt and frees the screen at once when the outcome is unknown", async () => {
  const { runs, onSale, onPinPaid } = await pinningKoffie();
  await runs[0]!.end({ kind: "unknown" });
  const dialog = within(await screen.findByRole("dialog", { name: "Uitkomst onbekend" }));
  expect(dialog.getByText("De verbinding viel weg tijdens het pinnen. Kijk op de betaalterminal of de betaling is gelukt.")).toBeInTheDocument();
  expect(dialog.getByText("De bon van € 1,40 is geparkeerd. Zodra er weer verbinding is, haalt de kassa de uitkomst op.")).toBeInTheDocument();
  expect(dialog.getAllByRole("button").map((b) => b.textContent)).toEqual(["Volgende klant", "Toch contant"]);
  expect(total()).toHaveTextContent("€ 0,00");
  await tap("Volgende klant");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(onSale).not.toHaveBeenCalled();
  expect(onPinPaid).not.toHaveBeenCalled();
});

it("rings up the parked receipt as cash when the beheerder chooses that", async () => {
  const { runs, onSale } = await pinningKoffie();
  await runs[0]!.end({ kind: "unknown" });
  await tap("Toch contant");
  const cash = within(screen.getByRole("dialog", { name: "Contant, te betalen" }));
  expect(cash.getByText("€ 1,40")).toBeInTheDocument();
  await tap(`€${NBSP}5`);
  await tap("Klaar");
  expect(onSale).toHaveBeenCalledTimes(1);
  expect(onSale.mock.calls[0]![0]).toMatchObject({
    totalCents: 140,
    cashGivenCents: 500,
    insteadOfSaleId: runs[0]!.receipt.id,
    lines: [{ productId: "koffie", name: "Koffie", unitPriceCents: 140, qty: 1 }],
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(total()).toHaveTextContent("€ 0,00");
});

it("asks to cancel and keeps waiting for the real outcome", async () => {
  const { runs } = await pinningKoffie();
  runs[0]!.progress({});
  await tap("Annuleren");
  expect(runs[0]!.cancel).toHaveBeenCalledTimes(1);
  const dialog = within(screen.getByRole("dialog", { name: "Pin, te betalen" }));
  expect(dialog.queryByText("Annuleren lukte niet. Kijk op de betaalterminal.")).not.toBeInTheDocument();
  runs[0]!.progress({ cancelFailed: true });
  expect(dialog.getByText("Annuleren lukte niet. Kijk op de betaalterminal.")).toBeInTheDocument();
  expect(total()).toHaveTextContent("€ 1,40");
  await runs[0]!.end({ kind: "failed", outcome: "canceled", reason: null });
  expect(await screen.findByRole("dialog", { name: "Betaling geannuleerd" })).toBeInTheDocument();
});

it("shows Mollie's test link only when there is one", async () => {
  const { runs } = await pinningKoffie();
  runs[0]!.progress({ testUrl: "https://www.mollie.com/checkout/test-mode?x" });
  const link = screen.getByRole("link", { name: "Test: kies de uitkomst bij Mollie" });
  expect(link).toHaveAttribute("href", "https://www.mollie.com/checkout/test-mode?x");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noreferrer");
  runs[0]!.progress({});
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("offers no way to take a paid sale back", async () => {
  const { runs } = await pinningKoffie();
  await runs[0]!.end({ kind: "paid" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /terugdraai|ongedaan|herstel/i })).not.toBeInTheDocument();
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
