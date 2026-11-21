import { expect, test, type Page } from "@playwright/test";
import { expectToday, pair, prepare } from "./setup";

const tile = (page: Page, name: RegExp) => page.getByRole("button", { name });
const receipt = (page: Page) => page.getByRole("complementary", { name: "Bon" });
const tap = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();
/** Whether this page can reach the server right now. */
const reaches = (page: Page) =>
  page.evaluate(() =>
    fetch("/api/admin/status", { cache: "no-store" }).then(
      () => true,
      () => false,
    ),
  );

test("a cash sale of three products takes five taps and shows up in beheer", async ({ page, request }) => {
  const { code, beheer } = await prepare(request);
  await pair(page, code);
  for (const name of [/Aardbeitje/, /Aardbeitje/, /Koffie/, "Contant", "Gepast"]) await page.getByRole("button", { name }).click();
  await expect(page.getByText("Online")).toBeVisible();
  await expectToday(beheer, { cashCents: 360, saleCount: 1 });
});

test("the kassa shows the revenue of today and of the week, to look at only", async ({ page, request }) => {
  const { code, beheer } = await prepare(request);
  await pair(page, code);
  for (const name of [/Aardbeitje/, /Koffie/, "Contant", "Gepast"]) await page.getByRole("button", { name }).click();
  await expectToday(beheer, { cashCents: 250, saleCount: 1 });
  await tap(page, "Omzet");
  const omzet = page.getByRole("dialog", { name: "Omzet" });
  await expect(omzet.getByRole("heading", { name: /^Vandaag · / })).toBeVisible();
  await expect(omzet.getByText(/contant €\s2,50/)).toBeVisible();
  await expect(omzet.getByRole("region", { name: "Per product" }).getByRole("row", { name: /Koffie/ })).toBeVisible();
  await tap(page, "Week");
  await expect(omzet.getByRole("heading", { name: /^Deze week · / })).toBeVisible();
  await expect(omzet.getByRole("region", { name: "Per dag" }).getByRole("row", { name: /Hele week/ })).toContainText("2,50");
  await expect(omzet.locator("a")).toHaveCount(0);
  await tap(page, "Sluiten");
  await expect(omzet).toBeHidden();
  await expect(receipt(page).getByText("Tik op een product om te beginnen.")).toBeVisible();
});

test("a double tap on Sluiten closes Omzet and leaves the receipt as it was", async ({ page, request }) => {
  const { code } = await prepare(request);
  await pair(page, code);
  await tile(page, /Koffie/).click();
  await tap(page, "Omzet");
  const omzet = page.getByRole("dialog", { name: "Omzet" });
  await expect(omzet.getByRole("heading", { name: /^Vandaag · / })).toBeVisible();
  // Sluiten sits right above "Wis alles": the second tap of a double tap must not reach it.
  await omzet.getByRole("button", { name: "Sluiten", exact: true }).dblclick();
  await expect(omzet).toBeHidden();
  await expect(receipt(page).getByText("Koffie")).toBeVisible();
  // And the kassa goes on: the shield steps aside.
  await tile(page, /Thee/).click();
  await expect(receipt(page).getByText("Thee")).toBeVisible();
});

test("a sale made offline arrives once when the connection returns", async ({ page, context, request }) => {
  const { code, beheer } = await prepare(request);
  await pair(page, code);
  await context.setOffline(true);
  await expect(page.getByText("Offline · contant werkt door")).toBeVisible();
  await tile(page, /Koffie/).click();
  await tap(page, "Contant");
  await tap(page, "Gepast");
  await expect(page.getByText("1 verkoop wacht op verzending")).toBeVisible();
  expect(await reaches(page)).toBe(false);
  await expectToday(beheer, { cashCents: 0, saleCount: 0 }, 2000);
  await context.setOffline(false);
  await expect(page.getByText("Online")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText("wacht op verzending")).toBeHidden({ timeout: 40_000 });
  await expectToday(beheer, { cashCents: 140, saleCount: 1 });
});

test("the kassa starts without a connection after the first visit", async ({ page, context, request }) => {
  const { code } = await prepare(request);
  await pair(page, code);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  expect(await reaches(page)).toBe(false);
  await page.reload();
  // Spec §8: starts within two seconds, also offline.
  await expect(tile(page, /Aardbeitje/)).toBeVisible({ timeout: 2000 });
  await expect(page.getByText("Offline · contant werkt door")).toBeVisible();
  expect(await reaches(page)).toBe(false);
  // And it sells: the sale waits on the iPad.
  await tile(page, /Koffie/).click();
  await tap(page, "Contant");
  await tap(page, "Gepast");
  await expect(page.getByText("1 verkoop wacht op verzending")).toBeVisible();
});

