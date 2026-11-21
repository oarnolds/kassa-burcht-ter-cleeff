import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Device, PinSettings, PinTerminal } from "../../shared/types";
import { calls, mockApi, mockLoggedIn, mockOffline, renderAt, tap, user } from "../test-utils";

const device: Device = { id: "d1", name: "iPad kiosk", createdAt: "2026-07-01T08:00:00.000Z", lastSeenAt: "2026-07-30T10:00:00.000Z", revoked: false };
const open = async (extra: Record<string, unknown> = {}) => {
  mockLoggedIn();
  mockApi({
    "/api/admin/devices": { devices: [device] },
    "/api/admin/wipe-trial": { inUseSince: null },
    "/api/admin/backups": { available: true, latest: null, count: 0 },
    "/api/admin/pin": { mode: "test", terminalId: null, terminals: [], problem: null },
    ...extra,
  });
  renderAt("/beheer/instellingen");
  await screen.findByText("iPad kiosk");
  await screen.findByRole("heading", { name: "Proefgegevens wissen" });
  await waitFor(() => expect(screen.queryByText("Laden…")).not.toBeInTheDocument());
};
const code = { "POST /api/admin/pairing-codes": [201, { code: "482913", expiresAt: "2026-07-30T10:10:00.000Z" }] };

it("shows a new pairing code", async () => {
  await open(code);
  expect(screen.getByRole("heading", { name: "Instellingen" })).toBeInTheDocument();
  await tap("Nieuwe koppelcode");
  expect(await screen.findByText("Koppelcode: 482913")).toBeInTheDocument();
  expect(screen.getByText("10 minuten geldig. Open de kassa op de iPad en vul deze code in.")).toBeInTheDocument();
});

it("shows the kassa in the list once it has been paired with the code", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  await open(code);
  await user().click(screen.getByRole("button", { name: "Nieuwe koppelcode" }));
  await screen.findByText("Koppelcode: 482913");
  mockApi({ "/api/admin/devices": { devices: [device, { ...device, id: "d2", name: "iPad terras", lastSeenAt: null }] } });
  await act(() => vi.advanceTimersByTimeAsync(5_000));
  expect(await screen.findByText("iPad terras")).toBeInTheDocument();
});

