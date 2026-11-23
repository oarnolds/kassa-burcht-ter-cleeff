import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { mockApi, mockLoggedIn, renderAt } from "../test-utils";
import { base, moneyAccount } from "./boekhouding/ledger-test-data";

const summary = {
  today: { date: "2027-03-01", cashCents: 0, pinCents: 0, totalCents: 0, saleCount: 0 },
  month: { month: "2027-03", cashCents: 0, pinCents: 0, totalCents: 0, saleCount: 0 },
  cashExpectedCents: 0,
  reorderCount: 0,
  openOrderCount: 0,
  pinAttention: [],
};
const overview = (extra = {}) => ({
  openLines: 0,
  waitingLines: 0,
  moneyAccounts: [moneyAccount({ differenceCents: 0 })],
  resultYearCents: 0,
  cashDifferenceCents: 0,
  consent: null,
  mollieDifferenceCents: null,
  lastNightly: null,
  ...extra,
});
const open = (answer: unknown) => {
  mockLoggedIn();
  mockApi({ "/api/admin/summary": summary, [`${base}/overview`]: answer });
  renderAt("/beheer");
};

it("points to the boekhouding when lines wait to be booked", async () => {
  open(overview({ openLines: 3, waitingLines: 2 }));
  const link = await screen.findByRole("link", { name: "Boekhouding: 5 te boeken" });
  expect(link).toHaveAttribute("href", "/beheer/boekhouding");
});

it("points to the first account whose balance is off", async () => {
  open(overview({ moneyAccounts: [moneyAccount({ differenceCents: 0 }), moneyAccount({ accountCode: "1010", name: "ING betaalrekening", differenceCents: -500 })] }));
  expect(await screen.findByRole("link", { name: "Saldo wijkt af bij ING betaalrekening" })).toHaveAttribute("href", "/beheer/boekhouding");
});

it("says nothing when there is nothing, or when the boekhouding cannot be read", async () => {
  open(overview());
  expect(await screen.findByText("In het kluisje hoort")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /^Boekhouding: |^Saldo wijkt/ })).not.toBeInTheDocument();
});

it("keeps the dashboard working when the overview fails", async () => {
  open([500, { error: "server" }]);
  expect(await screen.findByText("In het kluisje hoort")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /^Boekhouding: |^Saldo wijkt/ })).not.toBeInTheDocument();
});

it("warns on the dashboard when the consent of ING nears its end or has ended", async () => {
  const ing = (daysLeft: number) => overview({ moneyAccounts: [moneyAccount({ accountCode: "1010", name: "ING betaalrekening", source: "enable_banking" })], consent: { validUntil: "2027-06-01T12:00:00.000Z", daysLeft } });
  open(ing(10));
  const link = await screen.findByRole("link", { name: "Vernieuwen" });
  expect(link).toHaveAttribute("href", "/beheer/boekhouding/instellingen");
  expect(link.parentElement).toHaveTextContent("De toestemming van ING verloopt over 10 dagen. Vernieuwen");
});

it("warns on the dashboard after the end, but not for a bank that works from files", async () => {
  mockLoggedIn();
  const gone = { consent: { validUntil: "2027-06-01T12:00:00.000Z", daysLeft: -1 } };
  mockApi({ "/api/admin/summary": summary, [`${base}/overview`]: overview({ ...gone, moneyAccounts: [moneyAccount({ accountCode: "1010", source: "file" })] }) });
  renderAt("/beheer");
  await screen.findByText("In het kluisje hoort");
  expect(screen.queryByRole("link", { name: "Vernieuwen" })).not.toBeInTheDocument();
});
