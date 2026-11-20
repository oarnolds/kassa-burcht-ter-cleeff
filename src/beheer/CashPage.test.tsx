import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { businessDate, formatDateNl, localTime } from "../../shared/time";
import type { CashState, Handover } from "../../shared/types";
import { calls, mockApi, mockLoggedIn, renderAt, tap } from "../test-utils";

const opening: Handover = {
  id: "h0",
  kind: "opening",
  countedAt: "2026-07-01T08:00:00.000Z",
  expectedCents: 0,
  receivedCents: 0,
  leftCents: 5000,
  differenceCents: 0,
  note: null,
  createdAt: "2026-07-01T08:00:00.000Z",
};
const july: Handover = {
  id: "h1",
  kind: "handover",
  countedAt: "2026-07-31T16:00:00.000Z",
  expectedCents: 5470,
  receivedCents: 400,
  leftCents: 5000,
  differenceCents: 70,
  note: "blikje gesneuveld",
  createdAt: "2026-07-31T18:00:00.000Z",
};
const open = (state: CashState, answer: unknown = [201, july]) => {
  mockLoggedIn();
  mockApi({ "/api/admin/cash": state, "POST /api/admin/cash/handovers": answer });
  renderAt("/beheer/kluisje");
};

const fillIn = async () => {
  await userEvent.type(await screen.findByLabelText("Ontvangen"), "4");
  await userEvent.type(screen.getByLabelText("Achtergebleven als wisselgeld"), "50,00");
};

it("shows what should be in the cash box", async () => {
  open({ expectedCents: 5470, handovers: [opening] });
  expect(await screen.findByRole("heading", { name: "Kluisje" })).toBeInTheDocument();
  expect(await screen.findByText("In het kluisje hoort nu")).toBeInTheDocument();
  expect(screen.getByText("€ 54,70")).toBeInTheDocument();
});