it("says when each kassa was last seen, and which are unpaired", async () => {
  await open({
    "/api/admin/devices": {
      devices: [device, { ...device, id: "d2", name: "iPad terras", lastSeenAt: null }, { ...device, id: "d3", name: "Oude iPad", revoked: true }],
    },
  });
  const rows = within(screen.getByRole("region", { name: "Kassa koppelen" })).getAllByRole("listitem");
  expect(within(rows[0]!).getByText("Laatst gezien 30-07-2026 12:00")).toBeInTheDocument();
  expect(within(rows[1]!).getByText("Nog niet gebruikt")).toBeInTheDocument();
  expect(within(rows[2]!).getByText("Ontkoppeld")).toBeInTheDocument();
  expect(within(rows[2]!).queryByRole("button", { name: "Ontkoppel" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Ontkoppel" })).toHaveLength(2);
});

it("unpairs a device after confirmation", async () => {
  await open({ "POST /api/admin/devices/d1/revoke": { ok: true } });
  await tap("Ontkoppel");
  expect(calls("POST")).toHaveLength(0);
  expect(screen.getByText("iPad kiosk ontkoppelen? De kassa werkt dan niet meer tot hij opnieuw is gekoppeld.")).toBeInTheDocument();
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Ontkoppel" }));
  await waitFor(() => expect(calls("POST")[0]?.url).toBe("/api/admin/devices/d1/revoke"));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(calls("GET").filter((c) => c.url === "/api/admin/devices")).toHaveLength(2));
});

it("leaves the kassa paired when the question is answered with no", async () => {
  await open();
  await tap("Ontkoppel");
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Annuleren" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calls("POST")).toHaveLength(0);
});

it("wipes trial data only after the word is typed", async () => {
  await open({ "POST /api/admin/wipe-trial": { ok: true } });
  const button = screen.getByRole("button", { name: "Proefgegevens wissen" });
  const field = screen.getByLabelText("Typ WISSEN om te bevestigen");
  expect(
    screen.getByText(
      "Wist alle verkopen, afdrachten, bestellingen en voorraadmutaties. Producten, instellingen en de koppeling met de iPad blijven staan. Dit kan niet ongedaan worden gemaakt.",
    ),
  ).toBeInTheDocument();
  expect(button).toBeDisabled();
  await userEvent.type(field, "wissen");
  expect(button).toBeDisabled();
  await userEvent.clear(field);
  await userEvent.type(field, "WISSEN");
  await userEvent.click(button);
  await waitFor(() => expect(calls("POST")[0]).toMatchObject({ url: "/api/admin/wipe-trial", body: { confirm: "WISSEN", final: false } }));
  expect(await screen.findByText("Proefgegevens gewist.")).toBeInTheDocument();
  expect(field).toHaveValue(""); // a second wipe needs the word again
  expect(button).toBeDisabled();
});

const IN_USE = "De kassa is in gebruik sinds 01-08-2026. Wissen kan niet meer: wat er nu in staat is de echte administratie.";

it("locks wiping when this is the ingebruikname", async () => {
  await open({
    "POST /api/admin/wipe-trial": () => {
      mockApi({ "/api/admin/wipe-trial": { inUseSince: "2026-08-01T07:00:00.000Z" } });
      return { ok: true };
    },
  });
  await userEvent.click(screen.getByRole("checkbox", { name: "Dit is de ingebruikname: hierna kan wissen niet meer" }));
  await userEvent.type(screen.getByLabelText("Typ WISSEN om te bevestigen"), "WISSEN");
  await tap("Proefgegevens wissen");
  await waitFor(() => expect(calls("POST")[0]).toMatchObject({ url: "/api/admin/wipe-trial", body: { confirm: "WISSEN", final: true } }));
  expect(await screen.findByText(IN_USE)).toBeInTheDocument();
  expect(screen.getByText("Proefgegevens gewist.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Proefgegevens wissen" })).not.toBeInTheDocument();
});

it("offers no wipe once the kassa is in use", async () => {
  await open({ "/api/admin/wipe-trial": { inUseSince: "2026-08-01T07:00:00.000Z" } });
  expect(screen.getByText(IN_USE)).toBeInTheDocument();
  expect(screen.queryByLabelText("Typ WISSEN om te bevestigen")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Proefgegevens wissen" })).not.toBeInTheDocument();
});

it("says so when the server refuses a wipe because the kassa went into use meanwhile", async () => {
  await open({
    "POST /api/admin/wipe-trial": () => {
      mockApi({ "/api/admin/wipe-trial": { inUseSince: "2026-08-01T07:00:00.000Z" } });
      return [409, { error: "in_use", inUseSince: "2026-08-01T07:00:00.000Z" }];
    },
  });
  await userEvent.type(screen.getByLabelText("Typ WISSEN om te bevestigen"), "WISSEN");
  await tap("Proefgegevens wissen");
  expect(await screen.findByText(IN_USE)).toBeInTheDocument();
  expect(screen.queryByText("Proefgegevens gewist.")).not.toBeInTheDocument();
});

it("changes the password", async () => {
  await open({ "POST /api/admin/password": { ok: true } });
  await userEvent.type(screen.getByLabelText("Huidig wachtwoord"), "oud-wachtwoord-1");
  await userEvent.type(screen.getByLabelText("Nieuw wachtwoord"), "nieuw-wachtwoord-1");
  await tap("Wijzigen");
  await waitFor(() => expect(calls("POST")[0]).toMatchObject({ url: "/api/admin/password", body: { current: "oud-wachtwoord-1", next: "nieuw-wachtwoord-1" } }));
  expect(await screen.findByText("Wachtwoord gewijzigd.")).toBeInTheDocument();
  expect(screen.getByLabelText("Huidig wachtwoord")).toHaveValue("");
});

it("says so when the current password is wrong, and stays on the page", async () => {
  await open({ "POST /api/admin/password": [401, { error: "unauthorized" }] });
  await userEvent.type(screen.getByLabelText("Huidig wachtwoord"), "fout-wachtwoord");
  await userEvent.type(screen.getByLabelText("Nieuw wachtwoord"), "nieuw-wachtwoord-1");
  await tap("Wijzigen");
  expect(await screen.findByText("Huidig wachtwoord klopt niet.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Instellingen" })).toBeInTheDocument();
});

it("goes to login when the session ended while changing the password", async () => {
  await open({ "POST /api/admin/password": [401, { error: "unauthorized" }] });
  await userEvent.type(screen.getByLabelText("Huidig wachtwoord"), "oud-wachtwoord-1");
  await userEvent.type(screen.getByLabelText("Nieuw wachtwoord"), "nieuw-wachtwoord-1");
  mockApi({ "/api/admin/me": [401, { error: "unauthorized" }] });
  await tap("Wijzigen");
  expect(await screen.findByRole("heading", { name: "Inloggen" })).toBeInTheDocument();
});

it("does not send a new password that is too short", async () => {
  await open();
  await userEvent.type(screen.getByLabelText("Huidig wachtwoord"), "oud-wachtwoord-1");
  await userEvent.type(screen.getByLabelText("Nieuw wachtwoord"), "kort");
  await tap("Wijzigen");
  expect(await screen.findByText("Wachtwoord is te kort.")).toBeInTheDocument();
  expect(calls("POST")).toHaveLength(0);
});

it("links to the full download", async () => {
  await open();
  expect(screen.getByRole("link", { name: "Alles downloaden" })).toHaveAttribute("href", "/api/admin/export.json");
});


const copy = { key: "kassa-2026-07-27.json", at: "2026-07-27T03:00:05.000Z", sizeBytes: 1_250_000 };
const backups = () => within(screen.getByRole("region", { name: "Reservekopie" }));
const STALE = "De laatste kopie is ouder dan een week. Meld het aan de bouwer.";

it("shows when the last weekly copy was made", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-07-30T10:00:00.000Z"));
  await open({ "/api/admin/backups": { available: true, latest: copy, count: 12 } });
  expect(await backups().findByText("Laatste kopie: 27-07-2026 om 05:00")).toBeInTheDocument();
  expect(backups().queryByText(STALE)).not.toBeInTheDocument();
});

