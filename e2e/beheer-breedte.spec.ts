import { expect, test, type Locator, type Page } from "@playwright/test";
import { openBeheer, prepare } from "./setup";

/** The rows of Vaste activa 2026 as they were pasted, and one with a long name. */
const ASSETS = [
  { name: "2 picknick tafels + banken", purchaseDate: "2008-01-01", costCents: 127800, writtenOffCents: 121410, lifeYears: 20 },
  { name: "Straaljager", purchaseDate: "2008-01-01", costCents: 949600, writtenOffCents: 902120, lifeYears: 20 },
  { name: "Dome - Kopan", purchaseDate: "2012-07-10", costCents: 4445721, writtenOffCents: 3072928, lifeYears: 20 },
  { name: "Kabelbaan met platform en valondergrond", purchaseDate: "2019-04-15", costCents: 2187550, writtenOffCents: 1093775, lifeYears: 15 },
];

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  expect(found, "on the page").not.toBeNull();
  return found!;
};

/** The vertical middle of an element: two elements on one line share it, give or take a few pixels. */
const middle = async (locator: Locator) => {
  const { y, height } = await box(locator);
  return y + height / 2;
};

async function openAssets(page: Page, request: Parameters<typeof prepare>[0]): Promise<void> {
  const { cookie, beheer } = await prepare(request);
  await beheer.post("/api/admin/boekhouding/assets/paste", { assets: ASSETS });
  await openBeheer(page, cookie);
  await page.goto("/beheer/boekhouding/toestellen");
  await expect(page.getByRole("button", { name: "Straaljager wijzigen" })).toBeVisible();
}

// The penningmeester works at a laptop: a window of 1280 wide, and the narrower 1180 of the iPad in its holder.
for (const width of [1280, 1180]) {
  test(`beheer at ${width} wide: the menu on one line, the toestellen without scrolling sideways`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 800 });
    await openAssets(page, request);

    const menu = page.getByRole("navigation", { name: "Beheer" });
    const first = menu.getByRole("link", { name: "Overzicht", exact: true });
    const logout = menu.getByRole("button", { name: "Uitloggen", exact: true });
    expect(Math.abs((await middle(logout)) - (await middle(first))), "Uitloggen on the line of Overzicht").toBeLessThan(4);

    const table = page.getByRole("table").first();
    const sideways = await table.evaluate((element) => {
      const scroller = element.parentElement!;
      return { table: element.scrollWidth, room: scroller.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth };
    });
    expect(sideways.table, "the table fits its frame").toBeLessThanOrEqual(sideways.room);
    expect(sideways.page, "the page itself does not scroll sideways").toBeLessThanOrEqual(0);

    const change = page.getByRole("button", { name: "Straaljager wijzigen" });
    const dispose = page.getByRole("button", { name: "Straaljager afvoeren" });
    for (const button of [change, dispose]) {
      const { x, width: wide } = await box(button);
      expect(x + wide, "the whole button in the window").toBeLessThanOrEqual(width);
    }
  });
}

test("beheer at 1280 wide: the logo, the menu and Uitloggen in one bar", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openAssets(page, request);
  const menu = page.getByRole("navigation", { name: "Beheer" });
  const logo = page.getByRole("banner").getByRole("link").first();
  const logout = menu.getByRole("button", { name: "Uitloggen", exact: true });
  expect(Math.abs((await middle(logout)) - (await middle(logo))), "Uitloggen on the line of the logo").toBeLessThan(6);
});
