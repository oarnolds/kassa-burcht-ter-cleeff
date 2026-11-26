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
  account("1000", "Kas (kluisje)", "asset", { money: true }),
  account("1021", "ASN deposito", "asset", { money: true }),
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
    [`${base}/gmail`]: { status: "none", email: null },
    [`${base}/category-accounts`]: [
      { categoryId: "ijs", categoryName: "IJs", accountCode: "8011" },
      { categoryId: "entree", categoryName: "Entree", accountCode: "8011" },
    ],
    [`${base}/mollie/rules`]: [],
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

it("says that Kas and Mollie cannot be hidden", async () => {
  await open();
  const region = screen.getByRole("region", { name: "Rekeningen" });
  const row = within(within(region).getByText("Kas (kluisje)").closest("li")!);
  expect(row.getByText("Kas en Mollie blijven altijd zichtbaar.")).toBeInTheDocument();
  expect(row.queryByRole("button", { name: "Verbergen" })).not.toBeInTheDocument();
});

it("hides a bank account that nothing is booked on", async () => {
  await open({ [`PATCH ${base}/accounts/1021`]: (req: { body: any }) => ({ ...accounts[5], ...req.body }) });
  const region = screen.getByRole("region", { name: "Rekeningen" });
  const row = within(within(region).getByText("ASN deposito").closest("li")!);
  await user().click(row.getByRole("button", { name: "Verbergen" }));
  await waitFor(() => expect(calls("PATCH").find((c) => c.url === `${base}/accounts/1021`)?.body).toEqual({ hidden: true }));
});

