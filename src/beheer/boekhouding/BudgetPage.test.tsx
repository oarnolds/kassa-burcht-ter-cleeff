import { screen, waitFor, within } from "@testing-library/react";
import { strFromU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ACCOUNTS } from "../../../shared/accounts";
import { type Budget, type BudgetActuals, type BudgetLine, type BudgetRule, spread } from "../../../shared/budget";
import { MUT_ROWS, mutParts, type MutOptions, type MutRow } from "../../../shared/fixtures/eboekhouden-mutaties";
import type { DepreciationPlan, LedgerAccount } from "../../../shared/ledger-types";
import { calls, mockApi, mockLoggedIn, renderAt, rowIn, tap, user } from "../../test-utils";
import { base } from "./ledger-test-data";

const page = "/beheer/boekhouding/begroting";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The real chart, with 4510 Reclame hidden. */
const accounts: LedgerAccount[] = ACCOUNTS.map((account) => (account.code === "4510" ? { ...account, hidden: true } : account));
const chartOrder = (code: string) => accounts.findIndex((account) => account.code === code);

/** Twelve months with whole euros in the given months (1 to 12). */
const at = (pairs: Record<number, number>): number[] => Array.from({ length: 12 }, (_, i) => (pairs[i + 1] ?? 0) * 100);
const months = (euros: number, from = 1, to = 12): number[] => Array.from({ length: 12 }, (_, i) => (i + 1 >= from && i + 1 <= to ? euros * 100 : 0));

const SOURCE = { kind: "mutations", baseYear: 2026, from: "2026-01-02", to: "2026-11-20" } as const;
const RENT = at({ 1: 1153, 2: 208, 4: 1153, 7: 1182, 10: 1182 });
const line = (accountCode: string, rule: BudgetRule, lineBase: number[] | null = null): BudgetLine => ({ accountCode, rule, base: lineBase, months: spread(rule, lineBase) });

/** A budget for 2027 as the Worker gives it. */
const BUDGET_2027: Budget = {
  year: 2027,
  source: SOURCE,
  lines: [
    line("4301", { kind: "pattern", amountCents: 487800 }, RENT),
    line("4308", { kind: "monthly", amountCents: 3100 }, months(31, 1, 11)),
    line("4310", { kind: "quarterly", amountCents: 50200, month: 1 }, at({ 4: 502, 7: 502, 10: 502 })),
    line("8010", { kind: "yearly", amountCents: 100000, month: 7 }),
  ],
};

const plan = (year: number, totalCents: number): DepreciationPlan => ({ year, rows: [], totalCents, booked: false, upToDate: false, laterBooked: null });
const yearIn = (url: string) => Number(new URL(url, "http://localhost").searchParams.get("year"));
const accountIn = (url: string) => new URL(url, "http://localhost").searchParams.get("account") ?? "";

type Server = { budgets?: Record<number, Budget>; actuals?: Record<number, BudgetActuals>; depreciation?: number };

