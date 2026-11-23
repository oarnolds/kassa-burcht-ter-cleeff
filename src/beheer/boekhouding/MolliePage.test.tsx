import { screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { MollieMonth } from "../../../shared/ledger-types";
import { calls, mockApi, mockLoggedIn, renderAt, rowIn, tap } from "../../test-utils";
import { accounts, base } from "./ledger-test-data";

const month = (extra: Partial<MollieMonth> = {}): MollieMonth => ({
  month: "2027-03",
  kassaPinCents: 420,
  molliePosCents: 870,
  onlyInKassa: [{ saleId: "s1", date: "2027-03-21", amountCents: 300 }],
  onlyAtMollie: [{ paymentId: "tr_extra", date: "2027-03-23", amountCents: 500 }],
  otherByAccount: [
    { accountCode: "8000", cents: 3200 },
    { accountCode: "8012", cents: 320 },
  ],
  costsCents: 238,
  balance: { ledgerCents: 3520, mollieCents: 3320, inTransitCents: 0, differenceCents: 200 },
  ...extra,
});

const named = [...accounts, { code: "8000", name: "Contributie particulier", kind: "income" as const, money: false, hidden: false, formerly: ["8000"] }];

it("shows the month's pin, the differences and the balance", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-04-10T10:00:00.000Z") });
  try {
    mockLoggedIn();
    mockApi({
      [`${base}/accounts`]: named,
      [`${base}/mollie/month`]: (req: { url: string }) => {
        const asked = new URL(req.url, "http://localhost").searchParams.get("month");
        return asked === "2027-03"
          ? month()
          : month({ month: asked!, kassaPinCents: 0, molliePosCents: 0, onlyInKassa: [], onlyAtMollie: [], otherByAccount: [], costsCents: 0, balance: { ledgerCents: 0, mollieCents: null, inTransitCents: 0, differenceCents: null } });
      },
    });
    renderAt("/beheer/boekhouding/mollie");

    // The current month first, with nothing to compare yet; the next month cannot be chosen.
    expect(await screen.findByRole("heading", { name: "april 2027" })).toBeInTheDocument();
    expect(calls("GET").some((call) => call.url === `${base}/mollie/month?month=2027-04`)).toBe(true);
    expect(screen.getByRole("button", { name: "Volgende maand" })).toBeDisabled();
    expect(await screen.findByText("Saldo bij Mollie nog niet bekend, in de boekhouding € 0,00")).toBeInTheDocument();

    await tap("Vorige maand");
    expect(await screen.findByRole("heading", { name: "maart 2027" })).toBeInTheDocument();
    expect(await screen.findByText("Saldo bij Mollie € 33,20, in de boekhouding € 35,20")).toBeInTheDocument();
    expect(rowIn("Pin", "Pin in de kassa").getByText("€ 4,20")).toBeInTheDocument();
    expect(rowIn("Pin", "Pin bij Mollie").getByText("€ 8,70")).toBeInTheDocument();
    expect(rowIn("Alleen in de kassa", "21-03-2027").getByText("€ 3,00")).toBeInTheDocument();
    expect(rowIn("Alleen bij Mollie", "23-03-2027").getByText("€ 5,00")).toBeInTheDocument();
    expect(rowIn("Overige betalingen", "8000 Contributie particulier").getByText("€ 32,00")).toBeInTheDocument();
    // An account whose name is not known is shown by its number.
    expect(rowIn("Overige betalingen", "8012").getByText("€ 3,20")).toBeInTheDocument();
    expect(rowIn("Kosten", "Kosten Mollie").getByText("€ 2,38")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Saldo" })).getByText("verschil € 2,00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volgende maand" })).toBeEnabled();
  } finally {
    vi.useRealTimers();
  }
});

it("says so when there are no differences", async () => {
  mockLoggedIn();
  mockApi({
    [`${base}/accounts`]: named,
    [`${base}/mollie/month`]: month({ onlyInKassa: [], onlyAtMollie: [], otherByAccount: [], balance: { ledgerCents: 3320, mollieCents: 3320, inTransitCents: 0, differenceCents: 0 } }),
  });
  renderAt("/beheer/boekhouding/mollie?maand=2027-03");
  expect(await screen.findByText("Saldo bij Mollie € 33,20, in de boekhouding € 33,20")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Alleen in de kassa" })).getByText("Geen.")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Alleen bij Mollie" })).getByText("Geen.")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Overige betalingen" })).getByText("Geen.")).toBeInTheDocument();
  expect(screen.queryByText(/verschil/)).not.toBeInTheDocument();
});

it("shows a payout on its way to ING as onderweg, and only the rest as a difference", async () => {
  mockLoggedIn();
  mockApi({
    [`${base}/accounts`]: named,
    [`${base}/mollie/month`]: month({ balance: { ledgerCents: 13320, mollieCents: 3320, inTransitCents: 10000, differenceCents: 0 } }),
  });
  const first = renderAt("/beheer/boekhouding/mollie?maand=2027-03");
  const saldo = () => within(screen.getByRole("region", { name: "Saldo" }));
  expect(await screen.findByText("Saldo bij Mollie € 33,20, in de boekhouding € 133,20")).toBeInTheDocument();
  expect(saldo().getByText("Onderweg naar ING € 100,00")).toBeInTheDocument();
  expect(saldo().queryByText(/verschil/)).not.toBeInTheDocument();
  first.unmount();

  mockApi({ [`${base}/mollie/month`]: month({ balance: { ledgerCents: 13320, mollieCents: 3070, inTransitCents: 10000, differenceCents: 250 } }) });
  renderAt("/beheer/boekhouding/mollie?maand=2027-03");
  expect(await screen.findByText("Onderweg naar ING € 100,00")).toBeInTheDocument();
  expect(saldo().getByText("verschil € 2,50")).toBeInTheDocument();
});
