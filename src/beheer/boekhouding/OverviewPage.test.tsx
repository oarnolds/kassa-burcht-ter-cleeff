import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { formatEuro } from "../../../shared/money";
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
  mollieInTransitCents: 0,
  lastNightly: null,
  notUpdatedSince: null,
  toBookByAccount: {},
  eboekhoudenDone: true,
  assetsRepasteNeeded: false,
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

it("tells when the last run was, and each step that failed in red with its code", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-03-07T07:00:00.000Z") });
  try {
    mockLoggedIn();
    mockApi({ [`${base}/overview`]: overview({ lastNightly: report("2027-03-07T01:00:00.000Z", { kassa: "ok", ing: "ing_cut_short", mollie: "error" }) }) });
    renderAt("/beheer/boekhouding");
    expect(await screen.findByText("Vannacht bijgewerkt om 02:00")).toBeInTheDocument();
    expect(screen.getByText("ING is vannacht niet gelukt: ing_cut_short")).toHaveClass("text-redbrown");
    expect(screen.getByText("Mollie is vannacht niet gelukt: error")).toHaveClass("text-redbrown");
    expect(screen.queryByText(/Kassa is/)).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("names the day when the last run was not last night", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: overview({ lastNightly: report("2027-03-05T14:30:00.000Z", { kassa: "unbalanced", ing: "no_access", mollie: "skipped" }) }) });
  renderAt("/beheer/boekhouding");
  expect(await screen.findByText("Bijgewerkt op 5-3-2027 om 15:30")).toBeInTheDocument();
  expect(screen.getByText("Kassa is op 5-3-2027 om 15:30 niet gelukt: unbalanced")).toHaveClass("text-redbrown");
  expect(screen.getByText("ING is op 5-3-2027 om 15:30 niet gelukt: no_access")).toHaveClass("text-redbrown");
  expect(screen.queryByText(/Mollie is/)).not.toBeInTheDocument();
});

it("says in red since when the books were not brought up to date", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: overview({ notUpdatedSince: "2027-03-05T14:30:00.000Z" }) });
  const first = renderAt("/beheer/boekhouding");
  expect(await screen.findByText("De boekhouding is sinds 5-3-2027 15:30 niet bijgewerkt")).toHaveClass("text-redbrown");
  first.unmount();
  mockApi({ [`${base}/overview`]: overview() });
  renderAt("/beheer/boekhouding");
  await screen.findByRole("link", { name: "Te boeken: 3" });
  expect(screen.queryByText(/niet bijgewerkt/)).not.toBeInTheDocument();
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

const withSource = (source: "file" | "enable_banking", extra = {}) =>
  overview({ moneyAccounts: [moneyAccount({ accountCode: "1010", name: "ING betaalrekening", source })], ...extra });
const soon = (daysLeft: number) => ({ consent: { validUntil: "2027-06-01T12:00:00.000Z", daysLeft } });

it("warns two weeks before the consent of ING ends", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: withSource("enable_banking", soon(14)) });
  renderAt("/beheer/boekhouding");
  const link = await screen.findByRole("link", { name: "Vernieuwen" });
  expect(link).toHaveAttribute("href", "/beheer/boekhouding/instellingen");
  expect(link.parentElement).toHaveTextContent("De toestemming van ING verloopt over 14 dagen. Vernieuwen");
});

it("says 1 dag, and warns after the end, and says nothing before the two weeks", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: withSource("enable_banking", soon(1)) });
  const first = renderAt("/beheer/boekhouding");
  expect((await screen.findByRole("link", { name: "Vernieuwen" })).parentElement).toHaveTextContent("De toestemming van ING verloopt over 1 dag. Vernieuwen");
  first.unmount();

  mockApi({ [`${base}/overview`]: withSource("enable_banking", soon(-2)) });
  const second = renderAt("/beheer/boekhouding");
  expect((await screen.findByRole("link", { name: "Vernieuwen" })).parentElement).toHaveTextContent(
    "ING haalt geen regels meer op: toestemming verlopen. Vernieuwen of upload een bankbestand.",
  );
  second.unmount();

  mockApi({ [`${base}/overview`]: withSource("enable_banking", soon(15)) });
  renderAt("/beheer/boekhouding");
  await screen.findByRole("link", { name: "Te boeken: 3" });
  expect(screen.queryByRole("link", { name: "Vernieuwen" })).not.toBeInTheDocument();
});

it("does not warn when ING betaal works from files", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: withSource("file", soon(3)) });
  renderAt("/beheer/boekhouding");
  await screen.findByRole("link", { name: "Te boeken: 3" });
  expect(screen.queryByRole("link", { name: "Vernieuwen" })).not.toBeInTheDocument();
});

it("says today on the last day, and expired only once it is past", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: withSource("enable_banking", soon(0)) });
  renderAt("/beheer/boekhouding");
  expect((await screen.findByRole("link", { name: "Vernieuwen" })).parentElement).toHaveTextContent("De toestemming van ING verloopt vandaag. Vernieuwen");
  expect(screen.queryByText(/toestemming verlopen/)).not.toBeInTheDocument();
});

it("warns at once when the consent ended early (a long way from its planned end)", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: withSource("enable_banking", { consent: { validUntil: "2027-03-02T02:00:00.000Z", daysLeft: -1 } }) });
  renderAt("/beheer/boekhouding");
  expect((await screen.findByRole("link", { name: "Vernieuwen" })).parentElement).toHaveTextContent(
    "ING haalt geen regels meer op: toestemming verlopen. Vernieuwen of upload een bankbestand.",
  );
});

