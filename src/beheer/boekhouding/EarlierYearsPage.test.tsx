import { screen, waitFor, within } from "@testing-library/react";
import { zipSync } from "fflate";
import { expect, it, vi } from "vitest";
import { ACCOUNTS } from "../../../shared/accounts";
import { wvParts, type WvOptions } from "../../../shared/fixtures/eboekhouden-wv";
import type { ComparisonYear, LedgerAccount } from "../../../shared/ledger-types";
import { calls, mockApi, mockLoggedIn, renderAt, rowIn, tap, user } from "../../test-utils";
import { base } from "./ledger-test-data";

const page = "/beheer/boekhouding/eerdere-jaren";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The real chart, with 4510 Reclame hidden. */
const accounts: LedgerAccount[] = ACCOUNTS.map((account) => (account.code === "4510" ? { ...account, hidden: true } : account));

const xlsx = (options?: WvOptions) => new File([zipSync(wvParts(options))], "Winst en verlies 2025.xlsx", { type: XLSX });

function open(years: ComparisonYear[] = []) {
  mockLoggedIn();
  mockApi({
    [`${base}/accounts`]: accounts,
    [`${base}/comparison/years`]: years,
    [`PUT ${base}/comparison`]: (request: { body: { figures: unknown[] } }) => ({ year: 2025, figures: request.body.figures }),
  });
  renderAt(page);
}

/** Chooses a file and waits until it is read (the input is off meanwhile). */
async function choose(file: File) {
  const input = await screen.findByLabelText("W&V uit e-Boekhouden inlezen");
  await user().upload(input, file);
  await waitFor(() => expect(input).toBeEnabled());
}

it("lists the years already read, with a way to see or change them", async () => {
  open([
    { year: 2024, incomeCents: 1200000, costsCents: 1000000, resultCents: 200000 },
    { year: 2025, incomeCents: 1337704, costsCents: 695988, resultCents: 641716 },
  ]);
  expect(await screen.findByRole("heading", { name: "Eerdere jaren" })).toBeInTheDocument();
  await screen.findByText("€ 12.000,00");
  const y2024 = rowIn("Ingelezen jaren", "2024");
  expect(y2024.getByText("€ 12.000,00")).toBeInTheDocument();
  expect(y2024.getByText("€ 10.000,00")).toBeInTheDocument();
  expect(y2024.getByText("€ 2.000,00")).toBeInTheDocument();
  expect(y2024.getByRole("link", { name: "Bekijken of wijzigen" })).toHaveAttribute("href", "/beheer/boekhouding/vergelijking?jaar=2024");
  expect(rowIn("Ingelezen jaren", "2025").getByRole("link", { name: "Bekijken of wijzigen" })).toHaveAttribute("href", "/beheer/boekhouding/vergelijking?jaar=2025");
  expect(screen.getByLabelText("W&V uit e-Boekhouden inlezen")).toHaveAttribute("accept", ".xlsx");
});

it("says when no year was read yet", async () => {
  open();
  expect(await screen.findByText("Er is nog geen jaar ingelezen.")).toBeInTheDocument();
});

