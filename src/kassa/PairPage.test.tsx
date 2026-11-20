import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { calls, catalog, mockApi, mockOffline, renderAt, tap } from "../test-utils";
import { getMeta, setMeta } from "./store/db";

it("pairs and opens the kassa", async () => {
  mockApi({ "POST /api/pair": [201, { deviceId: "d1", token: "tok" }], "/api/kassa/catalog": catalog });
  renderAt("/koppelen");
  expect(screen.getByRole("heading", { name: "Kassa koppelen" })).toBeInTheDocument();
  expect(screen.getByLabelText("Naam van deze kassa")).toHaveValue("iPad kiosk");
  await userEvent.type(screen.getByLabelText("Koppelcode"), "482913");
  await tap("Koppelen");
  await waitFor(async () => expect(await getMeta("deviceToken")).toBe("tok"));
  expect(calls("POST")[0]).toMatchObject({ url: "/api/pair", body: { code: "482913", name: "iPad kiosk" } });
  expect(await screen.findByRole("button", { name: /Aardbeitje/ })).toBeInTheDocument();
});

it("explains a wrong code, a lockout and a missing connection", async () => {
  mockApi({ "POST /api/pair": [401, { error: "invalid_code" }] });
  renderAt("/koppelen");
  await userEvent.type(screen.getByLabelText("Koppelcode"), "000000");
  await tap("Koppelen");
  expect(await screen.findByText("Code klopt niet of is verlopen.")).toBeInTheDocument();
  mockApi({ "POST /api/pair": [429, { error: "too_many_attempts" }] });
  await tap("Koppelen");
  expect(await screen.findByText("Te veel pogingen. Probeer het over een kwartier opnieuw.")).toBeInTheDocument();
  expect(screen.queryByText("Code klopt niet of is verlopen.")).not.toBeInTheDocument();
  mockOffline();
  await tap("Koppelen");
  expect(await screen.findByText("Geen verbinding.")).toBeInTheDocument();
  expect(await getMeta("deviceToken")).toBeUndefined();
});

it("takes only six digits as a code, and asks for all six", async () => {
  mockApi({ "POST /api/pair": [201, { deviceId: "d1", token: "tok" }], "/api/kassa/catalog": catalog });
  renderAt("/koppelen");
  const code = screen.getByLabelText("Koppelcode");
  expect(code).toHaveAttribute("inputmode", "numeric");
  await userEvent.type(code, "12a 3");
  expect(code).toHaveValue("123");
  expect(screen.getByRole("button", { name: "Koppelen" })).toBeDisabled();
  await userEvent.type(code, "4567");
  expect(code).toHaveValue("123456");
  expect(screen.getByRole("button", { name: "Koppelen" })).toBeEnabled();
});

it("pairs again over an old pairing and keeps the name it is given", async () => {
  await setMeta("deviceToken", "oud");
  mockApi({ "POST /api/pair": [201, { deviceId: "d2", token: "nieuw" }], "/api/kassa/catalog": catalog });
  renderAt("/koppelen");
  await userEvent.clear(screen.getByLabelText("Naam van deze kassa"));
  await userEvent.type(screen.getByLabelText("Naam van deze kassa"), "Kiosk twee");
  await userEvent.type(screen.getByLabelText("Koppelcode"), "111222");
  await tap("Koppelen");
  await waitFor(async () => expect(await getMeta("deviceToken")).toBe("nieuw"));
  expect(calls("POST")[0]!.body).toEqual({ code: "111222", name: "Kiosk twee" });
});