it("points to the Mollie page when Mollie's balance differs from the books", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: overview({ mollieDifferenceCents: -250 }) });
  const first = renderAt("/beheer/boekhouding");
  // The amount carries a non-breaking space, as everywhere in beheer.
  expect(await screen.findByRole("link", { name: `Mollie wijkt ${formatEuro(250)} af van de boekhouding` })).toHaveAttribute("href", "/beheer/boekhouding/mollie");
  first.unmount();

  for (const same of [0, null]) {
    mockApi({ [`${base}/overview`]: overview({ mollieDifferenceCents: same }) });
    const page = renderAt("/beheer/boekhouding");
    await screen.findByRole("link", { name: "Te boeken: 3" });
    expect(screen.queryByText(/Mollie wijkt/)).not.toBeInTheDocument();
    page.unmount();
  }
});

it("shows a payout on its way to ING with Mollie, and only the rest as a difference", async () => {
  mockLoggedIn();
  const mollie = moneyAccount({ accountCode: "1030", name: "Mollie", identifier: null, source: "mollie", ledgerCents: 13320, bank: { date: "2027-03-08", balanceCents: 3320 }, differenceCents: 0 });
  mockApi({ [`${base}/overview`]: overview({ moneyAccounts: [mollie], mollieDifferenceCents: 0, mollieInTransitCents: 10000 }) });
  const first = renderAt("/beheer/boekhouding");
  const item = await screen.findByRole("listitem", { name: "Mollie" });
  expect(item).toHaveTextContent("Onderweg naar ING € 100,00");
  expect(item).not.toHaveTextContent("verschil");
  expect(screen.queryByText(/Mollie wijkt/)).not.toBeInTheDocument();
  first.unmount();

  mockApi({ [`${base}/overview`]: overview({ moneyAccounts: [{ ...mollie, differenceCents: 250 }], mollieDifferenceCents: 250, mollieInTransitCents: 10000 }) });
  renderAt("/beheer/boekhouding");
  expect(await screen.findByRole("listitem", { name: "Mollie" })).toHaveTextContent("Onderweg naar ING € 100,00");
  expect(screen.getByRole("link", { name: `Mollie wijkt ${formatEuro(250)} af van de boekhouding` })).toBeInTheDocument();
});

it("shows until when ING is linked, always while ING betaal is automatic", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: withSource("enable_banking", soon(90)) });
  const first = renderAt("/beheer/boekhouding");
  expect(await screen.findByRole("listitem", { name: "ING betaalrekening" })).toHaveTextContent("ING gekoppeld tot 1-6-2027");
  expect(screen.queryByRole("link", { name: "Vernieuwen" })).not.toBeInTheDocument();
  first.unmount();

  for (const other of [withSource("file", soon(90)), withSource("enable_banking", soon(-1)), withSource("enable_banking")]) {
    mockApi({ [`${base}/overview`]: other });
    const page = renderAt("/beheer/boekhouding");
    await screen.findByRole("listitem", { name: "ING betaalrekening" });
    expect(screen.queryByText(/ING gekoppeld tot/)).not.toBeInTheDocument();
    page.unmount();
  }
});

it("says how many lines still to book are part of a difference", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: overview({ toBookByAccount: { "1020": 3, "1010": 2 } }) });
  const first = renderAt("/beheer/boekhouding");
  const kwartaal = await screen.findByRole("listitem", { name: "ING kwartaalrekening" });
  expect(kwartaal).toHaveTextContent("verschil € 10,00");
  expect(kwartaal).toHaveTextContent("waarvan nog te boeken: 3 regels");
  // No difference on ING betaal: nothing to explain.
  expect(screen.getByRole("listitem", { name: "ING betaalrekening" })).not.toHaveTextContent("waarvan");
  first.unmount();

  mockApi({ [`${base}/overview`]: overview({ toBookByAccount: { "1020": 1 } }) });
  renderAt("/beheer/boekhouding");
  expect(await screen.findByRole("listitem", { name: "ING kwartaalrekening" })).toHaveTextContent("waarvan nog te boeken: 1 regel");
});

it("asks to read in 2026 from e-Boekhouden first", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: overview({ eboekhoudenDone: false }) });
  renderAt("/beheer/boekhouding");
  const link = await screen.findByRole("link", { name: "Lees eerst 2026 in uit e-Boekhouden (Instellingen → Eenmalig). Tot dan boekt de app niets zelf." });
  expect(link).toHaveAttribute("href", "/beheer/boekhouding/eboekhouden-2026");
});

it("does not ask for the import once it is done", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: overview() });
  renderAt("/beheer/boekhouding");
  await screen.findByRole("link", { name: "Te boeken: 3" });
  expect(screen.queryByText(/Lees eerst 2026 in/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Plak Vaste activa 2026 opnieuw/)).not.toBeInTheDocument();
});

it("asks to paste the toestellen list again, with a link to Toestellen", async () => {
  mockLoggedIn();
  mockApi({ [`${base}/overview`]: overview({ assetsRepasteNeeded: true }) });
  renderAt("/beheer/boekhouding");
  expect(await screen.findByRole("link", { name: "Plak Vaste activa 2026 opnieuw bij Toestellen: de app neemt nu de stand van 1 januari 2026 over." })).toHaveAttribute("href", "/beheer/boekhouding/toestellen");
});
