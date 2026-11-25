import { screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import type { LedgerAccount } from "../../../shared/ledger-types";
import { calls, mockApi, mockLoggedIn, renderAt, tap, user } from "../../test-utils";

const base = "/api/admin/boekhouding";
const account = (code: string, name: string, kind: LedgerAccount["kind"], formerly: string[] = [code]): LedgerAccount => ({
  code,
  name,
  kind,
  money: false,
  hidden: false,
  formerly,
});
const accounts = [
  account("1010", "ING betaalrekening", "asset"),
  account("4302", "Gebouw en inventaris", "expense", ["4302", "4303"]),
  account("4507", "Kantoorkosten", "expense"),
  account("8000", "Contributie particulier", "income", ["8000", "8001", "8002", "8003"]),
];

it("shows the old numbers next to the comparison figures", async () => {
  mockLoggedIn();
  mockApi({
    [`${base}/accounts`]: accounts,
    [`${base}/comparison`]: { year: 2025, figures: [{ accountCode: "4302", amountCents: 123456 }] },
    [`PUT ${base}/comparison`]: { year: 2025, figures: [] },
  });
  renderAt("/beheer/boekhouding/vergelijking");
  expect(await screen.findByRole("heading", { name: "Cijfers 2025" })).toBeInTheDocument();
  expect(await screen.findByText("was 4302 en 4303")).toBeInTheDocument();
  expect(screen.getByText("was 8000, 8001, 8002 en 8003")).toBeInTheDocument();
  expect(screen.queryByText(/was 4507/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("ING betaalrekening")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Gebouw en inventaris")).toHaveValue("1234,56");

  await user().type(screen.getByLabelText("Contributie particulier"), "50");
  await tap("Opslaan");
  await waitFor(() => {
    const put = calls("PUT").find((c) => c.url === `${base}/comparison?year=2025`);
    expect(put?.body).toEqual({
      figures: [
        { accountCode: "4302", amountCents: 123456 },
        { accountCode: "8000", amountCents: 5000 },
      ],
    });
  });
  expect(await screen.findByText("Opgeslagen.")).toBeInTheDocument();
});

it("refuses to save an amount that cannot be read", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/accounts`]: accounts, [`${base}/comparison`]: { year: 2025, figures: [] } });
  renderAt("/beheer/boekhouding/vergelijking");
  await user().type(await screen.findByLabelText("Kantoorkosten"), "12,3x");
  expect(screen.getByText("Dit bedrag kan ik niet lezen.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Opslaan" })).toBeDisabled();
  expect(calls("PUT")).toHaveLength(0);
});

it("shows no 'was' for an account without old numbers", async () => {
  mockLoggedIn();
  mockApi({
    [`${base}/accounts`]: [account("4600", "Nieuw", "expense", []), account("4507", "Kantoorkosten", "expense")],
    [`${base}/comparison`]: { year: 2025, figures: [] },
  });
  renderAt("/beheer/boekhouding/vergelijking");
  await screen.findByLabelText("Nieuw");
  expect(screen.queryByText(/^was/)).not.toBeInTheDocument();
});

it("takes the year from the address", async () => {
  mockLoggedIn();
  mockApi({
    [`${base}/accounts`]: accounts,
    [`${base}/comparison`]: { year: 2024, figures: [{ accountCode: "4302", amountCents: 483948 }] },
    [`PUT ${base}/comparison`]: { year: 2024, figures: [] },
  });
  renderAt("/beheer/boekhouding/vergelijking?jaar=2024");
  expect(await screen.findByRole("heading", { name: "Cijfers 2024" })).toBeInTheDocument();
  expect(screen.getByText("Wat e-Boekhouden over 2024 laat zien, per rekening. Laat leeg wat nul is.")).toBeInTheDocument();
  expect(await screen.findByLabelText("Gebouw en inventaris")).toHaveValue("4839,48");
  expect(calls("GET").some((c) => c.url === `${base}/comparison?year=2024`)).toBe(true);
  await tap("Opslaan");
  await waitFor(() => expect(calls("PUT").map((c) => c.url)).toEqual([`${base}/comparison?year=2024`]));
});

it("says from 2026 on the figures are in the books themselves", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/accounts`]: accounts, [`${base}/comparison`]: { year: 2026, figures: [] } });
  renderAt("/beheer/boekhouding/vergelijking?jaar=2026");
  expect(await screen.findByText("Vanaf 2026 staan de cijfers in de boekhouding zelf.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Opslaan" })).not.toBeInTheDocument();
});