it("asks for an opening amount first", async () => {
  open({ expectedCents: 0, handovers: [] });
  expect(await screen.findByRole("heading", { name: "Beginbedrag vastleggen" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Afdracht vastleggen" })).not.toBeInTheDocument();
  await userEvent.type(await screen.findByLabelText("Bedrag in het kluisje"), "50");
  await tap("Vastleggen");
  // Nothing is recorded before the amount has been read back.
  expect(within(screen.getByRole("dialog", { name: "Beginbedrag vastleggen?" })).getByText("€ 50,00")).toBeInTheDocument();
  expect(calls("POST")).toHaveLength(0);
  await tap("Ja, vastleggen");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  const body = calls("POST")[0]!.body as { countedAt: string };
  expect(body).toMatchObject({ kind: "opening", receivedCents: 0, leftCents: 5000 });
  expect(new Date(body.countedAt).toISOString()).toBe(body.countedAt);
});

it("shows the difference while typing, posts cents, then shows the recorded difference", async () => {
  open({ expectedCents: 5470, handovers: [opening] });
  await fillIn();
  expect(screen.getByText("Verschil: € 0,70")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Toelichting"), "blikje gesneuveld");
  await tap("Afdracht vastleggen");
  await tap("Ja, vastleggen");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  const body = calls("POST")[0]!.body as { countedAt: string };
  expect(calls("POST")[0]!.url).toBe("/api/admin/cash/handovers");
  expect(body).toMatchObject({ kind: "handover", receivedCents: 400, leftCents: 5000, note: "blikje gesneuveld" });
  expect(new Date(body.countedAt).toISOString()).toBe(body.countedAt);
  expect(Math.abs(Date.parse(body.countedAt) - Date.now())).toBeLessThan(60_000); // "now" unless another moment is chosen
  expect(await screen.findByText("Vastgelegd. Verschil: € 0,70")).toBeInTheDocument();
  // The form is ready for the next time and the page has asked the server how things stand now.
  expect(screen.getByLabelText("Ontvangen")).toHaveValue("");
  await waitFor(() => expect(calls("GET").filter((c) => c.url === "/api/admin/cash")).toHaveLength(2));
});

it("reads a handover back before recording it, and records nothing on Terug", async () => {
  open({ expectedCents: 5470, handovers: [opening] });
  await fillIn();
  fireEvent.change(screen.getByLabelText("Kluisje geleegd op"), { target: { value: "2026-07-31T18:00" } });
  await tap("Afdracht vastleggen");
  const dialog = within(screen.getByRole("dialog", { name: "Afdracht vastleggen?" }));
  // The moment as the history will show it (the field is in the clock of whoever is typing).
  const emptied = new Date("2026-07-31T18:00").toISOString();
  expect(dialog.getByText(`${formatDateNl(businessDate(emptied))} ${localTime(emptied)}`)).toBeInTheDocument();
  expect(dialog.getByText("€ 4,00")).toBeInTheDocument();
  expect(dialog.getByText("€ 50,00")).toBeInTheDocument();
  expect(dialog.getByText("Een vastgelegde afdracht kan niet meer worden gewijzigd.")).toBeInTheDocument();
  await userEvent.click(dialog.getByRole("button", { name: "Terug" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calls("POST")).toHaveLength(0);
  // What was typed is still there, to be corrected.
  expect(screen.getByLabelText("Ontvangen")).toHaveValue("4");
});

it("says whether money is short or left over", async () => {
  open({ expectedCents: 5470, handovers: [opening] });
  await fillIn();
  expect(screen.getByText("Er zit minder in dan verwacht.")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Ontvangen"), "0"); // 40 euro received
  expect(screen.getByText("Verschil: -€ 35,30")).toBeInTheDocument();
  expect(screen.getByText("Er zit meer in dan verwacht.")).toBeInTheDocument();
});

it("counts a chosen minute up to its end, so a sale in that minute belongs to the handover", async () => {
  open({ expectedCents: 5470, handovers: [opening] });
  await fillIn();
  fireEvent.change(screen.getByLabelText("Kluisje geleegd op"), { target: { value: "2026-07-31T18:00" } });
  await tap("Afdracht vastleggen");
  await tap("Ja, vastleggen");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect((calls("POST")[0]!.body as { countedAt: string }).countedAt).toBe(new Date(new Date("2026-07-31T18:00").getTime() + 59_999).toISOString());
});

it("does not post while an amount is unreadable", async () => {
  open({ expectedCents: 5470, handovers: [opening] });
  await userEvent.type(await screen.findByLabelText("Ontvangen"), "abc");
  expect(screen.getByRole("button", { name: "Afdracht vastleggen" })).toBeDisabled();
  expect(screen.queryByText(/^Verschil:/)).not.toBeInTheDocument();
});

it.each([
  ["counted_before_last", "Dit moment ligt voor de vorige afdracht."],
  ["counted_in_future", "Dit moment ligt in de toekomst."],
])("explains the refusal %s and keeps what was typed", async (code, text) => {
  open({ expectedCents: 5470, handovers: [opening] }, [400, { error: code }]);
  await fillIn();
  await tap("Afdracht vastleggen");
  await tap("Ja, vastleggen");
  expect(await screen.findByText(text)).toBeInTheDocument();
  expect(screen.getByLabelText("Ontvangen")).toHaveValue("4");
});

it("lists earlier handovers with their difference and note", async () => {
  open({ expectedCents: 5000, handovers: [july, opening] });
  expect(await screen.findByRole("row", { name: /31-07-2026.*54,70.*4,00.*50,00.*0,70.*blikje gesneuveld/ })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: /01-07-2026.*50,00.*Beginbedrag/ })).toBeInTheDocument();
  for (const column of ["Geleegd op", "Verwacht", "Ontvangen", "Achtergebleven", "Verschil", "Toelichting"]) {
    expect(screen.getByRole("columnheader", { name: column })).toBeInTheDocument();
  }
});
