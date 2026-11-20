import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { businessDate, monthOf } from "../../shared/time";
import type { MonthReport } from "../../shared/types";
import { calls, mockApi, mockLoggedIn, renderAt, rowIn } from "../test-utils";

const statiegeld = { qty: 40, cashCents: 600, pinCents: 0, totalCents: 600 };
const month: MonthReport = {
  month: "2026-07",
  totals: { cashCents: 660, pinCents: 0, totalCents: 660, saleCount: 3 },
  days: [
    { date: "2026-07-30", cashCents: 960, pinCents: 0, totalCents: 960, saleCount: 2 },
    { date: "2026-07-31", cashCents: -300, pinCents: 0, totalCents: -300, saleCount: 1 },
  ],
  byCategory: [{ categoryId: "statiegeld", categoryName: "Statiegeld", ...statiegeld }],
  byProduct: [{ productId: "statiegeld", name: "Statiegeld", categoryName: "Statiegeld", ...statiegeld }],
};

it("shows a month, with the pin total per day and both downloads", async () => {
  mockLoggedIn();
  mockApi({ "/api/admin/reports/month": month });
  renderAt("/beheer/rapporten?maand=2026-07");
  expect(await screen.findByRole("row", { name: /30-07-2026.*9,60.*0,00.*9,60.*2/ })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: /31-07-2026.*-€\s3,00/ })).toBeInTheDocument();
  expect(calls("GET").some((c) => c.url === "/api/admin/reports/month?month=2026-07")).toBe(true);
  expect(screen.getByRole("link", { name: "Download dagtotalen (CSV)" })).toHaveAttribute("href", "/api/admin/reports/month.csv?month=2026-07&kind=days");
  expect(screen.getByRole("link", { name: "Download losse verkopen (CSV)" })).toHaveAttribute("href", "/api/admin/reports/month.csv?month=2026-07&kind=sales");
  expect(screen.getByRole("link", { name: "30-07-2026" })).toHaveAttribute("href", "/beheer/rapporten?dag=2026-07-30");
  expect(rowIn("Per dag", "Hele maand").getAllByText("€ 6,60")).toHaveLength(2); // contant and total
  expect(rowIn("Per categorie", "Statiegeld").getByText("40")).toBeInTheDocument();
  expect(rowIn("Per product", "Statiegeld").getAllByText("€ 6,00")).toHaveLength(2);
});

it("shows one day per category and per product, split into contant and pin", async () => {
  mockLoggedIn();
  mockApi({ "/api/admin/reports/day": { date: "2026-07-30", totals: month.days[0], byCategory: month.byCategory, byProduct: month.byProduct } });
  renderAt("/beheer/rapporten?dag=2026-07-30");
  expect(await screen.findByRole("heading", { name: "30-07-2026" })).toBeInTheDocument();
  expect(await screen.findAllByRole("row", { name: /Statiegeld.*40.*6,00.*0,00.*6,00/ })).toHaveLength(2); // one category row, one product row
  expect(calls("GET").some((c) => c.url === "/api/admin/reports/day?date=2026-07-30")).toBe(true);
  expect(screen.getByRole("link", { name: "Bekijk de verkopen van deze dag" })).toHaveAttribute("href", "/beheer/verkopen?datum=2026-07-30");
  expect(screen.getByRole("link", { name: "Terug naar de maand" })).toHaveAttribute("href", "/beheer/rapporten?maand=2026-07");
});

it("opens on the current month", async () => {
  const now = monthOf(businessDate(new Date().toISOString()));
  mockLoggedIn();
  mockApi({ "/api/admin/reports/month": { ...month, month: now } });
  renderAt("/beheer/rapporten");
  await waitFor(() => expect(calls("GET").some((c) => c.url === `/api/admin/reports/month?month=${now}`)).toBe(true));
});

it("goes to another month with the month field", async () => {
  mockLoggedIn();
  mockApi({ "/api/admin/reports/month": month });
  renderAt("/beheer/rapporten?maand=2026-07");
  fireEvent.change(await screen.findByLabelText("Maand"), { target: { value: "2026-06" } });
  await waitFor(() => expect(calls("GET").some((c) => c.url === "/api/admin/reports/month?month=2026-06")).toBe(true));
});

it("says so when a month has no sales", async () => {
  mockLoggedIn();
  mockApi({ "/api/admin/reports/month": { month: "2026-01", totals: { cashCents: 0, pinCents: 0, totalCents: 0, saleCount: 0 }, days: [], byCategory: [], byProduct: [] } });
  renderAt("/beheer/rapporten?maand=2026-01");
  expect(await screen.findByText("Geen verkopen in deze maand.")).toBeInTheDocument();
});
