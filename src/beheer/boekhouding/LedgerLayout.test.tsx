import { screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { mockApi, mockLoggedIn, renderAt } from "../../test-utils";

it("adds Boekhouding to the beheer menu, before Instellingen", async () => {
  mockLoggedIn();
  mockApi({});
  renderAt("/beheer");
  const menu = await screen.findByRole("navigation", { name: "Beheer" });
  const names = within(menu).getAllByRole("link").map((link) => link.textContent);
  expect(names.indexOf("Boekhouding")).toBeGreaterThan(-1);
  expect(names.indexOf("Boekhouding")).toBe(names.indexOf("Instellingen") - 1);
  expect(within(menu).getByRole("link", { name: "Boekhouding" })).toHaveAttribute("href", "/beheer/boekhouding");
});

it("has its own tab bar with the nine tabs, Begroting after Rapporten", async () => {
  mockLoggedIn();
  mockApi({});
  renderAt("/beheer/boekhouding/jaar");
  const tabs = await screen.findByRole("navigation", { name: "Boekhouding" });
  expect(within(tabs).getAllByRole("link").map((link) => link.textContent)).toEqual([
    "Overzicht",
    "Te boeken",
    "Boekingen",
    "Rapporten",
    "Begroting",
    "Mollie",
    "Toestellen",
    "Jaar",
    "Instellingen",
  ]);
  expect(within(tabs).getByRole("link", { name: "Begroting" })).toHaveAttribute("href", "/beheer/boekhouding/begroting");
  // The page itself comes in the boekhouding's own chunk, a moment after the tab bar (R38).
  expect(await screen.findByRole("heading", { name: "Jaar" })).toBeInTheDocument();
});
