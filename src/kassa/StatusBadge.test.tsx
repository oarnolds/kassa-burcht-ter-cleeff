import { screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { render, tap, user } from "../test-utils";
import { StatusBadge } from "./StatusBadge";
import { getDb } from "./store/db";
import { rejectedCount } from "./store/outbox";

const state = { online: true, pending: 0, rejected: 0, paired: true };

it("says online, and nothing else, when all is well", () => {
  render(<StatusBadge state={state} />);
  expect(screen.getByText("Online")).toBeInTheDocument();
  expect(screen.queryByText(/verzending|afgekeurd|ontkoppeld/)).not.toBeInTheDocument();
});

it("says that cash goes on while offline", () => {
  render(<StatusBadge state={{ ...state, online: false }} />);
  expect(screen.getByText("Offline · contant werkt door")).toBeInTheDocument();
  expect(screen.queryByText("Online")).not.toBeInTheDocument();
});

it("counts what waits and what was refused, in one or more", () => {
  const { rerender } = render(<StatusBadge state={{ ...state, pending: 1, rejected: 1 }} />);
  expect(screen.getByText("1 verkoop wacht op verzending")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "1 verkoop afgekeurd · bekijken" })).toBeInTheDocument();
  rerender(<StatusBadge state={{ ...state, pending: 12, rejected: 2 }} />);
  expect(screen.getByText("12 verkopen wachten op verzending")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "2 verkopen afgekeurd · bekijken" })).toBeInTheDocument();
});

const refuse = async (id: string, item: object, reason: string) =>
  (await getDb()).put("rejected", { id, item: { id, ...item }, reason, at: "2026-07-30T12:01:00.000Z" });

it("explains a refused reversal: the sale is still in the books", async () => {
  await refuse("r1", { kind: "reversal", soldAt: "2026-07-30T12:00:00.000Z", reversesSaleId: "s1" }, "too_late");
  const changed = vi.fn();
  render(<StatusBadge state={{ ...state, rejected: 1 }} onRejectedChange={changed} />);
  await tap("1 verkoop afgekeurd · bekijken");
  const dialog = within(await screen.findByRole("dialog", { name: "Afgekeurde verkopen" }));
  expect(await dialog.findByText("Terugboeking van 30-07-2026 14:00")).toBeInTheDocument();
  expect(dialog.getByText("Terugdraaien op de kassa kan tot vijf minuten na de verkoop.")).toBeInTheDocument();
  expect(dialog.getByText("Niet teruggeboekt. De verkoop staat nog in de boeken; de penningmeester kan hem in beheer terugdraaien.")).toBeInTheDocument();
  await user().click(dialog.getByRole("button", { name: "Doorgegeven" }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(await rejectedCount()).toBe(0);
});

it("lists every refused item, oldest first, and keeps the others when one is passed on", async () => {
  const line = { productId: "koffie", name: "Koffie", unitPriceCents: 140, qty: 1 };
  await refuse("s2", { kind: "sale", soldAt: "2026-07-30T13:00:00.000Z", totalCents: 140, cashGivenCents: null, lines: [line] }, "unknown_product");
  await refuse("s1", { kind: "sale", soldAt: "2026-07-30T12:30:00.000Z", totalCents: 280, cashGivenCents: null, lines: [{ ...line, qty: 2 }] }, "nieuw");
  render(<StatusBadge state={{ ...state, rejected: 2 }} />);
  await tap("2 verkopen afgekeurd · bekijken");
  const dialog = within(await screen.findByRole("dialog", { name: "Afgekeurde verkopen" }));
  const items = await dialog.findAllByRole("listitem");
  // formatEuro puts a non-breaking space after the euro sign.
  expect(items.map((item) => within(item).getByRole("heading").textContent?.replace(/\s/g, " "))).toEqual([
    "Verkoop van 30-07-2026 14:30 · € 2,80 contant",
    "Verkoop van 30-07-2026 15:00 · € 1,40 contant",
  ]);
  // A reason this version does not know yet is still shown as a refusal.
  expect(within(items[0]!).getByText("De server gaf geen reden die deze kassa kent.")).toBeInTheDocument();
  expect(within(items[1]!).getByText("Een product op de bon bestaat niet in beheer.")).toBeInTheDocument();
  await user().click(within(items[0]!).getByRole("button", { name: "Doorgegeven" }));
  await waitFor(() => expect(dialog.getAllByRole("button", { name: "Doorgegeven" })).toHaveLength(1));
  // The list does not jump up: the second tap of a double tap must not pass on the next one.
  const after = dialog.getAllByRole("listitem");
  expect(after).toHaveLength(2);
  expect(within(after[0]!).queryByRole("button")).not.toBeInTheDocument();
  expect(within(after[1]!).getByRole("button", { name: "Doorgegeven" })).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Afgekeurde verkopen" })).toBeInTheDocument();
  expect(await rejectedCount()).toBe(1);
});

it("explains an unpaired kassa and links to pairing", () => {
  render(<StatusBadge state={{ ...state, paired: false, pending: 3 }} />);
  expect(screen.getByText("Kassa is ontkoppeld. Vraag de penningmeester om een nieuwe koppelcode.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Opnieuw koppelen" })).toHaveAttribute("href", "/koppelen");
  expect(screen.getByText("3 verkopen wachten op verzending")).toBeInTheDocument();
  expect(screen.queryByText("Online")).not.toBeInTheDocument();
});