it("warns when the weekly copy has stopped coming", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-05T10:00:00.000Z"));
  await open({ "/api/admin/backups": { available: true, latest: copy, count: 12 } });
  expect(await backups().findByText(STALE)).toBeInTheDocument();
});

it("says so when no copy has been made yet, and makes one on request", async () => {
  await open({ "POST /api/admin/backups": { available: true, latest: { ...copy, key: "kassa-2026-07-30.json", at: "2026-07-30T10:00:00.000Z" }, count: 1 } });
  expect(await backups().findByText("Er is nog geen kopie gemaakt.")).toBeInTheDocument();
  await user().click(backups().getByRole("button", { name: "Nu een kopie maken" }));
  expect(await backups().findByText("Laatste kopie: 30-07-2026 om 12:00")).toBeInTheDocument();
  expect(backups().getByText("Kopie gemaakt.")).toBeInTheDocument();
  expect(calls("POST").map((call) => call.url)).toEqual(["/api/admin/backups"]);
});

it("says so when a copy could not be made", async () => {
  await open({ "POST /api/admin/backups": [500, { error: "server" }] });
  await user().click(backups().getByRole("button", { name: "Nu een kopie maken" }));
  expect(await backups().findByText("Een kopie maken is niet gelukt. Probeer het later opnieuw.")).toBeInTheDocument();
  expect(backups().getByText("Er is nog geen kopie gemaakt.")).toBeInTheDocument();
});

it("says so when the weekly copy is not switched on yet, and offers no button", async () => {
  await open({ "/api/admin/backups": { available: false, latest: null, count: 0 } });
  expect(await backups().findByText("De wekelijkse reservekopie staat nog niet aan: de opslag bij Cloudflare (R2) is nog niet ingeschakeld.")).toBeInTheDocument();
  expect(backups().queryByRole("button", { name: "Nu een kopie maken" })).not.toBeInTheDocument();
  expect(backups().queryByText("Er is nog geen kopie gemaakt.")).not.toBeInTheDocument();
});

// Pin via Mollie