it("reads a file, places what it can, lets an unplaced row go to an account, and takes the year over", async () => {
  open();
  await choose(xlsx());
  const read = await screen.findByRole("region", { name: "Winst en verlies 2025" });
  const wv = "Winst en verlies 2025";
  expect(rowIn(wv, "Gebouw en inventaris").getByText("Gebouw en inventaris")).toBeInTheDocument();
  expect(rowIn(wv, "Gebouw en inventaris").getByText("was 4302 en 4303")).toBeInTheDocument();
  expect(rowIn(wv, "Gebouw en inventaris").getByText("€ 4.839,48")).toBeInTheDocument();
  expect(rowIn(wv, "Verzekeringen").getByText("€ 845,25")).toBeInTheDocument();
  expect(rowIn(wv, "Bestuurskosten").getByText("€ 75,15")).toBeInTheDocument();
  expect(rowIn(wv, "Contributie particulier").getByText("€ 3.750,50")).toBeInTheDocument();
  expect(rowIn(wv, "Donaties").getByText("-€ 250,00")).toBeInTheDocument();
  expect(rowIn(wv, "Totaal opbrengsten").getByText("€ 13.377,04")).toBeInTheDocument();
  expect(rowIn(wv, "Totaal kosten").getByText("€ 6.959,88")).toBeInTheDocument();
  expect(rowIn(wv, "Resultaat").getByText("€ 6.417,16")).toBeInTheDocument();
  expect(within(read).getByText("Volgens e-Boekhouden: Saldo winst € 6.457,16")).toBeInTheDocument();
  expect(within(read).queryByText(/4311/)).not.toBeInTheDocument();

  const unplaced = within(screen.getByRole("region", { name: "Niet geplaatst" }));
  const row4311 = unplaced.getByRole("listitem", { name: "4311 Overige huisvestingskosten" });
  expect(row4311).toHaveTextContent("Verlies € 60,00");
  const row9999 = unplaced.getByRole("listitem", { name: "9999 Eindresultaat" });
  expect(row9999).toHaveTextContent("Winst € 100,00");
  const select4311 = unplaced.getByLabelText("Rekening voor 4311 Overige huisvestingskosten");
  expect(select4311).toHaveDisplayValue("Niet meenemen");
  expect(unplaced.getByLabelText("Rekening voor 9999 Eindresultaat")).toHaveDisplayValue("Niet meenemen");
  // Only the visible income and expense accounts.
  const offered = within(select4311).getAllByRole("option").map((option) => option.textContent);
  expect(offered).toContain("4514 Diversen");
  expect(offered).toContain("8040 Overige opbrengsten");
  expect(offered).not.toContain("4510 Reclame");
  expect(offered).not.toContain("1010 ING betaalrekening");

  await user().selectOptions(select4311, "4514");
  expect(rowIn(wv, "Diversen").getByText("€ 60,00")).toBeInTheDocument();
  expect(rowIn(wv, "Totaal kosten").getByText("€ 7.019,88")).toBeInTheDocument();
  expect(rowIn(wv, "Resultaat").getByText("€ 6.357,16")).toBeInTheDocument();
  // 9999 on an income account would raise the result; back to "Niet meenemen" it is gone again.
  await user().selectOptions(unplaced.getByLabelText("Rekening voor 9999 Eindresultaat"), "8040");
  expect(rowIn(wv, "Totaal opbrengsten").getByText("€ 13.477,04")).toBeInTheDocument();
  await user().selectOptions(unplaced.getByLabelText("Rekening voor 9999 Eindresultaat"), "Niet meenemen");
  expect(rowIn(wv, "Totaal opbrengsten").getByText("€ 13.377,04")).toBeInTheDocument();

  const confirm = vi.spyOn(window, "confirm");
  await tap("Overnemen");
  await waitFor(() => expect(calls("PUT")).toHaveLength(1));
  expect(confirm).not.toHaveBeenCalled();
  confirm.mockRestore();
  expect(calls("PUT")[0]).toMatchObject({
    url: `${base}/comparison?year=2025`,
    body: {
      figures: [
        { accountCode: "4301", amountCents: 120000 },
        { accountCode: "4302", amountCents: 483948 },
        { accountCode: "4502", amountCents: 7515 },
        { accountCode: "4508", amountCents: 84525 },
        { accountCode: "4514", amountCents: 6000 },
        { accountCode: "8000", amountCents: 375050 },
        { accountCode: "8012", amountCents: 987654 },
        { accountCode: "8025", amountCents: -25000 },
      ],
    },
  });
  expect(await screen.findByText("Overgenomen.")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Winst en verlies 2025" })).not.toBeInTheDocument();
  expect(calls("GET").filter((call) => call.url === `${base}/comparison/years`)).toHaveLength(2);
});

it("says a year that is already there will be replaced, and asks once before it is", async () => {
  open([{ year: 2025, incomeCents: 1, costsCents: 0, resultCents: 1 }]);
  await screen.findByRole("link", { name: "Bekijken of wijzigen" });
  await choose(xlsx());
  expect(await screen.findByText("2025 staat er al; overnemen vervangt die cijfers.")).toBeInTheDocument();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await tap("Overnemen");
  expect(confirm).toHaveBeenCalledWith("2025 staat er al; overnemen vervangt die cijfers.");
  expect(calls("PUT")).toHaveLength(0);
  confirm.mockReturnValue(true);
  await tap("Overnemen");
  await waitFor(() => expect(calls("PUT")).toHaveLength(1));
  confirm.mockRestore();
});

it("refuses a year from 2027 on", async () => {
  open();
  await choose(xlsx({ title: "Winst & verlies 01-01-2027 t/m 31-12-2027 (12)" }));
  expect(await screen.findByText("Vanaf 2027 staan de cijfers in de boekhouding zelf.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Overnemen" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Niet geplaatst" })).not.toBeInTheDocument();
});

it("says so when the file is not a winst-en-verliesrekening of a whole year", async () => {
  open();
  await choose(xlsx({ title: "Balans per 31-12-2025", header: ["Code", "Omschrijving", "Debet", "Credit"] }));
  expect(await screen.findByText("Dit is geen winst-en-verliesrekening uit e-Boekhouden.")).toBeInTheDocument();
  await choose(new File(["geen zip"], "iets.xlsx", { type: XLSX }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Dit is geen winst-en-verliesrekening uit e-Boekhouden.");
  await choose(xlsx({ title: "Winst & verlies 01-01-2025 t/m 30-06-2025 (38)" }));
  expect(await screen.findByText("Lees de winst-en-verliesrekening van een heel jaar in (1 januari tot en met 31 december).")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Overnemen" })).not.toBeInTheDocument();
});
