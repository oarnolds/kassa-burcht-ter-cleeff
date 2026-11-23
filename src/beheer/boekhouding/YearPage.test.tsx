import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { LedgerYear, YearCheck } from "../../../shared/ledger-types";
import { calls, mockApi, mockLoggedIn, mockOffline, renderAt, user } from "../../test-utils";
import { base, entry, yearChanges, yearData } from "./ledger-test-data";

const page = "/beheer/boekhouding/jaar";

const check = (key: YearCheck["key"], detail: string, required = false): YearCheck => ({ key, ok: true, detail, required });
const allGood: YearCheck[] = [
  check("bank_lines", "Alle bankregels van 2028 zijn geboekt", true),
  check("bank_balances", "Alle saldo's van de bank kloppen"),
  check("cash", "Kas € 1,10, volgens de kassa € 1,10"),
  check("mollie", "Mollie: boekhouding € 0,00, bij Mollie € 0,00 op 31-12-2028"),
  check("depreciation", "Afschrijving 2028 is geboekt"),
  check("in_transit", "1080 Kruisposten staat op nul"),
  check("assets", "0130 € 0,00 en 0135 € 0,00, volgens de lijst toestellen € 0,00 en € 0,00"),
];
const failing = (key: YearCheck["key"], detail: string): YearCheck[] => allGood.map((c) => (c.key === key ? { ...c, ok: false, detail } : c));

const closed2027: LedgerYear = {
  year: 2027,
  status: "closed",
  closedAt: "2028-01-15T12:00:00.000Z",
  closeNote: "Rente volgt",
  events: [
    { at: "2028-01-15T12:00:00.000Z", kind: "closed", note: "Rente volgt" },
    { at: "2028-02-03T09:00:00.000Z", kind: "reopened", note: "Kascommissie vond een fout" },
    { at: "2028-02-04T09:00:00.000Z", kind: "closed", note: null },
  ],
};
const open2028: LedgerYear = { year: 2028, status: "open", closedAt: null, closeNote: null, events: [] };

/** The page in January 2029, so 2028 has ended whenever the test runs. */
function inJanuary2029() {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2029-01-10T10:00:00.000Z") });
}

function open(years: LedgerYear[], checks: YearCheck[] = allGood, more: Record<string, unknown> = {}) {
  mockLoggedIn();
  mockApi({ [`${base}/years`]: years, [`${base}/year/2028/checks`]: checks, ...more });
}

const region = (name: string) => screen.findByRole("region", { name });

it("shows each year with its status, the checks of an open year, the history and the links", async () => {
  inJanuary2029();
  open([closed2027, open2028]);
  renderAt(page);
  expect(await screen.findByRole("heading", { name: "Jaar" })).toBeInTheDocument();

  const y2028 = within(await region("2028"));
  expect(y2028.getByText("open")).toBeInTheDocument();
  const list = within(await y2028.findByRole("list", { name: "Controles 2028" }));
  expect(list.getAllByRole("listitem")).toHaveLength(7);
  expect(list.getByText("Alle bankregels geboekt")).toBeInTheDocument();
  expect(list.getByText("verplicht")).toBeInTheDocument();
  expect(list.getAllByText("✓")).toHaveLength(7);
  expect(y2028.getByRole("button", { name: "Jaar afsluiten" })).toBeEnabled();
  expect(y2028.queryByLabelText("Toelichting")).not.toBeInTheDocument();
  expect(y2028.getByRole("link", { name: "Jaaroverzicht" })).toHaveAttribute("href", "/beheer/boekhouding/jaar/2028/afdruk");

  const y2027 = within(await region("2027"));
  expect(y2027.getByText("afgesloten op 15-1-2028")).toBeInTheDocument();
  expect(y2027.queryByRole("list", { name: "Controles 2027" })).not.toBeInTheDocument();
  expect(y2027.queryByRole("button", { name: "Jaar afsluiten" })).not.toBeInTheDocument();
  const history = within(y2027.getByRole("list", { name: "Geschiedenis 2027" }));
  expect(history.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "Afgesloten op 15-1-2028: Rente volgt",
    "Heropend op 3-2-2028: Kascommissie vond een fout",
    "Afgesloten op 4-2-2028",
  ]);
  expect(y2027.getByRole("link", { name: "Jaaroverzicht" })).toHaveAttribute("href", "/beheer/boekhouding/jaar/2027/afdruk");

  expect(screen.getByRole("link", { name: "Beginbalans" })).toHaveAttribute("href", "/beheer/boekhouding/beginbalans");
  expect(screen.getByRole("link", { name: "Eerdere jaren" })).toHaveAttribute("href", "/beheer/boekhouding/eerdere-jaren");
  expect(screen.getByRole("link", { name: "Vergelijkingscijfers 2026" })).toHaveAttribute("href", "/beheer/boekhouding/vergelijking");
  expect(screen.getByRole("link", { name: "Toestellen (afschrijving)" })).toHaveAttribute("href", "/beheer/boekhouding/toestellen");
});

