import { screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import type { LedgerAccount } from "../../../shared/ledger-types";
import { calls, mockApi, mockLoggedIn, renderAt, tap, user } from "../../test-utils";

const base = "/api/admin/boekhouding";
const account = (code: string, name: string, kind: LedgerAccount["kind"], extra: Partial<LedgerAccount> = {}): LedgerAccount => ({
  code,
  name,
  kind,
  money: false,
  hidden: false,
  formerly: [code],
  ...extra,
});
const accounts: LedgerAccount[] = [
  account("0135", "Afschrijving", "asset"),
  account("1000", "Kas (kluisje)", "asset", { money: true }),
  account("1010", "ING betaalrekening", "asset", { money: true }),
  account("1400", "Eigen vermogen", "equity"),
  account("1700", "Nog te betalen", "liability"),
  account("1800", "Verborgen schuld", "liability", { hidden: true }),
  account("4507", "Kantoorkosten", "expense"),
];

it("works out equity while typing the opening balance", async () => {
  mockLoggedIn();
  mockApi({
    [`${base}/accounts`]: accounts,
    [`${base}/opening`]: { year: 2027, lines: [], equityCents: 0, eBoekhoudenEquityCents: null, expectedCashCents: 12345 },
    [`PUT ${base}/opening`]: { year: 2027, lines: [], equityCents: 0, eBoekhoudenEquityCents: null, expectedCashCents: 12345 },
  });
  renderAt("/beheer/boekhouding/beginbalans");
  expect(await screen.findByRole("heading", { name: "Beginbalans 1 januari 2027" })).toBeInTheDocument();
  expect(await screen.findByLabelText("ING betaalrekening")).toBeInTheDocument();
  expect(screen.queryByLabelText("Eigen vermogen")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Verborgen schuld")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Kantoorkosten")).not.toBeInTheDocument();
  expect(screen.getByText("Volgens de kassa hoort er op 31 december € 123,45 in het kluisje.")).toBeInTheDocument();

  await user().type(screen.getByLabelText("ING betaalrekening"), "1000");
  await user().type(screen.getByLabelText("Nog te betalen"), "200,50");
  await user().type(screen.getByLabelText("Afschrijving"), "100");
  expect(screen.getByText("Eigen vermogen (uitgerekend)").parentElement).toHaveTextContent("€ 699,50");

  await user().type(screen.getByLabelText("Eigen vermogen in e-Boekhouden (ter vergelijking)"), "700");
  expect(screen.getByText(/Verschil/).parentElement).toHaveTextContent("€ 0,50");

  await tap("Opslaan");
  await waitFor(() => {
    const put = calls("PUT").find((c) => c.url === `${base}/opening?year=2027`);
    expect(put?.body).toEqual({
      lines: [
        { accountCode: "0135", amountCents: 10000 },
        { accountCode: "1010", amountCents: 100000 },
        { accountCode: "1700", amountCents: 20050 },
      ],
      eBoekhoudenEquityCents: 70000,
    });
  });
  expect(await screen.findByText("Opgeslagen.")).toBeInTheDocument();
});

it("fills in what was saved before", async () => {
  mockLoggedIn();
  mockApi({
    [`${base}/accounts`]: accounts,
    [`${base}/opening`]: {
      year: 2027,
      lines: [{ accountCode: "1010", amountCents: 250000 }],
      equityCents: 250000,
      eBoekhoudenEquityCents: 250000,
      expectedCashCents: 0,
    },
  });
  renderAt("/beheer/boekhouding/beginbalans");
  expect(await screen.findByLabelText("ING betaalrekening")).toHaveValue("2500,00");
  expect(screen.getByText("Eigen vermogen (uitgerekend)").parentElement).toHaveTextContent("€ 2.500,00");
});
