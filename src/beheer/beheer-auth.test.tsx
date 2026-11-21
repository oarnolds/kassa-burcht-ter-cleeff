import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { calls, mockApi, mockLoggedIn, mockOffline, renderAt, tap } from "../test-utils";

const summary = {
  today: { date: "2026-07-30", cashCents: 960, pinCents: 250, totalCents: 1210, saleCount: 3 },
  month: { month: "2026-07", cashCents: 4660, pinCents: 250, totalCents: 4910, saleCount: 14 },
  cashExpectedCents: 5660,
  reorderCount: 2,
  openOrderCount: 1,
  pinAttention: [],
};

it("sends a fresh installation to setup", async () => {
  mockApi({ "/api/admin/status": { configured: false } });
  renderAt("/beheer");
  expect(await screen.findByRole("heading", { name: "Kassa instellen" })).toBeInTheDocument();
});

it("sends a visitor to login", async () => {
  mockApi({ "/api/admin/status": { configured: true }, "/api/admin/me": [401, { error: "unauthorized" }] });
  renderAt("/beheer");
  expect(await screen.findByRole("heading", { name: "Inloggen" })).toBeInTheDocument();
});

it("explains a wrong password and a lockout", async () => {
  mockApi({
    "/api/admin/status": { configured: true },
    "/api/admin/me": [401, { error: "unauthorized" }],
    "POST /api/admin/login": [401, { error: "unauthorized" }],
  });
  renderAt("/beheer/login");
  await userEvent.type(await screen.findByLabelText("Wachtwoord"), "fout");
  await tap("Inloggen");
  expect(await screen.findByText("Wachtwoord klopt niet.")).toBeInTheDocument();
  mockApi({ "POST /api/admin/login": [429, { error: "too_many_attempts" }] });
  await tap("Inloggen");
  expect(await screen.findByText("Te veel pogingen. Probeer het over een kwartier opnieuw.")).toBeInTheDocument();
  mockOffline();
  await tap("Inloggen");
  expect(await screen.findByText("Geen verbinding.")).toBeInTheDocument();
});

it("logs in, opens the overview and logs out again", async () => {
  let loggedIn = false;
  mockApi({
    "/api/admin/status": { configured: true },
    "/api/admin/me": () => (loggedIn ? { authenticated: true } : [401, { error: "unauthorized" }]),
    "POST /api/admin/login": () => {
      loggedIn = true;
      return { ok: true };
    },
    "POST /api/admin/logout": () => {
      loggedIn = false;
      return { ok: true };
    },
    "/api/admin/summary": summary,
  });
  renderAt("/beheer");
  await userEvent.type(await screen.findByLabelText("Wachtwoord"), "een-lang-wachtwoord");
  await tap("Inloggen");
  expect(await screen.findByRole("heading", { name: "Overzicht" })).toBeInTheDocument();
  expect(calls("POST")[0]).toMatchObject({ url: "/api/admin/login", body: { password: "een-lang-wachtwoord" } });
  for (const name of ["Overzicht", "Rapporten", "Verkopen", "Kluisje", "Voorraad", "Producten", "Instellingen"]) {
    expect(screen.getByRole("link", { name })).toBeInTheDocument();
  }
  await tap("Uitloggen");
  expect(await screen.findByRole("heading", { name: "Inloggen" })).toBeInTheDocument();
  expect(calls("POST")[1]!.url).toBe("/api/admin/logout");
});

it("sets the first password with the setup code", async () => {
  mockApi({ "/api/admin/status": { configured: false }, "POST /api/admin/setup": [201, { ok: true }] });
  renderAt("/beheer/instellen");
  await userEvent.type(await screen.findByLabelText("Instelcode"), "mijn-code");
  expect(screen.getByText("Minimaal 10 tekens")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Nieuw wachtwoord"), "een-lang-wachtwoord");
  await tap("Opslaan");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({ url: "/api/admin/setup", body: { setupToken: "mijn-code", password: "een-lang-wachtwoord" } });
  expect(await screen.findByRole("heading", { name: "Inloggen" })).toBeInTheDocument();
});

it("explains a wrong setup code and a short password", async () => {
  mockApi({ "/api/admin/status": { configured: false }, "POST /api/admin/setup": [403, { error: "forbidden" }] });
  renderAt("/beheer/instellen");
  await userEvent.type(await screen.findByLabelText("Instelcode"), "fout");
  await userEvent.type(screen.getByLabelText("Nieuw wachtwoord"), "te-kort");
  await tap("Opslaan");
  expect(await screen.findByText("Wachtwoord is te kort.")).toBeInTheDocument();
  expect(calls("POST")).toHaveLength(0);
  await userEvent.type(screen.getByLabelText("Nieuw wachtwoord"), "-maar-nu-lang-genoeg");
  await tap("Opslaan");
  expect(await screen.findByText("Instelcode klopt niet.")).toBeInTheDocument();
});

it("does not offer setup once the kassa is set up", async () => {
  mockApi({ "/api/admin/status": { configured: true }, "/api/admin/me": [401, { error: "unauthorized" }] });
  renderAt("/beheer/instellen");
  expect(await screen.findByRole("heading", { name: "Inloggen" })).toBeInTheDocument();
});

it("shows the overview after login", async () => {
  mockLoggedIn();
  mockApi({ "/api/admin/summary": summary });
  renderAt("/beheer");
  expect(await screen.findByText("€ 12,10")).toBeInTheDocument(); // today
  expect(screen.getByText("€ 49,10")).toBeInTheDocument(); // this month
  expect(screen.getByText("€ 56,60")).toBeInTheDocument(); // cash box
  expect(screen.getByText("3 verkopen")).toBeInTheDocument();
  expect(screen.getByText("2 bijbestellen")).toBeInTheDocument();
  expect(screen.getByText("1 levering onderweg")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Afdracht vastleggen" })).toHaveAttribute("href", "/beheer/kluisje");
});

it("goes back to login when the session has ended", async () => {
  mockLoggedIn();
  mockApi({ "/api/admin/summary": [401, { error: "unauthorized" }] });
  renderAt("/beheer");
  expect(await screen.findByRole("heading", { name: "Inloggen" })).toBeInTheDocument();
});

it("says so when a page cannot be loaded, and tries again", async () => {
  mockLoggedIn();
  mockApi({ "/api/admin/summary": [500, { error: "server" }] });
  renderAt("/beheer");
  expect(await screen.findByText("Er ging iets mis. Probeer het opnieuw.")).toBeInTheDocument();
  mockApi({ "/api/admin/summary": summary });
  await tap("Opnieuw proberen");
  expect(await screen.findByText("€ 12,10")).toBeInTheDocument();
});
