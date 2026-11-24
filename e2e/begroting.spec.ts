import { expect, test, type Locator, type Page } from "@playwright/test";
import { zipSync } from "fflate";
import { mutParts } from "../shared/fixtures/eboekhouden-mutaties";
import { openBeheer, prepare } from "./setup";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Taps a button that saves, and waits for the server's yes. */
async function save(page: Page, button: Locator): Promise<void> {
  const answer = page.waitForResponse((response) => response.url().includes("/api/admin/boekhouding/budget") && response.request().method() !== "GET");
  await button.click();
  expect((await answer).ok(), "saved").toBe(true);
}

/** How far a table and the page itself reach past their room, in pixels (0 or less: nothing scrolls sideways). */
async function sideways(table: Locator) {
  return table.evaluate((element) => {
    const scroller = element.parentElement!;
    return { table: element.scrollWidth - scroller.clientWidth, page: document.documentElement.scrollWidth - window.innerWidth };
  });
}

test("makes the budget from a Mutaties file, changes a line, and shows the grid without scrolling sideways", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { cookie } = await prepare(request);
  // A budget an earlier run left behind would hide "Begroting 2027 maken".
  const cleared = await request.delete("/api/admin/boekhouding/budget?year=2027", { headers: { "X-Requested-With": "kassa", Cookie: cookie } });
  expect(cleared.ok(), "budget of 2027 emptied").toBe(true);
  await openBeheer(page, cookie);
  await page.getByRole("navigation", { name: "Beheer" }).getByRole("link", { name: "Boekhouding", exact: true }).click();
  await page.getByRole("navigation", { name: "Boekhouding" }).getByRole("link", { name: "Begroting", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Begroting", exact: true })).toBeVisible();

  // A made-up year of mutations, read in the browser.
  const make = page.getByRole("region", { name: "Begroting 2027 maken" });
  await make.getByLabel("Mutatieoverzicht inlezen").setInputFiles({ name: "Mutaties 2026.xlsx", mimeType: XLSX, buffer: Buffer.from(zipSync(mutParts())) });
  await expect(make.getByText("36 mutaties gelezen, van 02-01-2026 t/m 20-11-2026.", { exact: true })).toBeVisible();
  const proposal = page.getByRole("region", { name: "Voorstel voor 2027" });
  await expect(proposal.getByRole("row", { name: /4308 Energie/ })).toContainText("elke maand € 31");
  await page.getByRole("region", { name: "Mutaties met meer rekeningen" }).getByRole("listitem", { name: "8010 Verhuur en 8012 Entree" }).getByLabel("Bij rekening").selectOption("8012");
  await expect(proposal.getByRole("row", { name: /8012 Entree/ })).toContainText("zoals 2026");
  await save(page, proposal.getByRole("button", { name: "Begroting maken" }));

  const grid = page.getByRole("region", { name: "Begroting 2027" });
  await expect(make).toBeHidden();
  const energy = grid.getByRole("row", { name: /4308 Energie/ });
  await expect(energy.getByRole("cell").last()).toHaveText("372");

  // The editor: 35 a month instead of 31.
  await grid.getByRole("button", { name: "4308 Energie wijzigen" }).click();
  const editor = page.getByRole("region", { name: "4308 Energie" });
  await expect(editor.getByLabel("Ritme")).toHaveValue("monthly");
  await editor.getByLabel("Bedrag per maand", { exact: true }).fill("35");
  await expect(editor.getByRole("row", { name: /^Dat wordt:/ }).getByRole("cell").last()).toHaveText("420");
  await save(page, editor.getByRole("button", { name: "Opslaan", exact: true }));
  await expect(editor).toBeHidden();
  await expect(energy.getByRole("cell").last()).toHaveText("420");
  await expect(grid.getByRole("row", { name: /8012 Entree/ }).getByRole("cell").last()).toHaveText("3.693");

  // The whole grid fits the width of beheer: the table in its section, and the page itself.
  const table = grid.getByRole("table");
  const over = await sideways(table);
  expect(over.table, "the grid fits its section").toBeLessThanOrEqual(0);
  expect(over.page, "the page does not scroll sideways").toBeLessThanOrEqual(0);
  const totals = await table.getByRole("columnheader", { name: "Totaal" }).boundingBox();
  expect(totals, "the column Totaal on the page").not.toBeNull();
  expect(totals!.x + totals!.width, "the column Totaal in the window").toBeLessThanOrEqual(1280);
});
