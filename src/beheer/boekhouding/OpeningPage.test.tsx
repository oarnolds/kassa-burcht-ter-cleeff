import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { LedgerAccount } from "../../../shared/ledger-types";
import { calls, mockApi, mockLoggedIn, renderAt } from "../../test-utils";

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
  account("0130", "Speeltoestellen", "asset"),
  account("1000", "Kas (kluisje)", "asset", { money: true }),
  account("1010", "ING betaalrekening", "asset", { money: true }),
  account("1030", "Mollie", "asset", { money: true }),
  account("1400", "Eigen vermogen", "equity"),
  account("1700", "Nog te betalen", "liability"),
  account("1800", "Verborgen schuld", "liability", { hidden: true }),
  account("4507", "Kantoorkosten", "expense"),
];

const read = {
  year: 2026,
  lines: [
    { accountCode: "0130", amountCents: 5395321 },
    { accountCode: "0135", amountCents: 3715282 },
    { accountCode: "1010", amountCents: 100000 },
    { accountCode: "1700", amountCents: 20050 },
  ],
  equityCents: 1759989,
  eBoekhoudenEquityCents: 1760000,
  expectedCashCents: 0,
  fromAssetList: true,
  mollieBalanceCents: 123456,
};

it("shows the opening of 2026 read only", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/accounts`]: accounts, [`${base}/opening`]: read });
  renderAt("/beheer/boekhouding/beginbalans");
  expect(await screen.findByRole("heading", { name: "Beginbalans 1 januari 2026" })).toBeInTheDocument();
  expect(await screen.findByText("ING betaalrekening")).toBeInTheDocument();
  expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: "Opslaan" })).not.toBeInTheDocument();
  expect(screen.getByText("€ 53.953,21")).toBeInTheDocument();
  expect(screen.getByText("€ 37.152,82")).toBeInTheDocument();
  expect(screen.getByText("€ 1.000,00")).toBeInTheDocument();
  expect(screen.getByText("€ 200,50")).toBeInTheDocument();
  expect(
    screen.getByText("Uit het auditbestand van e-Boekhouden; 0130 en 0135 uit de toestellenlijst. Opnieuw inlezen kan bij 2026 uit e-Boekhouden inlezen."),
  ).toBeInTheDocument();
  expect(screen.getByText("Eigen vermogen (uitgerekend)").parentElement).toHaveTextContent("€ 17.599,89");
  expect(screen.getByText("Eigen vermogen in e-Boekhouden (ter vergelijking)").parentElement).toHaveTextContent("€ 17.600,00");
  expect(screen.getByText("Verschil met e-Boekhouden").parentElement).toHaveTextContent("€ 0,11");
  expect(screen.getByText("1030 Mollie begint op nul: e-Boekhouden boekte een uitbetaling als omzet toen die op ING binnenkwam.")).toBeInTheDocument();
  expect(screen.queryByText(/Mollie gaf op/)).not.toBeInTheDocument();
  expect(calls("PUT")).toHaveLength(0);
});

it("says the opening is not read in yet", async () => {
  mockLoggedIn();
  mockApi({
    [`${base}/accounts`]: accounts,
    [`${base}/opening`]: { year: 2026, lines: [], equityCents: 0, eBoekhoudenEquityCents: null, expectedCashCents: 0, fromAssetList: false, mollieBalanceCents: null },
  });
  renderAt("/beheer/boekhouding/beginbalans");
  expect(await screen.findByText("Nog niet ingelezen")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "2026 uit e-Boekhouden inlezen" })).toHaveAttribute("href", "/beheer/boekhouding/eboekhouden-2026");
  expect(screen.queryByText("Eigen vermogen (uitgerekend)")).not.toBeInTheDocument();
});