/** Everything the beheerder needs is on the screen at once: no scrolling, every tile a full finger wide. */
async function expectKassaFits(page: Page): Promise<void> {
  await expect(page.locator("[data-product-tile]")).toHaveCount(22);
  const fits = await page.evaluate(
    () => document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fits).toBe(true);
  for (const name of ["Contant", "Pin", "Omzet"]) await expect(page.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
  const tiles = await page.locator("[data-product-tile]").evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      const grid = el.parentElement!;
      return { width: el.clientWidth, height: el.clientHeight, inView: box.top >= 0 && box.bottom <= window.innerHeight, scrolls: grid.scrollHeight > grid.clientHeight };
    }),
  );
  expect(Math.min(...tiles.map((t) => Math.min(t.width, t.height)))).toBeGreaterThanOrEqual(44);
  // The grid itself must not need scrolling either: every tile is one tap away.
  expect(tiles.filter((t) => !t.inView || t.scrolls)).toEqual([]);
}

test("all 22 products and the pay buttons fit on the iPad without scrolling", async ({ page, request }) => {
  const { code, beheer } = await prepare(request);
  // The fullest screen: the TEST bar on top, and under the pay buttons the line that says why pin is off.
  await beheer.post("/api/admin/pin/terminal", { terminalId: null });
  await pair(page, code);
  await expect(page.getByText("TEST", { exact: true })).toBeInViewport({ ratio: 1 });
  await tile(page, /Koffie/).click();
  await expect(page.getByTestId("pin-blocked")).toBeInViewport({ ratio: 1 });
  await expectKassaFits(page);
});

test("the footer still fits with a sale waiting, a pin payment waiting and one that failed", async ({ page, context, request }) => {
  const { code } = await prepare(request);
  await pair(page, code);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Offline, so that the kassa cannot ask how the waiting payment ended and the footer stays this full.
  await context.setOffline(true);
  await tile(page, /Koffie/).click();
  await tap(page, "Contant");
  await tap(page, "Gepast");
  await expect(page.getByText("1 verkoop wacht op verzending")).toBeVisible();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      // The pin receipts' own database, made by the kassa when it started.
      const opening = indexedDB.open("kassa-pin");
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const tx = db.transaction("pin", "readwrite");
    const receipt = { soldAt: new Date().toISOString(), totalCents: 1140, lines: [{ productId: "koffie", name: "Koffie", unitPriceCents: 140, qty: 1 }], cashTaken: false };
    tx.objectStore("pin").put({ ...receipt, id: crypto.randomUUID(), parked: true, failed: false });
    tx.objectStore("pin").put({ ...receipt, id: crypto.randomUUID(), parked: false, failed: true });
    await new Promise((resolve) => (tx.oncomplete = resolve));
    db.close();
  });
  await page.reload();
  await expect(page.getByText("Offline · contant werkt door")).toBeVisible();
  await expect(page.getByRole("button", { name: "1 pinbetaling wacht op bevestiging" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: /^Pinbetaling van €\s11,40 niet gelukt$/ })).toBeInViewport({ ratio: 1 });
  await expect(page.getByText("1 verkoop wacht op verzending")).toBeInViewport({ ratio: 1 });
  await expectKassaFits(page);
});

test("a customer who asks gets the receipt as a picture from the share sheet", async ({ page, request }) => {
  // Playwright's WebKit has no share sheet: stand in for it, and keep what the kassa hands over.
  await page.addInitScript(() => {
    const shared: { name: string; type: string; size: number; png: boolean }[] = [];
    Object.assign(window, { shared });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async ({ files }: { files: File[] }) => {
        for (const file of files) {
          const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
          shared.push({ name: file.name, type: file.type, size: file.size, png: head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 });
        }
      },
    });
  });
  const { code } = await prepare(request);
  await pair(page, code);
  const share = page.getByRole("button", { name: "Bon delen" });
  await expect(share).toHaveCount(0);
  for (const name of [/Koffie/, /Entreegeld/]) await tile(page, name).click();
  await tap(page, "Contant");
  await page.getByRole("button", { name: /^€\s5$/ }).click();
  await tap(page, "Klaar");
  await expect(share).toBeInViewport({ ratio: 1 });
  await share.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared)).toEqual([
    { name: expect.stringMatching(/^bon-[0-9a-f]{8}\.png$/), type: "image/png", size: expect.any(Number), png: true },
  ]);
  // The next customer's first product: the receipt before is not offered to them.
  await tile(page, /Thee/).click();
  await expect(share).toHaveCount(0);
});

test("a tap shows on the receipt within 100 ms", async ({ page, request }) => {
  const { code } = await prepare(request);
  await pair(page, code);
  await tile(page, /Koffie/).click();
  await expect(receipt(page).getByText("Koffie")).toBeVisible({ timeout: 100 });
  await expect(receipt(page).getByText(/€\s1,40/).first()).toBeVisible({ timeout: 100 });
});

