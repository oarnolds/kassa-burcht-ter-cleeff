import { configure, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { calls, mockApi, mockLoggedIn, renderAt } from "../../test-utils";
import { base, moneyAccount } from "./ledger-test-data";

const callback = `${base}/bank/ing/callback`;
const posts = () => calls("POST").filter((c) => c.url === callback);

beforeEach(() => {
  configure({ reactStrictMode: true });
  mockLoggedIn();
});
afterEach(() => configure({ reactStrictMode: false }));

it("finishes the connection once, also when the page is opened again", async () => {
  mockApi({ [`POST ${callback}`]: { status: "active", validUntil: "2027-06-01T12:00:00.000Z", daysLeft: 92 } });
  const first = renderAt("/beheer/bank?code=abc&state=xyz");
  expect(await screen.findByText("ING betaal is gekoppeld tot 01-06-2027.")).toBeInTheDocument();
  expect(posts()).toHaveLength(1);
  expect(posts()[0]!.body).toEqual({ code: "abc", state: "xyz" });
  expect(screen.getByRole("link", { name: "Naar Instellingen" })).toHaveAttribute("href", "/beheer/boekhouding/instellingen");
  first.unmount();

  // A refresh or the back button: the address has no code any more, so nothing is sent again.
  renderAt("/beheer/bank");
  expect(await screen.findByText("Deze koppeling is al afgerond of verlopen. Begin opnieuw bij Instellingen.")).toBeInTheDocument();
  expect(posts()).toHaveLength(1);
});

it("says so when the bank refuses the state", async () => {
  mockApi({ [`POST ${callback}`]: [409, { error: "state_invalid" }] });
  renderAt("/beheer/bank?code=abc&state=old");
  expect(await screen.findByText("Deze koppeling is al afgerond of verlopen. Begin opnieuw bij Instellingen.")).toBeInTheDocument();
  expect(posts()).toHaveLength(1);
});

it("names the account that is not in the consent", async () => {
  mockApi({
    [`POST ${callback}`]: [409, { error: "account_not_in_consent" }],
    [`${base}/money-accounts`]: [moneyAccount({ accountCode: "1010", name: "ING betaalrekening", identifier: "NL00INGB0000000001", source: "enable_banking" })],
  });
  renderAt("/beheer/bank?code=abc&state=xyz");
  expect(
    await screen.findByText("In deze toestemming zit ING betaal (NL00INGB0000000001) niet. Begin opnieuw bij Instellingen en kies de betaalrekening."),
  ).toBeInTheDocument();
});

it("sends nothing when the bank did not give consent", async () => {
  renderAt("/beheer/bank?error=access_denied&state=xyz");
  expect(await screen.findByText("ING gaf geen toestemming.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Naar Instellingen" })).toHaveAttribute("href", "/beheer/boekhouding/instellingen");
  await waitFor(() => expect(calls("POST")).toHaveLength(0));
});
