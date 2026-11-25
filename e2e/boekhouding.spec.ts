import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { buildXaf } from "../shared/fixtures/xaf-2026";
import { openBeheer, prepare } from "./setup";

/**
 * A made-up CAMT.053 statement of the ING kwartaalrekening (account V00000000): € 10.883,45 on 1 January 2027,
 * one line "Rente" of € 144,02 on 2 January, € 11.027,47 on 31 January.
 */
const STATEMENT = fileURLToPath(new URL("./fixtures/camt-ing-kwartaal-2027.xml", import.meta.url));

/** A tab of the boekhouding's own tab bar (beheer has an "Overzicht" and an "Instellingen" of its own). */
const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Boekhouding" }).getByRole("link", { name, exact: true });

/** Taps a button that saves, and waits for the server's yes: the next page reads what was saved. */
async function save(page: Page, button: Locator): Promise<void> {
  const answer = page.waitForResponse((response) => response.url().includes("/api/admin/boekhouding/") && response.request().method() !== "GET");
  await button.click();
  expect((await answer).ok(), "saved").toBe(true);
}

test("books a bank file and shows it in the result", async ({ page, request }) => {
  const { cookie } = await prepare(request);
  await openBeheer(page, cookie);
  await page.getByRole("navigation", { name: "Beheer" }).getByRole("link", { name: "Boekhouding", exact: true }).click();

  // Instellingen: the kwartaalrekening is known by its number in the file.
  await tab(page, "Instellingen").click();
  // Only ING betaal chooses its source; the kwartaalrekening works from files (no choice to make there).
  const kwartaal = page.getByRole("region", { name: "Geldrekeningen" }).getByRole("listitem").filter({ hasText: "ING kwartaalrekening" });
  await expect(kwartaal.getByText("Bankbestand uploaden of met de hand")).toBeVisible();
  await kwartaal.getByLabel("Kenmerk (IBAN of spaarnummer)").fill("V00000000");
  await save(page, kwartaal.getByRole("button", { name: "Opslaan", exact: true }));

  // 2026 uit e-Boekhouden inlezen: a made-up auditfile that leaves the kwartaalrekening at € 10.883,45 on 1 January.
  await page.getByRole("region", { name: "Eenmalig" }).getByRole("link", { name: "2026 uit e-Boekhouden inlezen" }).click();
  await page.getByLabel("Kies het auditbestand (.xaf)").setInputFiles({
    name: "auditfile-2026.xaf",
    mimeType: "application/xml",
    buffer: Buffer.from(buildXaf({ opening: { "1011": "10883.45" } })),
  });
  await save(page, page.getByRole("button", { name: "Overnemen", exact: true }));
  await expect(page.getByRole("heading", { name: "Overgenomen" })).toBeVisible();

  // Beginbalans: read only, as the file gave it.
  await tab(page, "Instellingen").click();
  await page.getByRole("link", { name: "Beginbalans", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Beginbalans 1 januari 2026" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "1011 ING kwartaalrekening" })).toContainText(/€\s10\.883,45/);
  await expect(page.getByRole("button", { name: "Opslaan", exact: true })).toHaveCount(0);

  // Te boeken: the file is read in the browser, and its one line waits to be booked.
  await tab(page, "Te boeken").click();
  const kwartaalFile = page.getByRole("heading", { name: "1011 ING kwartaalrekening" }).locator("xpath=..");
  await kwartaalFile.getByLabel("Bankbestand inlezen").setInputFiles(STATEMENT);
  await expect(kwartaalFile.getByText("1 nieuw, 0 al bekend, 0 vanzelf geboekt.", { exact: true })).toBeVisible();
  const rente = page.getByRole("listitem", { name: "Onbekend Rente", exact: true });
  await expect(rente).toContainText("02-01-2027");
  await expect(rente).toContainText(/€\s144,02/);
  await rente.getByLabel("Rekening", { exact: true }).selectOption("8030");
  await rente.getByRole("button", { name: "Boeken", exact: true }).click();
  await expect(page.getByText("Er is niets te boeken.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Te boeken (0)" })).toBeVisible();

  // Rapporten: the interest is income of 2027. Today is still 2026, so the period is chosen.
  await tab(page, "Rapporten").click();
  await page.getByRole("button", { name: "Winst en verlies", exact: true }).click();
  await page.getByLabel("Van", { exact: true }).fill("2027-01-01");
  await page.getByLabel("Tot", { exact: true }).fill("2027-12-31");
  await expect(page.getByRole("row", { name: /8030 Rente/ })).toContainText(/€\s144,02/);

  // Overzicht: the books and the bank say the same about the kwartaalrekening at the end of the file.
  await tab(page, "Overzicht").click();
  const balance = page.getByRole("listitem", { name: "ING kwartaalrekening", exact: true });
  await expect(balance).toContainText(/Saldo in de boekhouding\s*€\s11\.027,47/);
  await expect(balance).toContainText(/Saldo bij de bank op 31-01-2027\s*€\s11\.027,47/);
  await expect(balance).not.toContainText("verschil");
});