const terminals: PinTerminal[] = [
  { id: "term_test", description: "Testterminal", status: "active", brand: "Tap", model: "Tap", serialNumber: null },
  { id: "term_oud", description: "Oude terminal", status: "inactive", brand: "PAX", model: "A920", serialNumber: "123" },
];
const pinSection = async () => within(await screen.findByRole("region", { name: "Pin via Mollie" }));
const pinWith = (over: Partial<PinSettings>): PinSettings => ({ mode: "test", terminalId: null, terminals, problem: null, ...over });
type TerminalRequest = { body: { terminalId: string } };

it("lets the penningmeester choose the Mollie terminal from Mollie's own list", async () => {
  let chosen: string | null = null;
  await open({
    "/api/admin/pin": () => pinWith({ terminalId: chosen }),
    "POST /api/admin/pin/terminal": (req: TerminalRequest) => {
      chosen = req.body.terminalId;
      return { ok: true };
    },
  });
  const section = await pinSection();
  expect(await section.findByText("Testmodus: betalingen zijn nagespeeld, er wordt geen geld afgeschreven.")).toBeInTheDocument();
  expect(section.getByText("Kies een betaalterminal. Tot die tijd is de knop Pin op de kassa uit.")).toBeInTheDocument();
  expect(section.getByRole("radiogroup", { name: "Betaalterminal" })).toBeInTheDocument();
  expect(section.getByRole("radio", { name: /Oude terminal.*niet actief/ })).toBeDisabled();
  expect(section.getByText("PAX · A920 · 123")).toBeInTheDocument();
  expect(section.getByText("Tap · Tap")).toBeInTheDocument();
  expect(section.queryByText("Gekozen")).not.toBeInTheDocument();
  expect(section.getByRole("button", { name: "Opslaan" })).toBeDisabled();
  await user().click(section.getByRole("radio", { name: /Testterminal/ }));
  await user().click(section.getByRole("button", { name: "Opslaan" }));
  expect(await section.findByText("Betaalterminal opgeslagen.")).toBeInTheDocument();
  expect(calls("POST").at(-1)).toMatchObject({ url: "/api/admin/pin/terminal", body: { terminalId: "term_test" } });
  expect(await section.findByText("Gekozen")).toBeInTheDocument();
  expect(section.getByRole("radio", { name: /Testterminal/ })).toBeChecked();
  expect(section.getByRole("button", { name: "Opslaan" })).toBeDisabled(); // nothing left to save
  expect(section.queryByText(/Kies een betaalterminal/)).not.toBeInTheDocument();
});

it("stands between pairing and the password", async () => {
  await open();
  const titles = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
  expect(titles.slice(0, 3)).toEqual(["Kassa koppelen", "Pin via Mollie", "Wachtwoord wijzigen"]);
});

it.each([
  ["no_key", null, "De sleutel van Mollie is nog niet ingesteld. In het handboek staat hoe de penningmeester dat doet."],
  ["unauthorized", "test", "Mollie accepteert de sleutel niet. Controleer de sleutel."],
  ["unreachable", "test", "Mollie is niet bereikbaar. Probeer het opnieuw."],
] as const)("explains %s", async (problem, mode, text) => {
  await open({ "/api/admin/pin": pinWith({ mode, terminals: [], problem }) });
  const section = await pinSection();
  expect(await section.findByText(text)).toBeInTheDocument();
  expect(section.queryByRole("radiogroup")).not.toBeInTheDocument();
  expect(section.queryByText(/Mollie geeft geen betaalterminal terug/)).not.toBeInTheDocument();
  expect(section.queryByRole("button", { name: "Opslaan" })).not.toBeInTheDocument();
  expect(section.queryAllByRole("button", { name: "Opnieuw proberen" })).toHaveLength(problem === "unreachable" ? 1 : 0);
});

it("asks Mollie again when it could not be reached", async () => {
  await open({ "/api/admin/pin": pinWith({ terminals: [], problem: "unreachable" }) });
  const section = await pinSection();
  mockApi({ "/api/admin/pin": pinWith({}) });
  await user().click(await section.findByRole("button", { name: "Opnieuw proberen" }));
  expect(await section.findByRole("radio", { name: /Testterminal/ })).toBeInTheDocument();
  expect(section.queryByText("Mollie is niet bereikbaar. Probeer het opnieuw.")).not.toBeInTheDocument();
});

