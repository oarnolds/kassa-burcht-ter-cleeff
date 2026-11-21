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
  possiblyDouble: false,
  lines: [
    { name: "Aardbeitje", categoryName: "IJs", unitPriceCents: 110, qty: 2 },
    { name: "Koffie", categoryName: "Warme dranken", unitPriceCents: 140, qty: 1 },
  ],
  ...o,
});

const openDialog = async (sales: AdminSale[], reverse: unknown = [201, { id: "r1" }]) => {
  mockLoggedIn();
  mockApi({ "/api/admin/sales": { sales, pinAttempts: [] }, [`POST /api/admin/sales/${sales[0]!.id}/reverse`]: reverse });
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
      pinAttempts: [],
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
  mockApi({ "/api/admin/sales": { sales: [sale(), sale({ method: "pin", totalCents: 140, soldAtLocal: "12:05", lines: [{ name: "Koffie", categoryName: "Warme dranken", unitPriceCents: 140, qty: 1 }] })], pinAttempts: [] } });
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
  mockApi({ "/api/admin/sales": { sales: [], pinAttempts: [] } });
  renderAt("/beheer/verkopen");
  expect(await screen.findByText("Geen verkopen op deze dag.")).toBeInTheDocument();
  expect(calls("GET").some((c) => c.url === `/api/admin/sales?date=${today}`)).toBe(true);
  fireEvent.change(screen.getByLabelText("Datum"), { target: { value: "2026-07-29" } });
  await waitFor(() => expect(calls("GET").some((c) => c.url === "/api/admin/sales?date=2026-07-29")).toBe(true));
});

// Pin (fase 2)

const DOUBLE = "Er is contant afgerekend en de pinbetaling is daarna toch gelukt. Draai één van de twee terug.";

it("marks a receipt that may have been paid twice", async () => {
  mockLoggedIn();
  mockApi({
    "/api/admin/sales": { sales: [sale({ possiblyDouble: true }), sale({ method: "pin", possiblyDouble: true }), sale({ soldAtLocal: "12:10" })], pinAttempts: [] },
  });
  renderAt("/beheer/verkopen?datum=2026-07-30");
  const cards = await screen.findAllByRole("article");
  expect(within(cards[0]!).getByText("Mogelijk dubbel betaald")).toHaveAttribute("title", DOUBLE);
  expect(within(cards[1]!).getByText("Mogelijk dubbel betaald")).toBeInTheDocument();
  expect(within(cards[2]!).queryByText("Mogelijk dubbel betaald")).not.toBeInTheDocument();
  // Either of the two can be reversed.
  expect(within(cards[0]!).getByRole("button", { name: "Terugdraaien" })).toBeInTheDocument();
  expect(within(cards[1]!).getByRole("button", { name: "Terugdraaien" })).toBeInTheDocument();
});

it("shows pin attempts that did not go through apart from the sales, without a way to reverse them", async () => {
  mockLoggedIn();
  mockApi({
    "/api/admin/sales": {
      sales: [],
      pinAttempts: [
        { id: "a", soldAtLocal: "14:32", totalCents: 360, outcome: null, reason: null, lines: [{ name: "Aardbeitje", categoryName: "IJs", unitPriceCents: 110, qty: 2 }, { name: "Koffie", categoryName: "Warme dranken", unitPriceCents: 140, qty: 1 }] },
        { id: "b", soldAtLocal: "14:40", totalCents: 110, outcome: "declined", reason: "insufficient_funds", lines: [] },
        { id: "c", soldAtLocal: "14:41", totalCents: 110, outcome: "canceled", reason: null, lines: [] },
        { id: "d", soldAtLocal: "14:42", totalCents: 110, outcome: "expired", reason: null, lines: [] },
        { id: "e", soldAtLocal: "14:43", totalCents: 110, outcome: "start_failed", reason: "no_answer", lines: [] },
      ],
    },
  });
  renderAt("/beheer/verkopen?datum=2026-07-30");
  const region = within(await screen.findByRole("region", { name: "Pin: niet gelukt of nog open" }));
  expect(region.getByText("Deze pinbetalingen tellen niet mee in de omzet.")).toBeInTheDocument();
  const rows = region.getAllByRole("listitem");
  expect(rows).toHaveLength(5);
  expect(within(rows[0]!).getByText("14:32")).toBeInTheDocument();
  expect(within(rows[0]!).getByText("€ 3,60")).toBeInTheDocument();
  expect(within(rows[0]!).getByText("2 × Aardbeitje, 1 × Koffie")).toBeInTheDocument();
  expect(within(rows[0]!).getByText("Wacht op bevestiging")).toBeInTheDocument();
  expect(within(rows[1]!).getByText("Geweigerd")).toBeInTheDocument();
  expect(within(rows[2]!).getByText("Geannuleerd")).toBeInTheDocument();
  expect(within(rows[3]!).getByText("Verlopen")).toBeInTheDocument();
  expect(within(rows[4]!).getByText("Niet gestart")).toBeInTheDocument();
  expect(region.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.queryByText("Geen verkopen op deze dag.")).not.toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument(); // none of them is a sale
});

it("lists pin attempts under the sales of the day, and leaves the section out when there are none", async () => {
  mockLoggedIn();
  mockApi({ "/api/admin/sales": { sales: [sale()], pinAttempts: [{ id: "b", soldAtLocal: "14:40", totalCents: 110, outcome: "declined", reason: null, lines: [] }] } });
  const first = renderAt("/beheer/verkopen?datum=2026-07-30");
  const card = await screen.findByRole("article");
  const region = screen.getByRole("region", { name: "Pin: niet gelukt of nog open" });
  expect(card.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  first.unmount();
  mockApi({ "/api/admin/sales": { sales: [sale()], pinAttempts: [] } });
  renderAt("/beheer/verkopen?datum=2026-07-30");
  await screen.findByRole("article");
  expect(screen.queryByRole("region", { name: "Pin: niet gelukt of nog open" })).not.toBeInTheDocument();
});

it("says a pin sale is reversed for the whole amount, after refunding at Mollie", async () => {
  const dialog = await openDialog([sale({ method: "pin" })]);
  expect(dialog.getByText(/Betaal het bedrag eerst terug in het Mollie-dashboard\. De kassa doet dat niet\./)).toBeInTheDocument();
  expect(dialog.getByText(/Terugdraaien kan alleen voor het hele bedrag\./)).toBeInTheDocument();
});

it("says nothing about Mollie when a cash sale is reversed", async () => {
  const dialog = await openDialog([sale()]);
  expect(dialog.queryByText(/Mollie/)).not.toBeInTheDocument();
  expect(dialog.queryByText(/hele bedrag/)).not.toBeInTheDocument();
});

it("explains that a failed pin payment cannot be reversed", async () => {
  const dialog = await openDialog([sale({ method: "pin" })], [409, { error: "not_paid" }]);
  await userEvent.type(dialog.getByLabelText("Reden"), "klant betaalde niet");
  await userEvent.click(dialog.getByRole("button", { name: "Terugdraaien" }));
  expect(await screen.findByText("Deze pinbetaling is niet gelukt en kan niet worden teruggedraaid.")).toBeInTheDocument();
});