it("says why a bank account in use stays visible", async () => {
  await open({ [`PATCH ${base}/accounts/1010`]: [409, { error: "money_account_in_use" }] });
  const region = screen.getByRole("region", { name: "Rekeningen" });
  const row = within(within(region).getByText("ING betaalrekening").closest("li")!);
  await user().click(row.getByRole("button", { name: "Verbergen" }));
  expect(await within(region).findByText("Op deze rekening staan boekingen of bankregels; hij blijft zichtbaar.")).toBeInTheDocument();
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

it("links to reading 2026 in, the opening balance, the earlier years and the 2025 figures", async () => {
  await open();
  const once = within(screen.getByRole("region", { name: "Eenmalig" })).getAllByRole("link");
  expect(once[0]).toHaveAccessibleName("2026 uit e-Boekhouden inlezen");
  expect(once[0]).toHaveAttribute("href", "/beheer/boekhouding/eboekhouden-2026");
  expect(screen.getByRole("link", { name: "Beginbalans" })).toHaveAttribute("href", "/beheer/boekhouding/beginbalans");
  expect(screen.getByRole("link", { name: "Eerdere jaren" })).toHaveAttribute("href", "/beheer/boekhouding/eerdere-jaren");
  expect(screen.getByRole("link", { name: "Vergelijkingscijfers 2025" })).toHaveAttribute("href", "/beheer/boekhouding/vergelijking");
  void tap;
});

const gmail = () => screen.getByRole("region", { name: "Gmail (Zoek bijlage)" });

it("says Gmail is not set up while the Google keys are missing", async () => {
  await open({ [`${base}/gmail`]: { status: "not_configured", email: null } });
  await waitFor(() => expect(within(gmail()).getByText("Nog niet ingesteld: de sleutels van Google ontbreken. Zie de handleiding.")).toBeInTheDocument());
  expect(within(gmail()).queryByRole("button")).toBeNull();
});

it("sends the browser to Google to link Gmail", async () => {
  await open({ [`POST ${base}/gmail/connect`]: { url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" } });
  await waitFor(() => expect(within(gmail()).getByText("Niet gekoppeld")).toBeInTheDocument());
  await user().click(within(gmail()).getByRole("button", { name: "Gmail koppelen" }));
  await waitFor(() => expect(leavePage).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?x=1"));
});

it("shows the linked address, and unlinks", async () => {
  await open({ [`${base}/gmail`]: { status: "active", email: "speeltuin@gmail.com" }, [`POST ${base}/gmail/disconnect`]: { status: "none", email: null } });
  await waitFor(() => expect(within(gmail()).getByText("Gekoppeld met speeltuin@gmail.com")).toBeInTheDocument());
  await user().click(within(gmail()).getByRole("button", { name: "Ontkoppelen" }));
  await waitFor(() => expect(calls("POST").some((c) => c.url === `${base}/gmail/disconnect`)).toBe(true));
});

it("asks to link Gmail again once Google stopped accepting it", async () => {
  await open({ [`${base}/gmail`]: { status: "expired", email: "speeltuin@gmail.com" } });
  await waitFor(() => expect(within(gmail()).getByText("Verlopen: koppel speeltuin@gmail.com opnieuw")).toBeInTheDocument());
  expect(within(gmail()).getByRole("button", { name: "Opnieuw koppelen" })).toBeInTheDocument();
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

const rules = () => screen.getByRole("region", { name: "Regels voor Mollie" });

it("lets the penningmeester set the rules for Mollie's other payments", async () => {
  let list = [
    { id: "r1", keyword: "dagkaart", accountCode: "8012" },
    { id: "r2", keyword: "lidm", accountCode: "8011" },
  ];
  await open({
    [`${base}/mollie/rules`]: () => list,
    [`POST ${base}/mollie/rules`]: (req: { body: any }) => {
      const rule = { id: "r3", ...req.body };
      list = [...list, rule];
      return [201, rule];
    },
    [`DELETE ${base}/mollie/rules/r1`]: () => {
      list = list.filter((rule) => rule.id !== "r1");
      return { ok: true };
    },
  });
  await waitFor(() => expect(within(rules()).getByText("Omschrijving bevat 'dagkaart' → 8012 Entree")).toBeInTheDocument());
  expect(within(rules()).getByText("Omschrijving bevat 'lidm' → 8011 Verkoop kassa")).toBeInTheDocument();

  // Only income accounts to choose from.
  const account = within(rules()).getByLabelText("Rekening") as HTMLSelectElement;
  expect(within(account).getByRole("option", { name: "8012 Entree" })).toBeInTheDocument();
  expect(within(account).queryByRole("option", { name: /4507/ })).not.toBeInTheDocument();
  await user().type(within(rules()).getByLabelText("Omschrijving bevat"), " Donatie ");
  await user().selectOptions(account, "8012");
  await user().click(within(rules()).getByRole("button", { name: "Regel toevoegen" }));
  await waitFor(() => expect(calls("POST").find((c) => c.url === `${base}/mollie/rules`)?.body).toEqual({ keyword: "Donatie", accountCode: "8012" }));
  expect(await within(rules()).findByText("Omschrijving bevat 'Donatie' → 8012 Entree")).toBeInTheDocument();
  expect(within(rules()).getByLabelText("Omschrijving bevat")).toHaveValue("");

  const first = within(within(rules()).getByText("Omschrijving bevat 'dagkaart' → 8012 Entree").closest("li")!);
  await user().click(first.getByRole("button", { name: "Weghalen" }));
  await waitFor(() => expect(calls("DELETE").some((c) => c.url === `${base}/mollie/rules/r1`)).toBe(true));
  await waitFor(() => expect(within(rules()).queryByText("Omschrijving bevat 'dagkaart' → 8012 Entree")).not.toBeInTheDocument());
});

it("explains a rule that is refused", async () => {
  await open({ [`POST ${base}/mollie/rules`]: [400, { error: "not_income_account" }] });
  await waitFor(() => expect(within(rules()).getByLabelText("Omschrijving bevat")).toBeInTheDocument());
  await user().type(within(rules()).getByLabelText("Omschrijving bevat"), "kosten");
  await user().click(within(rules()).getByRole("button", { name: "Regel toevoegen" }));
  expect(await within(rules()).findByText("Kies een opbrengstrekening.")).toBeInTheDocument();
});

it("offers Enable Banking only for ING betaal; another bank says it works from files", async () => {
  await open({
    [`${base}/money-accounts`]: [...moneyAccounts, money("1020", "ING kwartaalrekening", "file", "V00000000"), money("1021", "ASN spaarrekening", "file")],
  });
  const region = screen.getByRole("region", { name: "Geldrekeningen" });
  expect(within(region).getAllByLabelText("Automatisch via Enable Banking")).toHaveLength(1);
  expect(within(region).getByRole("radiogroup", { name: "Bron van ING betaalrekening" })).toBeInTheDocument();
  for (const name of ["ING kwartaalrekening", "ASN spaarrekening"]) {
    const row = within(within(region).getByText(name).closest("li")!);
    expect(row.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(row.getByText("Bankbestand uploaden of met de hand")).toBeInTheDocument();
    expect(row.getByLabelText("Kenmerk (IBAN of spaarnummer)")).toBeInTheDocument();
  }
});
