import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { calls, mockApi, mockLoggedIn, renderAt } from "../../test-utils";
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

const report = (at: string, steps: Record<string, string>) => ({ at, steps });
const sync = `${base}/sync`;

it("tells when the last run was and which steps failed", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-03-07T07:00:00.000Z") });
  try {
    mockLoggedIn();
    mockApi({ [`${base}/overview`]: overview({ lastNightly: report("2027-03-07T01:00:00.000Z", { kassa: "ok", ing: "skipped", mollie: "error" }) }) });
    renderAt("/beheer/boekhouding");
    expect(await screen.findByText("Vannacht bijgewerkt om 02:00 (Mollie niet gelukt)")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("names the day when the last run was not last night", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: overview({ lastNightly: report("2027-03-05T14:30:00.000Z", { kassa: "unbalanced", ing: "no_access", mollie: "skipped" }) }) });
  renderAt("/beheer/boekhouding");
  expect(await screen.findByText("Bijgewerkt op 5-3-2027 om 15:30 (kassa niet gelukt) (ING niet gelukt)")).toBeInTheDocument();
});

it("brings the books up to date on a click and shows how it went", async () => {
  mockLoggedIn();
  let ran = false;
  mockApi({
    [`${base}/overview`]: () => overview({ lastNightly: ran ? report("2027-03-05T14:30:00.000Z", { kassa: "ok", ing: "skipped", mollie: "skipped" }) : null }),
    [`POST ${sync}`]: () => {
      ran = true;
      return report("2027-03-05T14:30:00.000Z", { kassa: "ok", ing: "skipped", mollie: "skipped" });
    },
  });
  renderAt("/beheer/boekhouding");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Nu bijwerken" }));
  expect(await screen.findByText("Bijgewerkt op 5-3-2027 om 15:30")).toBeInTheDocument();
  expect(calls("POST")).toHaveLength(1);
  expect(calls("GET").filter((call) => call.url === `${base}/overview`)).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Nu bijwerken" })).toBeEnabled();
});