test("the kassa screen does not select text or zoom on a double tap", async ({ page, request }) => {
  const { code } = await prepare(request);
  await pair(page, code);
  // What the app sets on the way from a tile up to the page root (not counting <body>).
  const set = await page.locator("[data-product-tile]").first().evaluate((el) => {
    const found = { select: [] as string[], touch: [] as string[] };
    for (let at = el.parentElement; at && at.id !== "root"; at = at.parentElement) {
      const computed = getComputedStyle(at);
      found.select.push(computed.getPropertyValue("-webkit-user-select") || computed.userSelect);
      found.touch.push(computed.touchAction);
    }
    return found;
  });
  expect(set.touch).toContain("manipulation");
  expect(set.select).toContain("none");
  // And the receipt, which is not a button, cannot be selected by a long press either.
  const receiptSelect = await receipt(page).evaluate((el) => getComputedStyle(el).getPropertyValue("-webkit-user-select") || getComputedStyle(el).userSelect);
  expect(receiptSelect).toBe("none");
});

test("a double tap on Gepast books one sale and leaves the next receipt empty", async ({ page, request }) => {
  const { code, beheer } = await prepare(request);
  await pair(page, code);
  await tile(page, /Koffie/).click();
  await tap(page, "Contant");
  await page.getByRole("button", { name: "Gepast", exact: true }).dblclick();
  await expectToday(beheer, { cashCents: 140, saleCount: 1 });
  // The second tap fell on the screen behind the dialog: nothing may have been added there.
  await expect(page.getByTestId("tile-qty")).toHaveCount(0);
  await expect(receipt(page).getByText("Tik op een product om te beginnen.")).toBeVisible();
  // And the kassa takes the next customer.
  await tile(page, /Thee/).click();
  await expect(receipt(page).getByText("Thee")).toBeVisible();
});

test("a double tap on a banknote shows the change, and a double tap on Klaar books one sale", async ({ page, request }) => {
  const { code, beheer } = await prepare(request);
  await pair(page, code);
  await tile(page, /Koffie/).click();
  await tap(page, "Contant");
  await page.getByRole("button", { name: /^€\s5$/ }).dblclick();
  // The change stays on screen until Klaar: the second tap must not have pressed it.
  await expect(page.getByRole("dialog", { name: "Wisselgeld" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText(/€\s3,60/)).toBeVisible();
  await expectToday(beheer, { cashCents: 0, saleCount: 0 });
  await page.getByRole("button", { name: "Klaar", exact: true }).dblclick();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expectToday(beheer, { cashCents: 140, saleCount: 1 });
  await expect(page.getByTestId("tile-qty")).toHaveCount(0);
});

test("a double tap on Ontvangen takes the delivery in once", async ({ page, request }) => {
  const { code, beheer } = await prepare(request);
  type Stock = { items: { productId: string; stock: number }[] };
  const stockOf = async () => (await beheer.get<Stock>("/api/admin/stock")).items.find((item) => item.productId === "aardbeitje")?.stock;
  const before = (await stockOf()) ?? 0;
  await beheer.post("/api/admin/stock/orders", { note: null, lines: [{ productId: "aardbeitje", boxes: 0, looseUnits: 10 }] });
  await pair(page, code);
  await page.getByRole("button", { name: "Levering onderweg" }).click();
  await page.getByRole("button", { name: "Ontvangen", exact: true }).dblclick();
  await expect(page.getByText("Levering ontvangen, voorraad bijgewerkt")).toBeVisible();
  await expect.poll(stockOf).toBe(before + 10);
  await expect(page.getByRole("button", { name: "Levering onderweg" })).toBeHidden();
});

test("an unpaired kassa keeps an unsent sale and sends it after pairing again", async ({ page, context, request }) => {
  const { code, beheer } = await prepare(request);
  await pair(page, code);
  await context.setOffline(true);
  await tile(page, /Koffie/).click();
  await tap(page, "Contant");
  await tap(page, "Gepast");
  await expect(page.getByText("1 verkoop wacht op verzending")).toBeVisible();

  // Meanwhile the penningmeester unpairs every kassa.
  type Devices = { devices: { id: string; revoked: boolean }[] };
  for (const device of (await beheer.get<Devices>("/api/admin/devices")).devices.filter((d) => !d.revoked)) {
    await beheer.post(`/api/admin/devices/${device.id}/revoke`);
  }
  await context.setOffline(false);
  await expect(page.getByText("Kassa is ontkoppeld.")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText("1 verkoop wacht op verzending")).toBeVisible();
  await expectToday(beheer, { cashCents: 0, saleCount: 0 }, 2000);

  const again = await beheer.post<{ code: string }>("/api/admin/pairing-codes");
  await page.getByRole("link", { name: "Opnieuw koppelen" }).click();
  await page.getByLabel("Koppelcode").fill(again.code);
  await page.getByRole("button", { name: "Koppelen" }).click();
  await expectToday(beheer, { cashCents: 140, saleCount: 1 }, 40_000);
  await expect(page.getByText("wacht op verzending")).toBeHidden({ timeout: 40_000 });
});