/** A fake Worker for the budget: it keeps what is sent, working out the months as the Worker does. */
function open({ budgets = {}, actuals = {}, depreciation = 0 }: Server = {}) {
  mockLoggedIn();
  const kept: Record<number, Budget> = structuredClone(budgets);
  const of = (year: number): Budget => (kept[year] ??= { year, source: null, lines: [] });
  const sorted = (lines: BudgetLine[]) => lines.sort((a, b) => chartOrder(a.accountCode) - chartOrder(b.accountCode));
  mockApi({
    [`${base}/accounts`]: accounts,
    [`${base}/budget`]: ({ url }: { url: string }) => of(yearIn(url)),
    [`PUT ${base}/budget`]: ({ url, body }: { url: string; body: { source: Budget["source"]; lines: Omit<BudgetLine, "months">[] } }) => {
      const year = yearIn(url);
      kept[year] = { year, source: body.source, lines: sorted(body.lines.map((one) => line(one.accountCode, one.rule, one.base))) };
      return kept[year];
    },
    [`PUT ${base}/budget/line`]: ({ url, body }: { url: string; body: { rule: BudgetRule } }) => {
      const budget = of(yearIn(url));
      const code = accountIn(url);
      const before = budget.lines.find((one) => one.accountCode === code);
      const changed = line(code, body.rule, before?.base ?? null);
      budget.lines = sorted([...budget.lines.filter((one) => one.accountCode !== code), changed]);
      return changed;
    },
    [`DELETE ${base}/budget/line`]: ({ url }: { url: string }) => {
      const budget = of(yearIn(url));
      budget.lines = budget.lines.filter((one) => one.accountCode !== accountIn(url));
      return { ok: true };
    },
    [`DELETE ${base}/budget`]: ({ url }: { url: string }) => {
      delete kept[yearIn(url)];
      return { ok: true };
    },
    [`${base}/budget/actuals`]: ({ url }: { url: string }) => actuals[yearIn(url)] ?? { year: yearIn(url), lastDate: null, accounts: [] },
    [`${base}/depreciation`]: ({ url }: { url: string }) => plan(yearIn(url), depreciation),
  });
  renderAt(page);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-24T10:00:00.000Z") });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const xlsx = (options?: MutOptions) => new File([zipSync(mutParts(options))], "Mutaties 2026.xlsx", { type: XLSX });
const mutation = (extra: Partial<MutRow>): MutRow => ({ nr: 1, date: "2026-03-04", kind: "Geld uit", amount: 10, account: "1010", contra: "4308", ...extra });

/** Chooses a file and waits until it is read (the input is off meanwhile). */
async function choose(file: File) {
  const input = await screen.findByLabelText("Mutatieoverzicht inlezen");
  await user().upload(input, file);
  await waitFor(() => expect(input).toBeEnabled());
}

/** The texts of a row's cells, the first (the account) included; spaces as the eye reads them. */
const cellsOf = (row: ReturnType<typeof within>) => row.getAllByRole("cell").map((cell: HTMLElement) => (cell.textContent ?? "").replace(/\s+/g, " ").trim());
const region = (name: string) => screen.getByRole("region", { name });

it("opens on the first year of the books, offers the years a budget can be made for, and says what is not there yet", async () => {
  open();
  expect(await screen.findByRole("heading", { name: "Begroting", level: 1 })).toBeInTheDocument();
  const year = screen.getByLabelText("Jaar");
  expect(year).toHaveDisplayValue("2027");
  expect(within(year).getAllByRole("option").map((option) => option.textContent)).toEqual(["2027", "2028"]);
  const make = await screen.findByRole("region", { name: "Begroting 2027 maken" });
  expect(within(make).getByText("Exporteer in e-Boekhouden het overzicht Mutaties van een jaar als Excel-bestand.")).toBeInTheDocument();
  expect(within(make).getByLabelText("Mutatieoverzicht inlezen")).toHaveAttribute("accept", ".xlsx");
  // 2026 is not a year of the books: no proposal from its bookings.
  expect(within(make).queryByRole("button", { name: /Voorstel uit de boekingen/ })).not.toBeInTheDocument();
  expect(within(region("Begroting 2027")).getByText("Er staat nog niets in de begroting van 2027.")).toBeInTheDocument();
  expect(await within(region("Begroting en werkelijk 2027")).findByText("Er zijn nog geen boekingen in 2027.")).toBeInTheDocument();
  expect(calls("GET").map((call) => call.url)).toContain(`${base}/budget/actuals?year=2027`);
});

it("reads the mutations: what was read, the groups, what is not placed or not counted, and a proposal that follows the choices", async () => {
  open({ depreciation: 123456 });
  await choose(xlsx());
  const read = await screen.findByRole("region", { name: "Voorstel voor 2027" });
  const make = region("Begroting 2027 maken");
  expect(within(make).getByText("36 mutaties gelezen, van 02-01-2026 t/m 20-11-2026.")).toBeInTheDocument();
  expect(within(make).getByText("Overboekingen tussen eigen rekeningen tellen niet mee.")).toBeInTheDocument();
  expect(
    within(make).getByText("December zit er nog niet in. Regels per maand of per kwartaal vullen dat aan; bij 'zoals 2026' blijft december leeg."),
  ).toBeInTheDocument();

  const groups = within(region("Mutaties met meer rekeningen"));
  const bank = groups.getByRole("listitem", { name: "4511 Bankkosten (ook Mollie) en 8030 Rente" });
  expect(bank).toHaveTextContent("4511 Bankkosten (ook Mollie) en 8030 Rente: 3 mutaties, € 11,25");
  expect(within(bank).getByLabelText("Bij rekening")).toHaveDisplayValue("4511 Bankkosten (ook Mollie)");
  const takings = groups.getByRole("listitem", { name: "8010 Verhuur en 8012 Entree" });
  expect(takings).toHaveTextContent("8010 Verhuur en 8012 Entree: 4 mutaties, € 3.692,82");
  expect(within(within(takings).getByLabelText("Bij rekening")).getAllByRole("option").map((option) => option.textContent)).toEqual(["8010 Verhuur", "8012 Entree"]);

  const unplaced = within(region("Niet geplaatst"));
  expect(unplaced.getByRole("listitem", { name: "4999" })).toHaveTextContent("4999: 1 mutatie, uitgaven € 30,00");
  expect(unplaced.getByRole("listitem", { name: "8810" })).toHaveTextContent("8810: 1 mutatie, ontvangsten € 8,00");
  const select4999 = unplaced.getByLabelText("Rekening voor 4999");
  expect(select4999).toHaveDisplayValue("Niet meenemen");
  const offered = within(select4999).getAllByRole("option").map((option) => option.textContent);
  expect(offered).toContain("4514 Diversen");
  expect(offered).toContain("8040 Overige opbrengsten");
  expect(offered).not.toContain("4510 Reclame");
  expect(offered).not.toContain("1010 ING betaalrekening");

  const memoriaal = MUT_ROWS.find((row) => row.kind === "Memoriaal" && row.contra === "4601")!;
  const skipped = rowIn("Niet meegenomen", "31-03-2026");
  expect(cellsOf(skipped)).toEqual([String(memoriaal.nr), "31-03-2026", "Memoriaal", "€ 400,00", "0135", "4601"]);

  const proposal = "Voorstel voor 2027";
  expect(within(read).getAllByRole("columnheader").map((head) => head.textContent)).toEqual(["Rekening", "Ritme", "Begroting 2027", "2026"]);
  expect(cellsOf(rowIn(proposal, "8004 Contributie zakelijk"))).toEqual(["8004 Contributie zakelijk", "één keer, in juli", "€ 250", "€ 250"]);
  expect(cellsOf(rowIn(proposal, "8010 Verhuur"))).toEqual(["8010 Verhuur", "zoals 2026", "€ 3.693", "€ 3.693"]);
  expect(cellsOf(rowIn(proposal, "4301 Huur"))).toEqual(["4301 Huur", "zoals 2026", "€ 4.878", "€ 4.878"]);
  expect(cellsOf(rowIn(proposal, "4306 Groenonderhoud"))).toEqual(["4306 Groenonderhoud", "één keer, in augustus", "€ 45", "€ 45"]);
  expect(cellsOf(rowIn(proposal, "4308 Energie"))).toEqual(["4308 Energie", "elke maand € 31", "€ 372", "€ 341"]);
  expect(cellsOf(rowIn(proposal, "4309 Water"))).toEqual(["4309 Water", "één keer, in september", "-€ 12", "-€ 12"]);
  expect(cellsOf(rowIn(proposal, "4310 Afvalverwerking"))).toEqual(["4310 Afvalverwerking", "per kwartaal € 502 (jan, apr, jul, okt)", "€ 2.008", "€ 1.506"]);
  expect(cellsOf(rowIn(proposal, "4507 EHBO"))).toEqual(["4507 EHBO", "één keer, in oktober", "€ 582", "€ 582"]);
  expect(cellsOf(rowIn(proposal, "4511 Bankkosten"))).toEqual(["4511 Bankkosten (ook Mollie)", "per kwartaal € 4 (mrt, jun, sep, dec)", "€ 16", "€ 12"]);
  expect(cellsOf(rowIn(proposal, "4601 Afschrijving"))).toEqual(["4601 Afschrijving speeltoestellen en inventarisuit de lijst Toestellen", "één keer, in december", "€ 1.235", ""]);
  expect(cellsOf(rowIn(proposal, "Totaal opbrengsten"))).toEqual(["Totaal opbrengsten", "", "€ 3.943", "€ 3.943"]);
  expect(cellsOf(rowIn(proposal, "Totaal kosten"))).toEqual(["Totaal kosten", "", "€ 9.124", "€ 7.352"]);
  expect(cellsOf(rowIn(proposal, "Resultaat"))).toEqual(["Resultaat", "", "-€ 5.181", "-€ 3.409"]);
  expect(within(read).queryByText(/4999/)).not.toBeInTheDocument();

  // The proposal follows the selects.
  await user().selectOptions(within(takings).getByLabelText("Bij rekening"), "8012");
  expect(cellsOf(rowIn(proposal, "8012 Entree"))).toEqual(["8012 Entree", "zoals 2026", "€ 3.693", "€ 3.693"]);
  expect(within(read).queryByText("8010 Verhuur")).not.toBeInTheDocument();
  expect(takings).toHaveTextContent("8010 Verhuur en 8012 Entree: 4 mutaties, € 3.692,82");
  await user().selectOptions(select4999, "4514");
  expect(cellsOf(rowIn(proposal, "4514 Diversen"))).toEqual(["4514 Diversen", "één keer, in april", "€ 30", "€ 30"]);
  expect(cellsOf(rowIn(proposal, "Totaal kosten"))).toEqual(["Totaal kosten", "", "€ 9.154", "€ 7.382"]);

  await tap("Begroting maken");
  await waitFor(() => expect(calls("PUT")).toHaveLength(1));
  expect(calls("PUT")[0]).toEqual({
    method: "PUT",
    url: `${base}/budget?year=2027`,
    body: {
      source: SOURCE,
      lines: [
        { accountCode: "4301", rule: { kind: "pattern", amountCents: 487800 }, base: RENT },
        { accountCode: "4306", rule: { kind: "yearly", amountCents: 4500, month: 8 }, base: at({ 8: 45 }) },
        { accountCode: "4308", rule: { kind: "monthly", amountCents: 3100 }, base: months(31, 1, 11) },
        { accountCode: "4309", rule: { kind: "yearly", amountCents: -1200, month: 9 }, base: at({ 9: -12 }) },
        { accountCode: "4310", rule: { kind: "quarterly", amountCents: 50200, month: 1 }, base: at({ 4: 502, 7: 502, 10: 502 }) },
        { accountCode: "4507", rule: { kind: "yearly", amountCents: 58200, month: 10 }, base: at({ 10: 582 }) },
        { accountCode: "4511", rule: { kind: "quarterly", amountCents: 400, month: 3 }, base: at({ 3: 4, 6: 4, 9: 4 }) },
        { accountCode: "4514", rule: { kind: "yearly", amountCents: 3000, month: 4 }, base: at({ 4: 30 }) },
        { accountCode: "4601", rule: { kind: "yearly", amountCents: 123500, month: 12 }, base: null },
        { accountCode: "8004", rule: { kind: "yearly", amountCents: 25000, month: 7 }, base: at({ 7: 250 }) },
        { accountCode: "8012", rule: { kind: "pattern", amountCents: 369300 }, base: at({ 5: 500, 6: 693, 7: 1500, 8: 1000 }) },
      ],
    },
  });
  expect(await screen.findByText("Begroting gemaakt.")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("region", { name: "Begroting 2027 maken" })).not.toBeInTheDocument());
  expect(screen.queryByRole("region", { name: "Voorstel voor 2027" })).not.toBeInTheDocument();
  expect(cellsOf(rowIn("Begroting 2027", "4308 Energie"))).toEqual(["4308 Energie", ...Array(12).fill("31"), "372"]);
  expect(within(region("Begroting 2027")).getByText("Voorstel uit de mutaties van e-Boekhouden, 02-01-2026 t/m 20-11-2026.")).toBeInTheDocument();
});

