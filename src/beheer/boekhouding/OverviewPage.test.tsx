import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { mockApi, mockLoggedIn, renderAt } from "../../test-utils";
import { base, moneyAccount } from "./ledger-test-data";

const overview = (extra = {}) => ({
  openLines: 3,
  waitingLines: 0,
  moneyAccounts: [moneyAccount({ ledgerCents: 100000, bank: { date: "2027-03-30", balanceCents: 99000 }, differenceCents: 1000 }), moneyAccount({ accountCode: "1010", name: "ING betaalrekening", ledgerCents: 5000, bank: { date: "2027-03-30", balanceCents: 5000 }, differenceCents: 0 })],
  resultYearCents: 123456,
  cashDifferenceCents: 0,
  consent: null,
  mollieDifferenceCents: null,
  lastNightly: null,
  ...extra,
});

it("shows what to book, the balances next to the bank and the result so far", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: overview({ waitingLines: 2 }) });
  renderAt("/beheer/boekhouding");
  expect(await screen.findByRole("link", { name: "Te boeken: 3" })).toHaveAttribute("href", "/beheer/boekhouding/te-boeken");
  expect(screen.getByText("2 wachten op Mollie")).toBeInTheDocument();
  expect(screen.getByRole("listitem", { name: "ING kwartaalrekening" })).toHaveTextContent("verschil € 10,00");
  expect(screen.getByRole("listitem", { name: "ING kwartaalrekening" })).toHaveTextContent("30-03-2027");
  expect(screen.getByRole("listitem", { name: "ING betaalrekening" })).not.toHaveTextContent("verschil");
  expect(screen.getByText(/Resultaat \d{4} tot nu toe/).parentElement).toHaveTextContent("€ 1.234,56");
  expect(screen.queryByText(/Kas wijkt/)).not.toBeInTheDocument();
});

it("says when the cash box is off", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: overview({ cashDifferenceCents: -250 }) });
  renderAt("/beheer/boekhouding");
  expect(await screen.findByText("Kas wijkt € 2,50 af van wat er volgens de kassa in het kluisje hoort")).toBeInTheDocument();
});
