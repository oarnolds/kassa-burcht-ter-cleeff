import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Device } from "../../shared/types";
import { calls, mockApi, mockLoggedIn, renderAt, tap, user } from "../test-utils";

const device: Device = { id: "d1", name: "iPad kiosk", createdAt: "2026-07-01T08:00:00.000Z", lastSeenAt: "2026-07-30T10:00:00.000Z", revoked: false };
const open = async (extra: Record<string, unknown> = {}) => {
  mockLoggedIn();
  mockApi({
    "/api/admin/devices": { devices: [device] },
    "/api/admin/wipe-trial": { inUseSince: null },
    "/api/admin/backups": { latest: null, count: 0 },
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
  await open({ "/api/admin/backups": { latest: copy, count: 12 } });
  expect(await backups().findByText("Laatste kopie: 27-07-2026 om 05:00")).toBeInTheDocument();
  expect(backups().queryByText(STALE)).not.toBeInTheDocument();
});

it("warns when the weekly copy has stopped coming", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-08-05T10:00:00.000Z"));
  await open({ "/api/admin/backups": { latest: copy, count: 12 } });
  expect(await backups().findByText(STALE)).toBeInTheDocument();
});

it("says so when no copy has been made yet, and makes one on request", async () => {
  await open({ "POST /api/admin/backups": { latest: { ...copy, key: "kassa-2026-07-30.json", at: "2026-07-30T10:00:00.000Z" }, count: 1 } });
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
