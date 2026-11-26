import { expect, test, type Locator, type Page } from "@playwright/test";
import { booking, buildXaf, credit, debit } from "../shared/fixtures/xaf-2026";
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

/** Entries with descriptions short and long and amounts small and large, read in as e-Boekhouden's 2026. */
async function openEntries(page: Page, request: Parameters<typeof prepare>[0]): Promise<void> {
  const { cookie } = await prepare(request);
  await openBeheer(page, cookie);
  // Another test may have read in an auditfile already: then the app asks to replace it.
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/beheer/boekhouding/eboekhouden-2026");
  await page.getByLabel("Kies het auditbestand (.xaf)").setInputFiles({
    name: "auditfile-2026.xaf",
    mimeType: "application/xml",
    buffer: Buffer.from(
      buildXaf({
        bookings: [
          booking("1010", "20001", "2026-03-05", "Huur", debit("4301", "4.2"), credit("1010", "4.2")),
          booking(
            "1010",
            "20002",
            "2026-04-07",
            "Factuur onderhoud speeltoestellen en buitenmeubilair, met materiaal en de uren van de vrijwilligers in april",
            debit("4304", "1234.56"),
            credit("1010", "1234.56"),
          ),
          booking("1010", "20003", "2026-05-09", "Water", debit("4309", "25.3"), credit("1010", "25.3")),
        ],
      }),
    ),
  });
  const saved = page.waitForResponse((response) => response.url().includes("/api/admin/boekhouding/") && response.request().method() !== "GET");
  await page.getByRole("button", { name: "Overnemen", exact: true }).click();
  expect((await saved).ok(), "read in").toBe(true);
  await page.goto("/beheer/boekhouding/boekingen");
  await expect(page.getByRole("link", { name: /Huur/ })).toBeVisible();
}

for (const width of [1280, 1180]) {
  test(`Boekingen at ${width} wide: Zoek bijlage in one column of equal buttons, the amounts in one right edge`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 800 });
    await openEntries(page, request);
    const buttons = await page.getByRole("button", { name: "Zoek bijlage" }).all();
    expect(buttons.length, "a button on every entry without an attachment").toBeGreaterThanOrEqual(3);
    const boxes = await Promise.all(buttons.map(box));
    for (const one of boxes) {
      expect(Math.abs(one.x - boxes[0]!.x), "under one another").toBeLessThan(1);
      expect(Math.abs(one.width - boxes[0]!.width), "equally wide").toBeLessThan(1);
    }
    const amounts = await Promise.all(["€ 4,20", "€ 1.234,56", "€ 25,30"].map((amount) => box(page.getByText(amount, { exact: true }))));
    for (const one of amounts) expect(Math.abs(one.x + one.width - (amounts[0]!.x + amounts[0]!.width)), "the amounts end at one edge").toBeLessThan(1);
  });
}
