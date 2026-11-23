import { screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { LedgerAccount, MoneyAccount } from "../../../shared/ledger-types";
import { leavePage } from "../../lib/leave";
import { calls, mockApi, mockLoggedIn, renderAt, tap, user } from "../../test-utils";

vi.mock("../../lib/leave", () => ({ leavePage: vi.fn() }));

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
  account("1010", "ING betaalrekening", "asset", { money: true }),
  account("4507", "Kantoorkosten", "expense"),
  account("8011", "Verkoop kassa", "income"),
  account("8012", "Entree", "income"),
];
const money = (code: string, name: string, source: MoneyAccount["source"], identifier: string | null = null): MoneyAccount => ({
  accountCode: code,
  name,
  identifier,
  source,
  ledgerCents: 0,
  bank: null,
  differenceCents: null,
});
const moneyAccounts = [
  money("1000", "Kas (kluisje)", "kassa"),
  money("1010", "ING betaalrekening", "enable_banking", "NL00INGB0000000001"),
  money("1030", "Mollie", "mollie"),
];
const open = async (extra: Record<string, unknown> = {}) => {
  mockLoggedIn();
  mockApi({
    [`${base}/accounts`]: accounts,
    [`${base}/money-accounts`]: moneyAccounts,
    [`${base}/bank/ing`]: { status: "none", validUntil: null, daysLeft: null },
    [`${base}/category-accounts`]: [
      { categoryId: "ijs", categoryName: "IJs", accountCode: "8011" },
      { categoryId: "entree", categoryName: "Entree", accountCode: "8011" },
    ],
    ...extra,
  });
  renderAt("/beheer/boekhouding/instellingen");
  await screen.findByRole("heading", { name: "Rekeningen" });
  await screen.findByText("Kantoorkosten");
  await waitFor(() => expect(screen.queryByText("Laden…")).not.toBeInTheDocument());
};

it("hides and renames an account, and adds one", async () => {
  await open({
    [`PATCH ${base}/accounts/4507`]: (req: { body: any }) => ({ ...accounts[1], ...req.body }),
    [`POST ${base}/accounts`]: [201, account("4600", "Nieuw", "expense")],
  });
  const region = screen.getByRole("region", { name: "Rekeningen" });
  const row = within(within(region).getByText("Kantoorkosten").closest("li")!);
  await user().click(row.getByRole("button", { name: "Verbergen" }));
  await waitFor(() => expect(calls("PATCH").find((c) => c.url === `${base}/accounts/4507`)?.body).toEqual({ hidden: true }));

  await user().click(row.getByRole("button", { name: "Naam wijzigen" }));
  const name = within(region).getByLabelText("Nieuwe naam");
  await user().clear(name);
  await user().type(name, "Kantoor");
  await user().click(within(region).getByRole("button", { name: "Bewaren" }));
  await waitFor(() => expect(calls("PATCH").some((c) => (c.body as any)?.name === "Kantoor")).toBe(true));

  await user().type(within(region).getByLabelText("Nummer"), "4600");
  await user().type(within(region).getByLabelText("Naam"), "Nieuw");
  await user().selectOptions(within(region).getByLabelText("Soort"), "expense");
  await user().click(within(region).getByRole("button", { name: "Rekening toevoegen" }));
  await waitFor(() => expect(calls("POST").find((c) => c.url === `${base}/accounts`)?.body).toEqual({ code: "4600", name: "Nieuw", kind: "expense" }));
});

it("says that a money account cannot be hidden", async () => {
  await open();
  const region = screen.getByRole("region", { name: "Rekeningen" });
  const row = within(within(region).getByText("ING betaalrekening").closest("li")!);
  expect(row.getByText("Een geldrekening kan niet worden verborgen.")).toBeInTheDocument();
  expect(row.queryByRole("button", { name: "Verbergen" })).not.toBeInTheDocument();
});

it("switches a money account between Enable Banking and files", async () => {
  await open({ [`PATCH ${base}/money-accounts/1010`]: (req: { body: any }) => ({ ...moneyAccounts[1], ...req.body }) });
  const region = screen.getByRole("region", { name: "Geldrekeningen" });
  expect(within(region).getByText("Kas: volgt de kassa")).toBeInTheDocument();
  expect(within(region).getByText("Mollie: volgt Mollie")).toBeInTheDocument();
  expect(within(region).getAllByLabelText("Automatisch via Enable Banking")).toHaveLength(1);
  await user().click(within(region).getByLabelText("Bankbestand uploaden of met de hand"));
  await waitFor(() => expect(calls("PATCH").find((c) => c.url === `${base}/money-accounts/1010`)?.body).toEqual({ source: "file" }));
  expect(within(region).getByLabelText("Bankbestand uploaden of met de hand")).toBeChecked();

  const identifier = within(region).getByLabelText("Kenmerk (IBAN of spaarnummer)");
  expect(identifier).toHaveValue("NL00INGB0000000001");
  await user().clear(identifier);
  await user().type(identifier, "NL11INGB0000000002");
  await user().click(within(region).getByRole("button", { name: "Opslaan" }));
  await waitFor(() => expect(calls("PATCH").some((c) => (c.body as any)?.identifier === "NL11INGB0000000002")).toBe(true));
});