it("says what to do when Mollie lists no terminal", async () => {
  await open();
  const section = await pinSection();
  expect(
    await section.findByText(
      "Mollie geeft geen betaalterminal terug. Zet in het Mollie-dashboard de betaalmethode Point of sale aan; in de testmodus verschijnt hier dan vanzelf een testterminal.",
    ),
  ).toBeInTheDocument();
  expect(section.queryByRole("radiogroup")).not.toBeInTheDocument();
  expect(section.queryByRole("button", { name: "Opslaan" })).not.toBeInTheDocument();
});

it("says real payments with a live key, and shows the terminal that was chosen", async () => {
  await open({ "/api/admin/pin": pinWith({ mode: "live", terminalId: "term_test" }) });
  const section = await pinSection();
  expect(await section.findByText("Echte betalingen.")).toBeInTheDocument();
  expect(section.queryByText(/Testmodus/)).not.toBeInTheDocument();
  expect(section.getByRole("radio", { name: /Testterminal/ })).toBeChecked();
  expect(section.getByText("Gekozen")).toBeInTheDocument();
  expect(section.queryByText(/Kies een betaalterminal/)).not.toBeInTheDocument();
});

it("names a terminal without a description by its id", async () => {
  await open({ "/api/admin/pin": pinWith({ terminals: [{ id: "term_naamloos", description: "", status: "active", brand: null, model: null, serialNumber: null }] }) });
  expect((await pinSection()).getByRole("radio", { name: "term_naamloos" })).toBeEnabled();
});

it("explains a terminal that is gone from Mollie's list, and fetches the list again", async () => {
  await open({ "/api/admin/pin": pinWith({}), "POST /api/admin/pin/terminal": [409, { error: "unknown_terminal" }] });
  const section = await pinSection();
  const asked = () => calls("GET").filter((c) => c.url === "/api/admin/pin").length;
  const before = asked();
  await user().click(section.getByRole("radio", { name: /Testterminal/ }));
  await user().click(section.getByRole("button", { name: "Opslaan" }));
  expect(await section.findByText("Deze terminal staat niet meer in de lijst van Mollie.")).toBeInTheDocument();
  await waitFor(() => expect(asked()).toBe(before + 1));
  expect(section.queryByText("Betaalterminal opgeslagen.")).not.toBeInTheDocument();
});

it.each([
  [[409, { error: "terminal_not_active" }], "Deze terminal is niet actief."],
  [[503, { error: "unreachable" }], "Mollie is niet bereikbaar. Probeer het opnieuw."],
  [[503, { error: "unauthorized" }], "Mollie accepteert de sleutel niet. Controleer de sleutel."],
  [[500, { error: "server" }], "Opslaan is niet gelukt. Probeer het opnieuw."],
])("explains why the terminal could not be saved: %j", async (answer, text) => {
  await open({ "/api/admin/pin": pinWith({}), "POST /api/admin/pin/terminal": answer });
  const section = await pinSection();
  await user().click(section.getByRole("radio", { name: /Testterminal/ }));
  await user().click(section.getByRole("button", { name: "Opslaan" }));
  expect(await section.findByText(text)).toBeInTheDocument();
  expect(section.getByRole("button", { name: "Opslaan" })).toBeEnabled(); // and it can be tried again
});

it("says so when the terminal could not be saved without a connection", async () => {
  await open({ "/api/admin/pin": pinWith({}) });
  const section = await pinSection();
  await user().click(section.getByRole("radio", { name: /Testterminal/ }));
  mockOffline();
  await user().click(section.getByRole("button", { name: "Opslaan" }));
  expect(await section.findByText("Geen verbinding. Probeer het opnieuw.")).toBeInTheDocument();
});

it("says so when the chosen terminal is no longer in Mollie's list", async () => {
  await open({ "/api/admin/pin": pinWith({ terminalId: "term_weg" }) });
  const section = await pinSection();
  expect(await section.findByText("De gekozen terminal staat niet meer in de lijst van Mollie. Kies een andere.")).toBeInTheDocument();
  expect(section.queryByText("Gekozen")).not.toBeInTheDocument();
  expect(section.queryByText(/Tot die tijd is de knop Pin op de kassa uit/)).not.toBeInTheDocument();
});
