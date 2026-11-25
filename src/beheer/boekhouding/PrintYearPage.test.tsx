import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { mockApi, mockLoggedIn, renderAt, rowIn, user } from "../../test-utils";
import { base, yearData } from "./ledger-test-data";

const page = "/beheer/boekhouding/jaar/2027/afdruk";
/** As formatEuro writes it: a non-breaking space after the euro sign. */
const eur = (text: string) => text.replaceAll("€ ", "€\u00a0");
/** The texts of the cells of the one row with `row` in it, in the region `section`. */
const cellsOf = (section: string, row: string) =>
  rowIn(section, row)
    .getAllByRole("cell")
    .map((cell: HTMLElement) => cell.textContent);

afterEach(() => {
  vi.restoreAllMocks();
});

it("prints the balance and the result", async () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  mockLoggedIn();
  mockApi({ [`${base}/year/2027/export`]: yearData() });
  renderAt(page);
  expect(await screen.findByRole("heading", { name: "Jaaroverzicht 2027" })).toBeInTheDocument();
  expect(await screen.findByText("Afgesloten op 4-2-2028")).toBeInTheDocument();
  expect(screen.queryByText("Voorlopig")).not.toBeInTheDocument();

  // The balance, begin and end side by side.
  const balance = within(screen.getByRole("region", { name: "Balans" }));
  expect(balance.getByRole("columnheader", { name: "1-1-2027" })).toBeInTheDocument();
  expect(balance.getByRole("columnheader", { name: "31-12-2027" })).toBeInTheDocument();
  expect(cellsOf("Balans", "1010 ING betaalrekening")).toEqual([
    "1010 ING betaalrekening",
    eur("€ 5.000,00"),
    eur("€ 5.098,00"),
  ]);
  expect(cellsOf("Balans", "0135")).toEqual([
    "0135 Afschrijving speeltoestellen en inventaris",
    eur("-€ 9.021,20"),
    eur("-€ 9.221,20"),
  ]);
  expect(cellsOf("Balans", "Totaal bezittingen")).toEqual(["Totaal bezittingen", eur("€ 5.474,80"), eur("€ 5.372,80")]);
  expect(cellsOf("Balans", "Resultaat nog niet geboekt")).toEqual(["Resultaat nog niet geboekt", eur("€ 0,00"), eur("-€ 102,00")]);
  expect(cellsOf("Balans", "Totaal schulden")).toEqual([
    "Totaal schulden en eigen vermogen",
    eur("€ 5.474,80"),
    eur("€ 5.372,80"),
  ]);

  // The result next to the year before.
  const result = within(screen.getByRole("region", { name: "Winst en verlies" }));
  expect(result.getByRole("columnheader", { name: "2027" })).toBeInTheDocument();
  expect(result.getByRole("columnheader", { name: "2026" })).toBeInTheDocument();
  expect(cellsOf("Winst en verlies", "8012 Entree")).toEqual(["8012 Entree", eur("€ 120,00"), eur("€ 110,00")]);
  expect(cellsOf("Winst en verlies", "4514 Diversen")).toEqual(["4514 Diversen", eur("€ 25,00"), eur("€ 18,00")]);
  expect(cellsOf("Winst en verlies", "Totaal kosten")).toEqual(["Totaal kosten", eur("€ 225,00"), eur("€ 218,00")]);
  expect(cellsOf("Winst en verlies", "Resultaat")).toEqual(["Resultaat", eur("-€ 102,00"), eur("-€ 108,00")]);

  // On paper only the overview: the menus and the button stay off.
  expect(screen.getByRole("navigation", { name: "Beheer" })).toHaveClass("print:hidden");
  expect(screen.getByRole("navigation", { name: "Boekhouding" })).toHaveClass("print:hidden");
  const button = screen.getByRole("button", { name: "Afdrukken" });
  expect(button).toHaveClass("print:hidden");
  // Opened without ?print=1 it waits for the button.
  expect(print).not.toHaveBeenCalled();
  await user().click(button);
  expect(print).toHaveBeenCalledTimes(1);
});

it("prints an open year as Voorlopig, right away when the PDF button opened it", async () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  mockLoggedIn();
  mockApi({ [`${base}/year/2027/export`]: yearData({ status: "open", events: [] }) });
  renderAt(`${page}?print=1`);
  expect(await screen.findByRole("heading", { name: "Jaaroverzicht 2027" })).toBeInTheDocument();
  expect(await screen.findByText("Voorlopig")).toBeInTheDocument();
  expect(await screen.findByRole("region", { name: "Balans" })).toBeInTheDocument();
  await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
});

it("puts the notes on top of the Excel and the PDF", async () => {
  const notes = ["Boekingen tot en met 24-11-2027 komen uit elders; hun bijlagen staan daar.", "Tot 21-11-2027 staat het op twee rekeningen."];
  mockLoggedIn();
  mockApi({ [`${base}/year/2027/export`]: yearData({ notes }) });
  renderAt(page);
  const first = await screen.findByText(notes[0]!);
  const second = screen.getByText(notes[1]!);
  const title = screen.getByRole("heading", { name: "Jaaroverzicht 2027" });
  expect(title.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(second.compareDocumentPosition(screen.getByRole("region", { name: "Balans" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("says when the overview cannot be fetched", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/year/2027/export`]: [500, { error: "server" }] });
  renderAt(page);
  expect(await screen.findByRole("alert")).toHaveTextContent("Er ging iets mis. Probeer het opnieuw.");
});
