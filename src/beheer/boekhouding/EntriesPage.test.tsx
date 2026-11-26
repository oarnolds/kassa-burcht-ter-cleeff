import { screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { calls, mockApi, mockLoggedIn, renderAt, tap, user } from "../../test-utils";
import { accounts, base, entry } from "./ledger-test-data";

it("lists the entries of a year with their amount and a mark when changed", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-12-01T10:00:00.000Z") });
  mockLoggedIn();
  mockApi({
    [`${base}/accounts`]: accounts,
    [`${base}/entries`]: [entry(), entry({ id: "e2", number: 8, description: "Gecorrigeerd", changed: true })],
  });
  renderAt("/beheer/boekhouding/boekingen");
  const first = within(await screen.findByRole("link", { name: /Factuur Goodoo/ }));
  expect(first.getByText("7")).toBeInTheDocument();
  expect(first.getByText("04-01-2027")).toBeInTheDocument();
  expect(first.getByText("€ 412,80")).toBeInTheDocument();
  expect(within(screen.getByRole("link", { name: /Gecorrigeerd/ })).getByText("gewijzigd")).toBeInTheDocument();
  expect(calls("GET").some((c) => c.url.startsWith(`${base}/entries?year=2026`))).toBe(true);
});

it("shows the newest entry at the top", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-12-01T10:00:00.000Z") });
  mockLoggedIn();
  mockApi({
    [`${base}/accounts`]: accounts,
    // As the Worker sends them: by date and number, oldest first.
    [`${base}/entries`]: [
      entry({ id: "e1", number: 1, date: "2026-01-01", description: "Beginbalans" }),
      entry({ id: "e2", number: 2, date: "2026-03-05", description: "Huur maart" }),
      entry({ id: "e3", number: 3, date: "2026-03-05", description: "Huur april" }),
      entry({ id: "e4", number: 4, date: "2026-11-26", description: "ING-kosten" }),
    ],
  });
  renderAt("/beheer/boekhouding/boekingen");
  const list = within(await screen.findByRole("region", { name: "Boekingen 2026" }));
  await list.findByRole("link", { name: /ING-kosten/ });
  const order = ["ING-kosten", "Huur april", "Huur maart", "Beginbalans"];
  expect(list.getAllByRole("link").map((link) => order.find((name) => link.textContent?.includes(name)))).toEqual(order);
});

it("searches with the filters", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/accounts`]: accounts, [`${base}/entries`]: [] });
  renderAt("/beheer/boekhouding/boekingen");
  await user().type(await screen.findByLabelText("Tekst"), "bon");
  await user().type(screen.getByLabelText("Bedrag"), "12,50");
  await user().selectOptions(screen.getByLabelText("Rekening"), "4501");
  await waitFor(() => {
    const last = calls("GET").filter((c) => c.url.startsWith(`${base}/entries`)).at(-1)!;
    expect(last.url).toContain("text=bon");
    expect(last.url).toContain("amount=1250");
    expect(last.url).toContain("account=4501");
  });
});

it("keeps Opslaan off until debit and credit are equal", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/accounts`]: accounts, [`${base}/entries`]: [], [`POST ${base}/entries`]: [201, entry({ id: "nieuw" })] });
  renderAt("/beheer/boekhouding/boekingen");
  await tap("Nieuwe boeking");
  await user().type(screen.getByLabelText("Omschrijving"), "Nog te betalen");
  await user().selectOptions(screen.getByLabelText("Rekening regel 1"), "4501");
  await user().type(screen.getByLabelText("Debet regel 1"), "100");
  await user().selectOptions(screen.getByLabelText("Rekening regel 2"), "1010");
  await user().type(screen.getByLabelText("Credit regel 2"), "90");
  expect(screen.getByText("Debet en credit zijn niet gelijk: verschil € 10,00")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Opslaan" })).toBeDisabled();
  await user().clear(screen.getByLabelText("Credit regel 2"));
  await user().type(screen.getByLabelText("Credit regel 2"), "100");
  expect(screen.queryByText(/niet gelijk/)).not.toBeInTheDocument();
  await tap("Opslaan");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]!.body).toMatchObject({
    description: "Nog te betalen",
    lines: [
      { accountCode: "4501", amountCents: 10000, note: null },
      { accountCode: "1010", amountCents: -10000, note: null },
    ],
  });
});

it("chooses the year from a list, so it works without typing", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-06-01T10:00:00.000Z") });
  mockLoggedIn();
  mockApi({ [`${base}/accounts`]: accounts, [`${base}/entries`]: [] });
  renderAt("/beheer/boekhouding/boekingen");
  const year = await screen.findByRole("combobox", { name: "Jaar" });
  expect(year).toHaveValue("2027");
  expect(within(year).getAllByRole("option").map((option) => option.textContent)).toEqual(["2026", "2027", "2028"]);
  await user().selectOptions(year, "2028");
  await waitFor(() => expect(calls("GET").some((c) => c.url.startsWith(`${base}/entries?year=2028`))).toBe(true));
});
