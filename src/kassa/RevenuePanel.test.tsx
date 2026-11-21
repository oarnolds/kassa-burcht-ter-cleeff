import { screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { weekRange } from "../../shared/time";
import { catalog, mockApi, mockOffline, renderAt, tap } from "../test-utils";
import { saveCatalog } from "./store/catalog";
import { setMeta } from "./store/db";

const totals = (cents: number, saleCount: number) => ({ cashCents: cents, pinCents: 0, totalCents: cents, saleCount });
const ijs = (qty: number) => ({
  byCategory: [{ categoryId: "ijs", categoryName: "IJs", qty, cashCents: 110 * qty, pinCents: 0, totalCents: 110 * qty }],
  byProduct: [{ productId: "aardbeitje", name: "Aardbeitje", categoryName: "IJs", qty, cashCents: 110 * qty, pinCents: 0, totalCents: 110 * qty }],
});
const nothing = { totals: totals(0, 0), byCategory: [], byProduct: [] };

// Thursday 30 July 2026 is today; its week runs from Monday the 27th to Sunday 2 August.
const days: Record<string, unknown> = {
  "2026-07-30": { date: "2026-07-30", totals: totals(330, 2), ...ijs(3) },
  "2026-07-29": { date: "2026-07-29", ...nothing },
  "2026-07-27": { date: "2026-07-27", totals: totals(110, 1), ...ijs(1) },
};
const weeks: Record<string, unknown> = {
  "2026-07-27": {
    first: "2026-07-27",
    last: "2026-08-02",
    totals: totals(440, 3),
    days: [
      { date: "2026-07-27", ...totals(110, 1) },
      { date: "2026-07-30", ...totals(330, 2) },
    ],
    ...ijs(4),
  },
  "2026-07-20": { first: "2026-07-20", last: "2026-07-26", days: [], ...nothing },
};
const dateOf = (url: string) => new URL(url, "http://kassa").searchParams.get("date") ?? "";
const server = {
  "/api/kassa/catalog": catalog,
  "/api/kassa/reports/day": (req: { url: string }) => days[dateOf(req.url)] ?? [400, { error: "invalid" }],
  "/api/kassa/reports/week": (req: { url: string }) => weeks[weekRange(dateOf(req.url)).first] ?? [400, { error: "invalid" }],
};

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-07-30T10:00:00.000Z"));
  await setMeta("deviceToken", "tok");
  await saveCatalog(catalog);
});

const panel = () => within(screen.getByRole("dialog", { name: "Omzet" }));
const open = async () => {
  renderAt("/");
  await tap("Omzet");
};

it("shows today's revenue on the kassa, with the tables of beheer and without downloads", async () => {
  mockApi(server);
  await open();
  expect(await panel().findByRole("heading", { name: "Vandaag · donderdag 30-07-2026" })).toBeInTheDocument();
  expect(await panel().findByText("contant € 3,30")).toBeInTheDocument();
  expect(panel().getByText("2 verkopen")).toBeInTheDocument();
  expect(within(panel().getByRole("region", { name: "Per categorie" })).getByRole("row", { name: /IJs 3 €\s3,30/ })).toBeInTheDocument();
  expect(within(panel().getByRole("region", { name: "Per product" })).getByRole("row", { name: /Aardbeitje 3 €\s3,30/ })).toBeInTheDocument();
  expect(document.querySelector("a[download], a[href$='.csv'], a[href$='.json']")).toBeNull();
  expect(screen.queryByText(/download/i)).not.toBeInTheDocument();
});

it("shows the week from Monday to Sunday with its days, and opens a day from it", async () => {
  mockApi(server);
  await open();
  await tap("Week");
  expect(await panel().findByRole("heading", { name: "Deze week · 27-07-2026 t/m 02-08-2026" })).toBeInTheDocument();
  expect(await panel().findByText("contant € 4,40")).toBeInTheDocument();
  const perDay = within(panel().getByRole("region", { name: "Per dag" }));
  expect(perDay.getByRole("row", { name: /27-07-2026 €\s1,10/ })).toBeInTheDocument();
  expect(perDay.getByRole("row", { name: /30-07-2026 €\s3,30/ })).toBeInTheDocument();
  expect(perDay.getByRole("row", { name: /Hele week €\s4,40/ })).toBeInTheDocument();
  await tap("27-07-2026");
  expect(await panel().findByRole("heading", { name: "maandag 27-07-2026" })).toBeInTheDocument();
  expect(await panel().findByText("contant € 1,10")).toBeInTheDocument();
});

it("goes back to earlier days and weeks, and not past today", async () => {
  mockApi(server);
  await open();
  await panel().findByText("contant € 3,30");
  expect(panel().getByRole("button", { name: "Volgende dag" })).toBeDisabled();
  await tap("Vorige dag");
  expect(await panel().findByRole("heading", { name: "woensdag 29-07-2026" })).toBeInTheDocument();
  expect(await panel().findByText("Geen verkopen op deze dag.")).toBeInTheDocument();
  await tap("Volgende dag");
  expect(await panel().findByRole("heading", { name: "Vandaag · donderdag 30-07-2026" })).toBeInTheDocument();
  await tap("Week");
  await panel().findByText("contant € 4,40");
  expect(panel().getByRole("button", { name: "Volgende week" })).toBeDisabled();
  await tap("Vorige week");
  expect(await panel().findByRole("heading", { name: "20-07-2026 t/m 26-07-2026" })).toBeInTheDocument();
  expect(await panel().findByText("Geen verkopen in deze week.")).toBeInTheDocument();
});

it("says that sales still waiting on the iPad are not counted yet", async () => {
  mockApi({ ...server, "POST /api/kassa/sales": [500, { error: "server" }] });
  renderAt("/");
  await tap(/Aardbeitje/);
  await tap("Contant");
  await tap("Gepast");
  await screen.findByText("1 verkoop wacht op verzending");
  await tap("Omzet");
  expect(await panel().findByText("1 verkoop wacht nog op verzending en telt hier nog niet mee.")).toBeInTheDocument();
});

it("says so without a connection, and shows the figures once it is back", async () => {
  mockOffline();
  await open();
  expect(await panel().findByText("Geen verbinding. De omzet is te zien zodra er weer internet is.")).toBeInTheDocument();
  mockApi(server);
  await tap("Opnieuw proberen");
  expect(await panel().findByText("contant € 3,30")).toBeInTheDocument();
});

it("closes back to the kassa with the receipt as it was", async () => {
  mockApi(server);
  renderAt("/");
  await tap(/Koffie/);
  await tap("Omzet");
  await panel().findByText("contant € 3,30");
  await tap("Sluiten");
  expect(screen.queryByRole("dialog", { name: "Omzet" })).not.toBeInTheDocument();
  expect(screen.getByRole("listitem", { name: "Koffie" })).toBeInTheDocument();
});