it("says so when a file is not a mutatieoverzicht, holds more than one year, or is not of a year before the budget", async () => {
  open();
  await choose(xlsx({ title: "Winst & verlies 01-01-2026 t/m 31-12-2026 (38)" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Dit is geen mutatieoverzicht uit e-Boekhouden.");
  await choose(new File(["geen zip"], "iets.xlsx", { type: XLSX }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Dit is geen mutatieoverzicht uit e-Boekhouden.");
  await choose(xlsx({ rows: [mutation({ nr: 2, date: "2026-01-02" }), mutation({ nr: 1, date: "2025-12-31" })] }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Lees de mutaties van één jaar in.");
  await choose(xlsx({ rows: [mutation({ date: "2027-01-02" })] }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Lees de mutaties van een jaar vóór 2027 in.");
  expect(screen.queryByRole("region", { name: "Voorstel voor 2027" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Begroting maken" })).not.toBeInTheDocument();
});

it("proposes from the bookings of the year before, up to its last booking", async () => {
  open({
    actuals: {
      2027: {
        year: 2027,
        lastDate: "2027-06-15",
        accounts: [
          { accountCode: "4308", cents: months(31, 1, 6) },
          { accountCode: "8012", cents: at({ 6: 2000 }) },
        ],
      },
    },
  });
  await user().selectOptions(await screen.findByLabelText("Jaar"), "2028");
  const make = await screen.findByRole("region", { name: "Begroting 2028 maken" });
  await user().click(await within(make).findByRole("button", { name: "Voorstel uit de boekingen van 2027" }));
  expect(within(make).getByText("Voorstel uit de boekingen van 2027, t/m 15-06-2027.")).toBeInTheDocument();
  expect(
    within(make).getByText("Juli tot en met december zitten er nog niet in. Regels per maand of per kwartaal vullen dat aan; bij 'zoals 2027' blijven die maanden leeg."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Mutaties met meer rekeningen" })).not.toBeInTheDocument();
  const proposal = "Voorstel voor 2028";
  expect(cellsOf(rowIn(proposal, "4308 Energie"))).toEqual(["4308 Energie", "elke maand € 31", "€ 372", "€ 186"]);
  expect(cellsOf(rowIn(proposal, "8012 Entree"))).toEqual(["8012 Entree", "één keer, in juni", "€ 2.000", "€ 2.000"]);
  expect(within(region(proposal)).queryByText(/4601/)).not.toBeInTheDocument();

  await tap("Begroting maken");
  await waitFor(() => expect(calls("PUT")).toHaveLength(1));
  expect(calls("PUT")[0]).toMatchObject({
    url: `${base}/budget?year=2028`,
    body: {
      source: { kind: "ledger", baseYear: 2027, from: "2027-01-01", to: "2027-06-15" },
      lines: [
        { accountCode: "4308", rule: { kind: "monthly", amountCents: 3100 }, base: months(31, 1, 6) },
        { accountCode: "8012", rule: { kind: "yearly", amountCents: 200000, month: 6 }, base: at({ 6: 2000 }) },
      ],
    },
  });
  expect(await within(region("Begroting 2028")).findByText("Voorstel uit de boekingen van 2027, t/m 15-06-2027.")).toBeInTheDocument();
});

it("shows the budget as a grid of whole euros, with the totals of each group and the result", async () => {
  open({ budgets: { 2027: BUDGET_2027 } });
  const grid = await screen.findByRole("region", { name: "Begroting 2027" });
  await within(grid).findByText("4308 Energie");
  expect(screen.queryByRole("region", { name: "Begroting 2027 maken" })).not.toBeInTheDocument();
  expect(within(grid).getByText("Voorstel uit de mutaties van e-Boekhouden, 02-01-2026 t/m 20-11-2026.")).toBeInTheDocument();
  expect(within(grid).getByText("Bedragen in hele euro's.")).toBeInTheDocument();
  const heads = within(grid).getAllByRole("columnheader").map((head) => head.textContent);
  expect(heads).toEqual(["Rekening", "jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec", "Totaal"]);
  const section = "Begroting 2027";
  expect(cellsOf(rowIn(section, "8010 Verhuur"))).toEqual(["8010 Verhuur", "", "", "", "", "", "", "1.000", "", "", "", "", "", "1.000"]);
  expect(cellsOf(rowIn(section, "Totaal opbrengsten"))).toEqual(["Totaal opbrengsten", "0", "0", "0", "0", "0", "0", "1.000", "0", "0", "0", "0", "0", "1.000"]);
  expect(cellsOf(rowIn(section, "4301 Huur"))).toEqual(["4301 Huur", "1.153", "208", "", "1.153", "", "", "1.182", "", "", "1.182", "", "", "4.878"]);
  expect(cellsOf(rowIn(section, "4308 Energie"))).toEqual(["4308 Energie", ...Array(12).fill("31"), "372"]);
  expect(cellsOf(rowIn(section, "4310 Afvalverwerking"))).toEqual(["4310 Afvalverwerking", "502", "", "", "502", "", "", "502", "", "", "502", "", "", "2.008"]);
  expect(cellsOf(rowIn(section, "Totaal kosten"))).toEqual(["Totaal kosten", "1.686", "239", "31", "1.686", "31", "31", "1.715", "31", "31", "1.715", "31", "31", "7.258"]);
  expect(cellsOf(rowIn(section, "Resultaat"))).toEqual(["Resultaat", "-1.686", "-239", "-31", "-1.686", "-31", "-31", "-715", "-31", "-31", "-1.715", "-31", "-31", "-6.258"]);
  // The account opens the editor; there is no column of buttons.
  expect(within(grid).getByRole("button", { name: "4308 Energie wijzigen" })).toHaveTextContent("4308 Energie");
  expect(within(grid).queryByRole("button", { name: "Wijzigen" })).not.toBeInTheDocument();
});

/** Opens the editor of an account in the grid. */
async function edit(name: string) {
  await user().click(await screen.findByRole("button", { name: `${name} wijzigen` }));
  return within(await screen.findByRole("region", { name }));
}
const previewOf = (editor: ReturnType<typeof within>, label: string) => cellsOf(within(editor.getByRole("row", { name: new RegExp(`^${label}`) })));
const retype = async (field: HTMLElement, text: string) => {
  await user().clear(field);
  if (text !== "") await user().type(field, text);
};

it("changes a line to the same amount every month, and shows what it becomes next to the base", async () => {
  open({ budgets: { 2027: BUDGET_2027 } });
  const editor = await edit("4308 Energie");
  expect(editor.getByLabelText("Ritme")).toHaveDisplayValue("Elke maand hetzelfde");
  expect(within(editor.getByLabelText("Ritme")).getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Elke maand hetzelfde",
    "Per kwartaal",
    "Eén keer per jaar",
    "Zoals 2026",
    "Eigen bedrag per maand",
  ]);
  const amount = editor.getByLabelText("Bedrag per maand");
  expect(amount).toHaveValue("31");
  expect(previewOf(editor, "In 2026:")).toEqual([...Array(11).fill("31"), "", "341"]);
  await retype(amount, "35");
  expect(previewOf(editor, "Dat wordt:")).toEqual([...Array(12).fill("35"), "420"]);
  await user().click(editor.getByRole("button", { name: "Opslaan" }));
  await waitFor(() => expect(calls("PUT")).toHaveLength(1));
  expect(calls("PUT")[0]).toEqual({ method: "PUT", url: `${base}/budget/line?year=2027&account=4308`, body: { rule: { kind: "monthly", amountCents: 3500 } } });
  expect(await screen.findByText("Opgeslagen.")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("region", { name: "4308 Energie" })).not.toBeInTheDocument());
  expect(cellsOf(rowIn("Begroting 2027", "4308 Energie"))).toEqual(["4308 Energie", ...Array(12).fill("35"), "420"]);
});

it("sends a rule per quarter, once a year, like the base, or per month", async () => {
  open({ budgets: { 2027: BUDGET_2027 } });
  let editor = await edit("4308 Energie");
  await user().selectOptions(editor.getByLabelText("Ritme"), "Per kwartaal");
  // Switching keeps about the year's total: 372 over four quarters.
  expect(editor.getByLabelText("Bedrag per kwartaal")).toHaveValue("93");
  await retype(editor.getByLabelText("Bedrag per kwartaal"), "1.200");
  await user().selectOptions(editor.getByLabelText("In de maanden"), "feb, mei, aug, nov");
  expect(previewOf(editor, "Dat wordt:")).toEqual(["", "1.200", "", "", "1.200", "", "", "1.200", "", "", "1.200", "", "4.800"]);
  await user().click(editor.getByRole("button", { name: "Opslaan" }));
  await waitFor(() => expect(calls("PUT")).toHaveLength(1));
  expect(calls("PUT")[0]!.body).toEqual({ rule: { kind: "quarterly", amountCents: 120000, month: 2 } });

  editor = await edit("4308 Energie");
  await user().selectOptions(editor.getByLabelText("Ritme"), "Eén keer per jaar");
  await retype(editor.getByLabelText("Bedrag"), "-293");
  await user().selectOptions(editor.getByLabelText("Maand"), "mei");
  expect(previewOf(editor, "Dat wordt:")).toEqual(["", "", "", "", "-293", "", "", "", "", "", "", "", "-293"]);
  await user().click(editor.getByRole("button", { name: "Opslaan" }));
  await waitFor(() => expect(calls("PUT")).toHaveLength(2));
  expect(calls("PUT")[1]!.body).toEqual({ rule: { kind: "yearly", amountCents: -29300, month: 5 } });

  editor = await edit("4308 Energie");
  await user().selectOptions(editor.getByLabelText("Ritme"), "Zoals 2026");
  await retype(editor.getByLabelText("Bedrag voor het hele jaar"), "6.000");
  // 6000 like eleven months of 31: 545 each, and what rounding left on the first.
  expect(previewOf(editor, "Dat wordt:")).toEqual(["550", ...Array(10).fill("545"), "", "6.000"]);
  await user().click(editor.getByRole("button", { name: "Opslaan" }));
  await waitFor(() => expect(calls("PUT")).toHaveLength(3));
  expect(calls("PUT")[2]!.body).toEqual({ rule: { kind: "pattern", amountCents: 600000 } });

  editor = await edit("4308 Energie");
  await user().selectOptions(editor.getByLabelText("Ritme"), "Eigen bedrag per maand");
  // The months it had, to change one by one.
  expect(editor.getByLabelText("jan")).toHaveValue("550");
  expect(editor.getByLabelText("dec")).toHaveValue("0");
  await retype(editor.getByLabelText("jan"), "100");
  await retype(editor.getByLabelText("dec"), "-5");
  expect(previewOf(editor, "Dat wordt:")).toEqual(["100", ...Array(10).fill("545"), "-5", "5.545"]);
  await user().click(editor.getByRole("button", { name: "Opslaan" }));
  await waitFor(() => expect(calls("PUT")).toHaveLength(4));
  expect(calls("PUT")[3]!.body).toEqual({ rule: { kind: "custom", months: [10000, ...Array(10).fill(54500), -500] } });
});

it("wants whole euros, and offers 'like the base' only with a base", async () => {
  open({ budgets: { 2027: BUDGET_2027 } });
  let editor = await edit("4308 Energie");
  await retype(editor.getByLabelText("Bedrag per maand"), "31,50");
  expect(editor.getByText("Vul hele euro's in, zonder centen.")).toBeInTheDocument();
  expect(editor.getByRole("button", { name: "Opslaan" })).toBeDisabled();
  await retype(editor.getByLabelText("Bedrag per maand"), "veel");
  expect(editor.getByText("Dit bedrag kan ik niet lezen.")).toBeInTheDocument();
  expect(editor.getByRole("button", { name: "Opslaan" })).toBeDisabled();
  await retype(editor.getByLabelText("Bedrag per maand"), "");
  expect(editor.getByRole("button", { name: "Opslaan" })).toBeDisabled();
  await retype(editor.getByLabelText("Bedrag per maand"), "1.153");
  expect(editor.getByRole("button", { name: "Opslaan" })).toBeEnabled();
  await user().click(editor.getByRole("button", { name: "Annuleren" }));
  expect(screen.queryByRole("region", { name: "4308 Energie" })).not.toBeInTheDocument();
  expect(calls("PUT")).toHaveLength(0);

  editor = await edit("8010 Verhuur");
  expect(editor.getByLabelText("Ritme")).toHaveDisplayValue("Eén keer per jaar");
  expect(editor.getByLabelText("Bedrag")).toHaveValue("1.000");
  expect(editor.getByLabelText("Maand")).toHaveDisplayValue("juli");
  expect(within(editor.getByLabelText("Ritme")).queryByRole("option", { name: /Zoals/ })).not.toBeInTheDocument();
  expect(editor.queryByRole("row", { name: /^In 2026:/ })).not.toBeInTheDocument();
});

it("takes a line out of the budget", async () => {
  open({ budgets: { 2027: BUDGET_2027 } });
  const editor = await edit("4310 Afvalverwerking");
  await user().click(editor.getByRole("button", { name: "Uit de begroting halen" }));
  await waitFor(() => expect(calls("DELETE")).toHaveLength(1));
  expect(calls("DELETE")[0]!.url).toBe(`${base}/budget/line?year=2027&account=4310`);
  expect(await screen.findByText("Uit de begroting gehaald.")).toBeInTheDocument();
  await waitFor(() => expect(within(region("Begroting 2027")).queryByRole("button", { name: "4310 Afvalverwerking wijzigen" })).not.toBeInTheDocument());
  // It can be added again.
  expect(within(within(region("Begroting 2027")).getByLabelText("Rekening toevoegen")).getByRole("option", { name: "4310 Afvalverwerking" })).toBeInTheDocument();
});

it("adds an account that is not in the budget yet", async () => {
  open({ budgets: { 2027: BUDGET_2027 } });
  const grid = within(await screen.findByRole("region", { name: "Begroting 2027" }));
  const add = await grid.findByLabelText("Rekening toevoegen");
  const offered = within(add).getAllByRole("option").map((option) => option.textContent);
  expect(offered).toContain("4501 Inkoop kiosk");
  expect(offered).toContain("8012 Entree");
  for (const absent of ["4308 Energie", "8010 Verhuur", "4510 Reclame", "1010 ING betaalrekening", "1400 Eigen vermogen"]) expect(offered).not.toContain(absent);
  expect(grid.getByRole("button", { name: "Toevoegen" })).toBeDisabled();
  await user().selectOptions(add, "4501");
  await user().click(grid.getByRole("button", { name: "Toevoegen" }));
  const editor = within(await screen.findByRole("region", { name: "4501 Inkoop kiosk" }));
  expect(editor.getByLabelText("Ritme")).toHaveDisplayValue("Elke maand hetzelfde");
  expect(editor.getByLabelText("Bedrag per maand")).toHaveValue("");
  expect(editor.getByRole("button", { name: "Opslaan" })).toBeDisabled();
  expect(editor.queryByRole("button", { name: "Uit de begroting halen" })).not.toBeInTheDocument();
  await user().type(editor.getByLabelText("Bedrag per maand"), "250");
  await user().click(editor.getByRole("button", { name: "Opslaan" }));
  await waitFor(() => expect(calls("PUT")).toHaveLength(1));
  expect(calls("PUT")[0]).toEqual({ method: "PUT", url: `${base}/budget/line?year=2027&account=4501`, body: { rule: { kind: "monthly", amountCents: 25000 } } });
  expect(await within(region("Begroting 2027")).findByRole("button", { name: "4501 Inkoop kiosk wijzigen" })).toBeInTheDocument();
});

it("asks once more before it empties the year's budget", async () => {
  open({ budgets: { 2027: BUDGET_2027 } });
  const grid = within(await screen.findByRole("region", { name: "Begroting 2027" }));
  await user().click(await grid.findByRole("button", { name: "Begroting 2027 leegmaken" }));
  expect(grid.getByText("Alle regels van 2027 gaan weg.")).toBeInTheDocument();
  await user().click(grid.getByRole("button", { name: "Annuleren" }));
  expect(grid.queryByText("Alle regels van 2027 gaan weg.")).not.toBeInTheDocument();
  expect(calls("DELETE")).toHaveLength(0);
  await user().click(grid.getByRole("button", { name: "Begroting 2027 leegmaken" }));
  await user().click(grid.getByRole("button", { name: "Leegmaken" }));
  await waitFor(() => expect(calls("DELETE")).toHaveLength(1));
  expect(calls("DELETE")[0]!.url).toBe(`${base}/budget?year=2027`);
  expect(await screen.findByText("Leeggemaakt.")).toBeInTheDocument();
  expect(await screen.findByRole("region", { name: "Begroting 2027 maken" })).toBeInTheDocument();
});

it("lays the books next to the budget up to a month, an account without a budget line included", async () => {
  open({
    budgets: { 2027: BUDGET_2027 },
    actuals: {
      2027: {
        year: 2027,
        lastDate: "2027-03-20",
        accounts: [
          { accountCode: "4308", cents: [3000, 3200, 2900, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
          { accountCode: "8012", cents: at({ 3: 500 }) },
        ],
      },
    },
  });
  const compare = within(await screen.findByRole("region", { name: "Begroting en werkelijk 2027" }));
  const upTo = await compare.findByLabelText("Tot en met");
  expect(upTo).toHaveDisplayValue("maart");
  const section = "Begroting en werkelijk 2027";
  expect(compare.getAllByRole("columnheader").map((head) => head.textContent)).toEqual([
    "Rekening",
    "Begroot 2027",
    "Begroot t/m maart",
    "Werkelijk t/m maart",
    "Verschil",
  ]);
  expect(cellsOf(rowIn(section, "8010 Verhuur"))).toEqual(["8010 Verhuur", "€ 1.000,00", "€ 0,00", "€ 0,00", "€ 0,00"]);
  expect(cellsOf(rowIn(section, "8012 Entree"))).toEqual(["8012 Entree", "€ 0,00", "€ 0,00", "€ 500,00", "€ 500,00"]);
  expect(cellsOf(rowIn(section, "Totaal opbrengsten"))).toEqual(["Totaal opbrengsten", "€ 1.000,00", "€ 0,00", "€ 500,00", "€ 500,00"]);
  expect(cellsOf(rowIn(section, "4301 Huur"))).toEqual(["4301 Huur", "€ 4.878,00", "€ 1.361,00", "€ 0,00", "-€ 1.361,00"]);
  expect(cellsOf(rowIn(section, "4308 Energie"))).toEqual(["4308 Energie", "€ 372,00", "€ 93,00", "€ 91,00", "-€ 2,00"]);
  expect(cellsOf(rowIn(section, "Totaal kosten"))).toEqual(["Totaal kosten", "€ 7.258,00", "€ 1.956,00", "€ 91,00", "-€ 1.865,00"]);
  expect(cellsOf(rowIn(section, "Resultaat"))).toEqual(["Resultaat", "-€ 6.258,00", "-€ 1.956,00", "€ 409,00", "€ 2.365,00"]);

  await user().selectOptions(upTo, "februari");
  expect(compare.getByRole("columnheader", { name: "Werkelijk t/m februari" })).toBeInTheDocument();
  expect(cellsOf(rowIn(section, "4308 Energie"))).toEqual(["4308 Energie", "€ 372,00", "€ 62,00", "€ 62,00", "€ 0,00"]);
});

it("reads another year when one is chosen", async () => {
  open({ budgets: { 2027: BUDGET_2027 } });
  await screen.findByRole("button", { name: "4308 Energie wijzigen" });
  await user().selectOptions(screen.getByLabelText("Jaar"), "2028");
  expect(await screen.findByRole("region", { name: "Begroting 2028 maken" })).toBeInTheDocument();
  expect(calls("GET").map((call) => call.url)).toContain(`${base}/budget?year=2028`);
  expect(within(region("Begroting 2028")).getByText("Er staat nog niets in de begroting van 2028.")).toBeInTheDocument();
  // 2027 has no bookings: nothing to propose from.
  expect(screen.queryByRole("button", { name: "Voorstel uit de boekingen van 2027" })).not.toBeInTheDocument();
});

it("downloads the grid as an Excel file", async () => {
  const saved: { name: string; blob: Blob }[] = [];
  const blobs = new Map<string, Blob>();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      const url = `blob:test/${blobs.size + 1}`;
      blobs.set(url, blob);
      return url;
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: blobs.get(this.href)! });
  });
  open({ budgets: { 2027: BUDGET_2027 } });
  await tap("Downloaden als Excel");
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]!.name).toBe("Begroting 2027.xlsx");
  expect(saved[0]!.blob.type).toBe(XLSX);
  const files = unzipSync(new Uint8Array(await saved[0]!.blob.arrayBuffer()));
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
  for (const text of ["Begroting 2027", "4308 Energie", "Totaal kosten", "Resultaat", "Voorstel uit de mutaties van e-Boekhouden, 02-01-2026 t/m 20-11-2026."]) {
    expect(sheet).toContain(text);
  }
  expect(sheet).toContain("<v>-6258.00</v>");
});
