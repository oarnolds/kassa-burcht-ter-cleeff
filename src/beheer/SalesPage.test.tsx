import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { businessDate } from "../../shared/time";
import type { AdminSale } from "../../shared/types";
import { calls, mockApi, mockLoggedIn, renderAt } from "../test-utils";

const sale = (o: Partial<AdminSale> = {}): AdminSale => ({
  id: crypto.randomUUID(),
  method: "cash",
  totalCents: 360,
  soldAt: "2026-07-30T10:00:00.000Z",
  soldAtLocal: "12:00",
  businessDate: "2026-07-30",
  late: false,
  reversed: false,
  reversesSaleId: null,
  reversalReason: null,
  lines: [
    { name: "Aardbeitje", categoryName: "IJs", unitPriceCents: 110, qty: 2 },
    { name: "Koffie", categoryName: "Warme dranken", unitPriceCents: 140, qty: 1 },
  ],
  ...o,
});

const openDialog = async (sales: AdminSale[], reverse: unknown = [201, { id: "r1" }]) => {
  mockLoggedIn();
  mockApi({ "/api/admin/sales": { sales }, [`POST /api/admin/sales/${sales[0]!.id}/reverse`]: reverse });
  renderAt("/beheer/verkopen?datum=2026-07-30");
  await userEvent.click((await screen.findAllByRole("button", { name: "Terugdraaien" }))[0]!);
  return within(screen.getByRole("dialog"));
};

it("reverses a sale with a reason", async () => {
  const s = sale();
  const dialog = await openDialog([s, sale({ totalCents: 600 })]);
  expect(dialog.getByLabelText("Reden")).toHaveFocus(); // ready to type
  await userEvent.click(dialog.getByRole("button", { name: "Terugdraaien" }));
  expect(await screen.findByText("Vul een reden in.")).toBeInTheDocument();
  expect(calls("POST")).toHaveLength(0);
  await userEvent.type(dialog.getByLabelText("Reden"), "dubbel aangeslagen");
  await userEvent.click(dialog.getByRole("button", { name: "Terugdraaien" }));
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({ url: `/api/admin/sales/${s.id}/reverse`, body: { reason: "dubbel aangeslagen" } });
  expect(await screen.findByText("Verkoop teruggedraaid")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(calls("GET").filter((c) => c.url.startsWith("/api/admin/sales"))).toHaveLength(2)); // the list is fetched again
});

it("explains why a closed sale cannot be reversed", async () => {
  const dialog = await openDialog([sale()], [409, { error: "closed_by_handover" }]);
  await userEvent.type(dialog.getByLabelText("Reden"), "te laat");
  await userEvent.click(dialog.getByRole("button", { name: "Terugdraaien" }));
  expect(await screen.findByText("Deze verkoop zit al in een afdracht en kan niet meer worden teruggedraaid.")).toBeInTheDocument();
});

it("explains a sale that was reversed in the meantime", async () => {
  const dialog = await openDialog([sale()], [409, { error: "already_reversed" }]);
  await userEvent.type(dialog.getByLabelText("Reden"), "dubbel");
  await userEvent.click(dialog.getByRole("button", { name: "Terugdraaien" }));
  expect(await screen.findByText("Deze verkoop is al teruggedraaid.")).toBeInTheDocument();
});

it("marks reversed, late and counter-entry sales, and offers a reversal only where one is possible", async () => {
  mockLoggedIn();
  mockApi({
    "/api/admin/sales": {
      sales: [sale({ reversed: true }), sale({ late: true }), sale({ totalCents: -360, reversesSaleId: "x", reversalReason: "dubbel aangeslagen" })],
    },
  });
  renderAt("/beheer/verkopen?datum=2026-07-30");
  expect(await screen.findByText("Teruggedraaid")).toBeInTheDocument();
  expect(screen.getByText("Nagekomen")).toBeInTheDocument();
  expect(screen.getByText("Tegenboeking")).toBeInTheDocument();
  expect(screen.getByText("dubbel aangeslagen")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Terugdraaien" })).toHaveLength(1); // only on the late sale
});

it("warns that a pin refund happens at Mollie", async () => {
  const dialog = await openDialog([sale({ method: "pin" })]);
  expect(dialog.getByText("Betaal het bedrag eerst terug in het Mollie-dashboard. De kassa doet dat niet.")).toBeInTheDocument();
});

it("shows each sale with its time, way of paying, lines and total", async () => {
  mockLoggedIn();
  mockApi({ "/api/admin/sales": { sales: [sale(), sale({ method: "pin", totalCents: 140, soldAtLocal: "12:05", lines: [{ name: "Koffie", categoryName: "Warme dranken", unitPriceCents: 140, qty: 1 }] })] } });
  renderAt("/beheer/verkopen?datum=2026-07-30");
  const first = within((await screen.findAllByRole("article"))[0]!);
  expect(first.getByText("12:00")).toBeInTheDocument();
  expect(first.getByText("Contant")).toBeInTheDocument();
  expect(first.getByText("€ 3,60")).toBeInTheDocument();
  expect(first.getByText("2 × Aardbeitje")).toBeInTheDocument();
  expect(within(screen.getAllByRole("article")[1]!).getByText("Pin")).toBeInTheDocument();
  expect(calls("GET").some((c) => c.url === "/api/admin/sales?date=2026-07-30")).toBe(true);
});

it("opens on today and follows the date field", async () => {
  const today = businessDate(new Date().toISOString());
  mockLoggedIn();
  mockApi({ "/api/admin/sales": { sales: [] } });
  renderAt("/beheer/verkopen");
  expect(await screen.findByText("Geen verkopen op deze dag.")).toBeInTheDocument();
  expect(calls("GET").some((c) => c.url === `/api/admin/sales?date=${today}`)).toBe(true);
  fireEvent.change(screen.getByLabelText("Datum"), { target: { value: "2026-07-29" } });
  await waitFor(() => expect(calls("GET").some((c) => c.url === "/api/admin/sales?date=2026-07-29")).toBe(true));
});