it("will not close while a required check fails", async () => {
  inJanuary2029();
  open([closed2027, open2028], failing("bank_lines", "3 bankregels van 2028 nog te boeken"));
  renderAt(page);
  const y2028 = within(await region("2028"));
  expect(await y2028.findByText("3 bankregels van 2028 nog te boeken")).toBeInTheDocument();
  expect(y2028.getAllByText("✓")).toHaveLength(6);
  expect(y2028.getByRole("button", { name: "Jaar afsluiten" })).toBeDisabled();
  expect(y2028.getByText("Boek eerst alle bankregels van 2028; daarna kan het jaar dicht.")).toBeInTheDocument();
});

it("asks for a toelichting when another check fails, asks once, and closes", async () => {
  inJanuary2029();
  const after = { ...open2028, status: "closed" as const, closedAt: "2029-01-10T10:00:00.000Z", closeNote: "Bank volgt" };
  let years = [closed2027, open2028];
  open(years, failing("bank_balances", "ING betaalrekening: boekhouding € 5,00, bank € 4,00 op 31-12-2028"), {
    [`${base}/years`]: () => years,
    [`POST ${base}/year/2028/close`]: () => {
      years = [closed2027, after];
      return { ok: true };
    },
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  renderAt(page);
  const y2028 = within(await region("2028"));
  expect(await y2028.findByText("ING betaalrekening: boekhouding € 5,00, bank € 4,00 op 31-12-2028")).toBeInTheDocument();
  const button = y2028.getByRole("button", { name: "Jaar afsluiten" });
  expect(button).toBeDisabled();
  await user().type(y2028.getByLabelText("Toelichting"), "  Bank volgt ");
  expect(button).toBeEnabled();
  await user().click(button);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith("2028 afsluiten? Daarna verandert er niets meer in 2028.");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({ url: `${base}/year/2028/close`, body: { note: "Bank volgt" } });
  expect(await screen.findByText("Afgesloten.")).toBeInTheDocument();
  expect(await within(await region("2028")).findByText("afgesloten op 10-1-2029")).toBeInTheDocument();
  confirm.mockRestore();
});

it("closes without a toelichting when every check holds, and not when he says no", async () => {
  inJanuary2029();
  open([closed2027, open2028], allGood, { [`POST ${base}/year/2028/close`]: { ok: true } });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  renderAt(page);
  const y2028 = within(await region("2028"));
  await user().click(await y2028.findByRole("button", { name: "Jaar afsluiten" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(calls("POST")).toHaveLength(0);
  confirm.mockReturnValue(true);
  await user().click(y2028.getByRole("button", { name: "Jaar afsluiten" }));
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({ url: `${base}/year/2028/close`, body: { note: null } });
  confirm.mockRestore();
});

it("says why closing was refused", async () => {
  inJanuary2029();
  open([closed2027, open2028], allGood, { [`POST ${base}/year/2028/close`]: [409, { error: "checks_failed" }] });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  renderAt(page);
  await user().click(await within(await region("2028")).findByRole("button", { name: "Jaar afsluiten" }));
  expect(await screen.findByText("Er zijn nog bankregels van dit jaar te boeken. Boek die eerst.")).toBeInTheDocument();
  confirm.mockRestore();
});

it("offers closing only once the year has ended", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2028-12-31T10:00:00.000Z") });
  open([closed2027, open2028]);
  renderAt(page);
  const y2028 = within(await region("2028"));
  expect(await y2028.findByRole("list", { name: "Controles 2028" })).toBeInTheDocument();
  expect(y2028.queryByRole("button", { name: "Jaar afsluiten" })).not.toBeInTheDocument();
  expect(y2028.getByText("Afsluiten kan vanaf 1-1-2029.")).toBeInTheDocument();
});

it("closes the years in order (R34)", async () => {
  inJanuary2029();
  const open2027: LedgerYear = { year: 2027, status: "open", closedAt: null, closeNote: null, events: [] };
  open([open2027, open2028], allGood, { [`${base}/year/2027/checks`]: allGood });
  renderAt(page);
  const y2028 = within(await region("2028"));
  expect(await y2028.findByText("Sluit eerst 2027 af.")).toBeInTheDocument();
  // The checks are still there; only closing waits.
  expect(y2028.getAllByText("✓")).toHaveLength(7);
  expect(y2028.getByRole("button", { name: "Jaar afsluiten" })).toBeDisabled();
  const y2027 = within(await region("2027"));
  expect(await y2027.findByRole("button", { name: "Jaar afsluiten" })).toBeEnabled();
  expect(y2027.queryByText(/Sluit eerst/)).not.toBeInTheDocument();
});

it("explains a refusal because the year before is open", async () => {
  inJanuary2029();
  open([closed2027, open2028], allGood, { [`POST ${base}/year/2028/close`]: [409, { error: "earlier_year_open" }] });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  renderAt(page);
  await user().click(await within(await region("2028")).findByRole("button", { name: "Jaar afsluiten" }));
  expect(await screen.findByText("Sluit eerst het jaar ervoor af.")).toBeInTheDocument();
  confirm.mockRestore();
});

it("reopens the newest closed year with a reason, and only that one", async () => {
  inJanuary2029();
  const closed2028 = { ...open2028, status: "closed" as const, closedAt: "2029-01-05T10:00:00.000Z", events: [{ at: "2029-01-05T10:00:00.000Z", kind: "closed" as const, note: null }] };
  open([closed2027, closed2028], allGood, { [`POST ${base}/year/2028/reopen`]: { ok: true } });
  renderAt(page);
  const y2027 = within(await region("2027"));
  expect(y2027.queryByRole("button", { name: "Heropenen" })).not.toBeInTheDocument();
  const y2028 = within(await region("2028"));
  const button = y2028.getByRole("button", { name: "Heropenen" });
  expect(button).toBeDisabled();
  await user().type(y2028.getByLabelText("Reden"), "ab");
  expect(button).toBeDisabled();
  await user().type(y2028.getByLabelText("Reden"), "c fout in de kas");
  expect(button).toBeEnabled();
  await user().click(button);
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({ url: `${base}/year/2028/reopen`, body: { reason: "abc fout in de kas" } });
  expect(await screen.findByText("Heropend.")).toBeInTheDocument();
});

// ---- The jaaroverzicht as files ----

afterEach(() => {
  vi.restoreAllMocks();
});

/** Catches what the page offers to save: the file's name and what is in it. */
function catchDownloads() {
  const saved: { name: string; blob: Blob }[] = [];
  const blobs = new Map<string, Blob>();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      const url = `blob:test/${blobs.size + 1}`;
      blobs.set(url, blob);
      return url;
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, blob: blobs.get(this.href)! });
  });
  return saved;
}