it("shows which kassa category goes to which account", async () => {
  await open({ [`PUT ${base}/category-accounts`]: (req: { body: any }) => req.body.map((b: any) => ({ ...b, categoryName: b.categoryId })) });
  const region = screen.getByRole("region", { name: "Omzet van de kassa" });
  const select = within(region).getByLabelText("Entree") as HTMLSelectElement;
  expect(select.value).toBe("8011");
  expect(within(select).getByRole("option", { name: "8012 Entree" })).toBeInTheDocument();
  expect(within(select).queryByRole("option", { name: /4507/ })).not.toBeInTheDocument();
  await user().selectOptions(select, "8012");
  await user().click(within(region).getByRole("button", { name: "Opslaan" }));
  await waitFor(() => {
    const put = calls("PUT").find((c) => c.url === `${base}/category-accounts`);
    expect(put?.body).toEqual([
      { categoryId: "ijs", accountCode: "8011" },
      { categoryId: "entree", accountCode: "8012" },
    ]);
  });
  expect(await screen.findByText("Opgeslagen.")).toBeInTheDocument();
});

it("links to the opening balance and the 2026 figures", async () => {
  await open();
  expect(screen.getByRole("link", { name: "Beginbalans" })).toHaveAttribute("href", "/beheer/boekhouding/beginbalans");
  expect(screen.getByRole("link", { name: "Vergelijkingscijfers 2026" })).toHaveAttribute("href", "/beheer/boekhouding/vergelijking");
  void tap;
});

const ing = () => screen.getByRole("region", { name: "ING automatisch" });

it("shows where the ING connection stands", async () => {
  await open({ [`${base}/bank/ing`]: { status: "active", validUntil: "2027-06-01T12:00:00.000Z", daysLeft: 92 } });
  await waitFor(() => expect(within(ing()).getByText("Gekoppeld tot 01-06-2027")).toBeInTheDocument());
  expect(within(ing()).getByRole("button", { name: "Vernieuwen" })).toBeInTheDocument();
});

it("says not linked, expired and busy in words", async () => {
  await open();
  await waitFor(() => expect(within(ing()).getByText("Niet gekoppeld")).toBeInTheDocument());
  expect(within(ing()).getByRole("button", { name: "ING koppelen" })).toBeInTheDocument();
});

it("says expired with the day", async () => {
  await open({ [`${base}/bank/ing`]: { status: "expired", validUntil: "2027-06-01T12:00:00.000Z", daysLeft: -3 } });
  await waitFor(() => expect(within(ing()).getByText("Verlopen op 01-06-2027")).toBeInTheDocument());
  expect(within(ing()).getByRole("button", { name: "Vernieuwen" })).toBeInTheDocument();
});

it("says busy while a consent is under way", async () => {
  await open({ [`${base}/bank/ing`]: { status: "pending", validUntil: null, daysLeft: null } });
  await waitFor(() => expect(within(ing()).getByText("Bezig met koppelen")).toBeInTheDocument());
});

it("sends the browser to ING", async () => {
  await open({ [`POST ${base}/bank/ing/connect`]: { url: "https://ing.example/auth?x=1" } });
  await user().click(await within(ing()).findByRole("button", { name: "ING koppelen" }));
  await waitFor(() => expect(leavePage).toHaveBeenCalledWith("https://ing.example/auth?x=1"));
});

it("explains a refusal to connect", async () => {
  await open({ [`POST ${base}/bank/ing/connect`]: [503, { error: "enable_banking_off" }] });
  await user().click(await within(ing()).findByRole("button", { name: "ING koppelen" }));
  expect(await within(ing()).findByText("De koppeling met Enable Banking is nog niet ingesteld (de sleutel ontbreekt).")).toBeInTheDocument();
});

it("asks for the identifier first", async () => {
  await open({ [`POST ${base}/bank/ing/connect`]: [409, { error: "identifier_missing" }] });
  await user().click(await within(ing()).findByRole("button", { name: "ING koppelen" }));
  expect(await within(ing()).findByText("Vul eerst het kenmerk (IBAN) van ING betaal in.")).toBeInTheDocument();
});

it("shows the day an early end was noticed", async () => {
  await open({ [`${base}/bank/ing`]: { status: "expired", validUntil: "2027-03-02T02:00:00.000Z", daysLeft: -1 } });
  await waitFor(() => expect(within(ing()).getByText("Verlopen op 02-03-2027")).toBeInTheDocument());
});
