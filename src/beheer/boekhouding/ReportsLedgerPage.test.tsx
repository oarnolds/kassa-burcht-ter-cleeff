import { screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { calls, mockApi, mockLoggedIn, renderAt, tap, user } from "../../test-utils";
import { base } from "./ledger-test-data";

const result = {
  from: "2027-01-01",
  to: "2027-03-31",
  rows: [
    { code: "4501", name: "Inkoop kiosk", kind: "expense", cents: 41280, previousCents: 30000 },
    { code: "8020", name: "Subsidie gemeente", kind: "income", cents: 609147, previousCents: null },
  ],
  resultCents: 567867,
  previousResultCents: null,
};

it("opens an account's lines from the result", async () => {
  mockLoggedIn();
  mockApi({
    [`${base}/reports/result`]: result,
    [`${base}/reports/balance`]: { date: "2027-03-31", rows: [], assetsCents: 0, liabilitiesAndEquityCents: 0, resultCents: 0 },
    [`${base}/reports/account/4501`]: {
      code: "4501",
      openingCents: 0,
      lines: [{ entryId: "e1", number: 7, date: "2027-01-04", description: "Factuur Goodoo", amountCents: 41280, runningCents: 41280 }],
    },
  });
  renderAt("/beheer/boekhouding/rapporten");
  await tap("Winst en verlies");
  await user().click(await screen.findByRole("button", { name: /4501 Inkoop kiosk/ }));
  const line = await screen.findByRole("link", { name: /Factuur Goodoo/ });
  expect(line).toHaveAttribute("href", "/beheer/boekhouding/boekingen/e1");
  await waitFor(() => expect(calls("GET").some((c) => c.url.startsWith(`${base}/reports/account/4501?from=`))).toBe(true));
  expect(calls("GET").find((c) => c.url.startsWith(`${base}/reports/account/4501`))!.url).toMatch(/from=\d{4}-01-01&to=\d{4}-\d{2}-\d{2}/);
});

it("shows the year before next to the result, with empty cells where there is none", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/reports/result`]: result });
  renderAt("/beheer/boekhouding/rapporten");
  await tap("Winst en verlies");
  expect(await screen.findByRole("columnheader", { name: String(new Date().getFullYear() - 1) })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /4501 Inkoop kiosk/ }).closest("tr")).toHaveTextContent("€ 300,00");
  expect(screen.getByRole("button", { name: /8020 Subsidie gemeente/ }).closest("tr")).not.toHaveTextContent("€ 0,00");
});

it("shows the balance on a date", async () => {
  mockLoggedIn();
  mockApi({
    [`${base}/reports/balance`]: {
      date: "2027-03-31",
      rows: [
        { code: "1010", name: "ING betaalrekening", kind: "asset", cents: 250000 },
        { code: "1700", name: "Nog te betalen", kind: "liability", cents: 50000 },
      ],
      assetsCents: 250000,
      liabilitiesAndEquityCents: 50000,
      resultCents: 200000,
    },
  });
  renderAt("/beheer/boekhouding/rapporten");
  expect(await screen.findByRole("button", { name: /1010 ING betaalrekening/ })).toBeInTheDocument();
  expect(screen.getByText("Resultaat nog niet geboekt")).toBeInTheDocument();
});