/** `count` entries of 2027, numbered from 1; the first has two attachments. */
const manyEntries = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    entry({ id: `e${i + 1}`, number: i + 1, attachments: i === 0 ? [{ id: "a1", filename: "bon-goodoo.pdf", contentType: "application/pdf", sizeBytes: 3, uploadedAt: "2027-01-04T10:00:00.000Z" }, { id: "a2", filename: "foto.jpg", contentType: "image/jpeg", sizeBytes: 3, uploadedAt: "2027-01-04T10:00:00.000Z" }] : [] }),
  );
const after = (url: string) => Number(new URL(url, "http://localhost").searchParams.get("after"));

/** The year's pages as the Worker gives them: 500 at a time, after a number. */
function yearPages(entries: ReturnType<typeof manyEntries>) {
  return {
    [`${base}/year/2027/export`]: yearData({ entryCount: entries.length }),
    [`${base}/year/2027/entries`]: ({ url }: { url: string }) => entries.filter((one) => one.number > after(url)).slice(0, 500),
    [`${base}/year/2027/changes`]: ({ url }: { url: string }) => (after(url) === 0 ? yearChanges() : []),
  };
}

/** Holds back the requests whose address contains `part` until `release` is called. */
function holdBack(part: string) {
  const fake = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes(part)) await gate;
    return fake(input, init);
  });
  return release;
}

it("makes the jaaroverzicht as Excel, page by page, and shows how far it is", async () => {
  inJanuary2029();
  const saved = catchDownloads();
  const entries = manyEntries(501);
  open([closed2027, open2028], allGood, yearPages(entries));
  const release = holdBack("after=500");
  renderAt(page);
  const y2027 = within(await region("2027"));
  await user().click(y2027.getByRole("button", { name: "Excel" }));
  expect(await y2027.findByText("Bezig met 500 van 501 boekingen …")).toBeInTheDocument();
  expect(y2027.getByRole("button", { name: "Excel" })).toBeDisabled();
  release();
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]!.name).toBe("jaaroverzicht-2027.xlsx");
  expect(saved[0]!.blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect(calls("GET").map((call) => call.url).filter((url) => url.includes("/year/2027/"))).toEqual([
    `${base}/year/2027/export`,
    `${base}/year/2027/entries?after=0&limit=500`,
    `${base}/year/2027/entries?after=500&limit=500`,
    `${base}/year/2027/changes?after=0`,
  ]);
  await waitFor(() => expect(y2027.queryByText(/Bezig met/)).not.toBeInTheDocument());
  expect(y2027.getByRole("button", { name: "Excel" })).toBeEnabled();
});

it("opens the afdruk for the PDF in a new tab", async () => {
  inJanuary2029();
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  open([closed2027, open2028]);
  renderAt(page);
  await user().click(within(await region("2028")).getByRole("button", { name: "PDF" }));
  expect(opened).toHaveBeenCalledWith("/beheer/boekhouding/jaar/2028/afdruk?print=1", "_blank");
  opened.mockRestore();
});

it("puts the attachments in a zip, named after their entry", async () => {
  inJanuary2029();
  const saved = catchDownloads();
  open([closed2027, open2028], allGood, {
    ...yearPages(manyEntries(3)),
    [`${base}/attachments/a1`]: { bytes: "bon" },
    [`${base}/attachments/a2`]: { bytes: "foto" },
  });
  renderAt(page);
  await user().click(within(await region("2027")).getByRole("button", { name: "Bijlagen (zip)" }));
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]!.name).toBe("bijlagen-2027.zip");
  const { unzipSync } = await import("fflate");
  expect(Object.keys(unzipSync(new Uint8Array(await saved[0]!.blob.arrayBuffer())))).toEqual(["1-1-bon-goodoo.pdf", "1-2-foto.jpg"]);
  expect(calls("GET").map((call) => call.url).filter((url) => url.includes("/attachments/"))).toEqual([`${base}/attachments/a1`, `${base}/attachments/a2`]);
});

it("says so when a year has no attachments", async () => {
  inJanuary2029();
  const saved = catchDownloads();
  open([closed2027, open2028], allGood, { ...yearPages([entry({ number: 1, attachments: [] })]) });
  renderAt(page);
  const y2027 = within(await region("2027"));
  await user().click(y2027.getByRole("button", { name: "Bijlagen (zip)" }));
  expect(await y2027.findByText("Er zijn geen bijlagen in 2027.")).toBeInTheDocument();
  expect(saved).toHaveLength(0);
});

it("says what went wrong when a page or an attachment does not come", async () => {
  inJanuary2029();
  const saved = catchDownloads();
  open([closed2027, open2028], allGood, { ...yearPages(manyEntries(3)), [`${base}/year/2027/entries`]: [500, { error: "server" }] });
  renderAt(page);
  const y2027 = within(await region("2027"));
  await user().click(y2027.getByRole("button", { name: "Excel" }));
  expect(await y2027.findByRole("alert")).toHaveTextContent("Het jaaroverzicht kon niet worden gemaakt. Probeer het opnieuw.");
  expect(y2027.getByRole("button", { name: "Excel" })).toBeEnabled();

  mockApi({ ...yearPages(manyEntries(3)), [`${base}/attachments/a1`]: { bytes: "bon" }, [`${base}/attachments/a2`]: [404, { error: "not_found" }] });
  await user().click(y2027.getByRole("button", { name: "Bijlagen (zip)" }));
  expect(await y2027.findByText("Bijlage foto.jpg van boeking 1 kon niet worden opgehaald. Probeer het opnieuw.")).toBeInTheDocument();

  mockOffline();
  await user().click(y2027.getByRole("button", { name: "Excel" }));
  expect(await y2027.findByText("Geen verbinding. Probeer het opnieuw.")).toBeInTheDocument();
  expect(saved).toHaveLength(0);
});
