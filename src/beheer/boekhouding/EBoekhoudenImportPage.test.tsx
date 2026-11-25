import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ACCOUNTS } from "../../../shared/accounts";
import camtXml from "../../../shared/fixtures/camt-ing-betaal.xml?raw";
import { booking, buildXaf, credit, debit, XAF_2026 } from "../../../shared/fixtures/xaf-2026";
import type { EbStatus, EbSummary } from "../../../shared/ledger-types";
import type { ImportedEntry } from "../../../shared/xaf-map";
import { calls, mockApi, mockLoggedIn, renderAt, rowIn, tap, user } from "../../test-utils";
import { base, ebStatus, ebSummary } from "./ledger-test-data";

const page = "/beheer/boekhouding/eboekhouden-2026";
const eb = `${base}/eboekhouden`;
const PICK = "Kies het auditbestand (.xaf)";

type Sent = { entries: ImportedEntry[] };

/** 41 bookings before the overstap: one more than a request may carry. */
const many = Array.from({ length: 41 }, (_, i) =>
  booking("1010", String(20001 + i), "2026-03-02", `Ontvangst ${i + 1}`, debit("1010", "1"), credit("8040", "1")),
);
const manyRefs = many.map((b) => `1010:${b.nr}`);

const acceptEntries = (request: { body: Sent }) => ({ written: request.body.entries.length });

function open(status: EbStatus | (() => EbStatus) = ebStatus(), summary: EbSummary = ebSummary(), more: Record<string, unknown> = {}) {
  mockLoggedIn();
  mockApi({
    [`${base}/accounts`]: ACCOUNTS,
    [`${eb}/status`]: status,
    [`POST ${eb}/start`]: { ok: true },
    [`POST ${eb}/entries`]: acceptEntries,
    [`POST ${eb}/finish`]: summary,
    ...more,
  });
  renderAt(page);
}

const xaf = (text = XAF_2026, name = "auditfile_2026.xaf") => new File([text], name);

/** Chooses a file and waits until it is read (the picker is off meanwhile). */
async function choose(file: File, picker: UserEvent = user()) {
  const input = await screen.findByLabelText(PICK);
  await picker.upload(input, file);
  await waitFor(() => expect(input).toBeEnabled());
}

const urls = () => calls("POST").map((call) => call.url);

it("shows what the file holds before anything is saved", async () => {
  open();
  expect(await screen.findByRole("heading", { name: "2026 uit e-Boekhouden inlezen" })).toBeInTheDocument();
  expect(await screen.findByText("Nog niet ingelezen")).toBeInTheDocument();
  expect(screen.getByLabelText(PICK)).toHaveAttribute("accept", ".xaf");
  await choose(xaf());

  const file = within(await screen.findByRole("region", { name: "Het bestand" }));
  expect(file.getByText("Boekjaar 2026, gemaakt op 25-11-2026")).toBeInTheDocument();
  expect(file.getByText("11 boekingen van 1 januari tot en met 24 november; 1 vanaf 25 november wordt overgeslagen")).toBeInTheDocument();

  // Per new account, as the balance shows it: 1590 joined 1300 and 1890 joined 1700. No toestellen, Mollie or 1400.
  const opening = "Beginbalans 1 januari 2026";
  expect(rowIn(opening, "Kas (kluisje)").getByText("€ 84,00")).toBeInTheDocument();
  expect(rowIn(opening, "ING betaalrekening").getByText("€ 12.345,60")).toBeInTheDocument();
  expect(rowIn(opening, "Nog te ontvangen").getByText("€ 290,50")).toBeInTheDocument();
  expect(rowIn(opening, "Nog te betalen").getByText("€ 155,00")).toBeInTheDocument();
  for (const code of ["0130", "0135", "1030", "1400"]) expect(within(screen.getByRole("region", { name: opening })).queryByText(code)).not.toBeInTheDocument();
  // e-Boekhouden's equity, and how far its own opening is from closing: debit 212.042,46 against credit 223.278,68.
  expect(rowIn(opening, "Eigen vermogen in e-Boekhouden").getByText("€ 150.000,00")).toBeInTheDocument();
  expect(rowIn(opening, "Verschil in de beginbalans van e-Boekhouden").getByText("€ 11.236,22")).toBeInTheDocument();

  const mapping = "Rekeningen";
  expect(rowIn(mapping, "Buitenmeubilair").getByText("4304 Terrein en buitenmeubilair")).toBeInTheDocument();
  expect(rowIn(mapping, "Overige vorderingen").getByText("1300 Nog te ontvangen")).toBeInTheDocument();
  expect(rowIn(mapping, "Voorziening vervanging toestellen").getByText("0135 Afschrijving speeltoestellen en inventaris")).toBeInTheDocument();
  expect(rowIn(mapping, "Revolut").getByText("Revolut: niet in de app, via 1080")).toBeInTheDocument();

  const gone = within(screen.getByRole("region", { name: "Vallen weg (beide kanten op dezelfde rekening)" }));
  expect(gone.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["20-05-2026 Voorziening naar afschrijving", "02-07-2026 Van ING"]);

  const switchDay = "Saldo's aan het eind van 24 november";
  expect(rowIn(switchDay, "Kas (kluisje)").getByText("€ 37,50")).toBeInTheDocument();
  expect(rowIn(switchDay, "ING betaalrekening").getByText("€ 13.394,05")).toBeInTheDocument();
  expect(rowIn(switchDay, "Nog te betalen").getByText("€ 0,00")).toBeInTheDocument();

  // The kassa is in use since 21-11: the entree of 22-11 in e-Boekhouden is a warning, not a block.
  const kassa = within(screen.getByRole("region", { name: "Kassa-omzet" }));
  expect(kassa.getByText("De app boekt de kassa vanaf 21-11-2026 zelf. Haal deze boekingen weg in e-Boekhouden en lees opnieuw in.")).toBeInTheDocument();
  expect(kassa.getByText("22-11-2026 Entree zaterdag")).toBeInTheDocument();

  expect(screen.queryByRole("region", { name: "Nog geen plek" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Op een toestel-rekening" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Open op 24 november" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Overnemen" })).toBeEnabled();
  expect(calls("POST")).toHaveLength(0);
});

it("warns about a file made before the overstap, and still takes it", async () => {
  open();
  await choose(xaf(buildXaf({ createdOn: "2026-11-20" })));
  const file = within(await screen.findByRole("region", { name: "Het bestand" }));
  expect(file.getByText("Boekjaar 2026, gemaakt op 20-11-2026")).toBeInTheDocument();
  expect(
    file.getByText(
      "Dit bestand is gemaakt vóór 25-11-2026: wat na het maken in e-Boekhouden is geboekt, staat er niet in; download het opnieuw.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Overnemen" })).toBeEnabled();
});

it("does not warn about a file made on the overstap", async () => {
  open();
  await choose(xaf());
  await screen.findByRole("region", { name: "Het bestand" });
  expect(screen.queryByText(/gemaakt vóór/)).not.toBeInTheDocument();
});

it("asks a place for an unknown account before Overnemen", async () => {
  open();
  const unknown = booking("1010", "10020", "2026-08-15", "Iets onbekends", debit("4999", "20"), credit("1010", "20"));
  await choose(xaf(buildXaf({ extraAccounts: [{ id: "4999", name: "Onbekende kosten" }], extraBookings: [unknown] })));

  const place = within(await screen.findByRole("region", { name: "Nog geen plek" }));
  const select = place.getByLabelText("Rekening voor 4999 Onbekende kosten");
  expect(select).toHaveDisplayValue("Kies een rekening");
  const offered = within(select).getAllByRole("option").map((option) => option.textContent);
  expect(offered).toContain("4514 Diversen");
  expect(offered).toContain("1080 Kruisposten (geld onderweg)");
  expect(offered).not.toContain("0130 Speeltoestellen en inventaris");
  expect(rowIn("Rekeningen", "Onbekende kosten").getByText("nog geen plek")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Overnemen" })).toBeDisabled();

  await user().selectOptions(select, "4514");
  expect(place.getByLabelText("Rekening voor 4999 Onbekende kosten")).toHaveDisplayValue("4514 Diversen");
  expect(rowIn("Rekeningen", "Onbekende kosten").getByText("4514 Diversen")).toBeInTheDocument();
  expect(calls("POST")).toHaveLength(0);

  await tap("Overnemen");
  await screen.findByRole("region", { name: "Overgenomen" });
  expect(urls()).toEqual([`${eb}/start`, `${eb}/entries`, `${eb}/finish`]);
  const sent = (calls("POST")[1]!.body as Sent).entries.find((entry) => entry.ref === "1010:10020");
  expect(sent?.lines).toEqual([
    { accountCode: "4514", amountCents: 2000, note: null },
    { accountCode: "1010", amountCents: -2000, note: null },
  ]);
});

it("blocks a booking on a toestel account", async () => {
  open();
  const wip = booking("1010", "10020", "2026-09-01", "Nieuwe wip", debit("0130", "1250"), credit("1010", "1250"));
  await choose(xaf(buildXaf({ extraBookings: [wip] })));
  const block = within(await screen.findByRole("region", { name: "Op een toestel-rekening" }));
  expect(
    block.getByText("Deze boekingen staan op een toestel-rekening. Haal ze weg in e-Boekhouden, lees opnieuw in en leg het toestel vast bij Toestellen."),
  ).toBeInTheDocument();
  expect(block.getByText("01-09-2026 Nieuwe wip")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Overnemen" })).toBeDisabled();
  expect(calls("POST")).toHaveLength(0);
});

it("sends the opening, the bookings in chunks and the finish", async () => {
  // The status says done once the finish has come.
  const finished = () => calls("POST").some((call) => call.url === `${eb}/finish`);
  open(() => (finished() ? ebStatus({ done: true, createdOn: "2026-11-25", imported: 41 }) : ebStatus()), ebSummary({ imported: 41 }));
  await choose(xaf(buildXaf({ bookings: many })));
  expect(await screen.findByText("41 boekingen van 1 januari tot en met 24 november; 0 vanaf 25 november worden overgeslagen")).toBeInTheDocument();
  // Without the bookings that close them, 1300 and 1700 are still open at the switch.
  const openItems = within(screen.getByRole("region", { name: "Open op 24 november" }));
  expect(openItems.getByText("1300 Nog te ontvangen: € 290,50")).toBeInTheDocument();
  expect(openItems.getByText("1700 Nog te betalen: € 155,00")).toBeInTheDocument();
  expect(openItems.getByText("Boek de betaling hiervan in Te boeken op 1300 (of 1700).")).toBeInTheDocument();
  expect(calls("POST")).toHaveLength(0);

  const confirm = vi.spyOn(window, "confirm");
  await tap("Overnemen");
  expect(await screen.findByRole("region", { name: "Overgenomen" })).toBeInTheDocument();
  expect(confirm).not.toHaveBeenCalled();
  confirm.mockRestore();

  expect(urls()).toEqual([`${eb}/start`, `${eb}/entries`, `${eb}/entries`, `${eb}/finish`]);
  const [start, first, second, finish] = calls("POST");
  expect(start!.body).toEqual({
    createdOn: "2026-11-25",
    opening: [
      { accountCode: "1000", amountCents: 8400 },
      { accountCode: "1010", amountCents: 1234560 },
      { accountCode: "1011", amountCents: 250000 },
      { accountCode: "1020", amountCents: 1088345 },
      { accountCode: "1300", amountCents: 29050 },
      { accountCode: "1700", amountCents: -15500 },
    ],
    ebEquityCents: 15000000,
    payouts: [],
  });
  expect((first!.body as Sent).entries.map((entry) => entry.ref)).toEqual(manyRefs.slice(0, 40));
  expect((first!.body as Sent).entries[0]).toEqual({
    ref: "1010:20001",
    date: "2026-03-02",
    description: "Ontvangst 1",
    lines: [
      { accountCode: "1010", amountCents: 100, note: null },
      { accountCode: "8040", amountCents: -100, note: null },
    ],
  });
  expect((second!.body as Sent).entries.map((entry) => entry.ref)).toEqual(manyRefs.slice(40));
  expect(finish!.body).toEqual({ createdOn: "2026-11-25", refs: manyRefs });

  // The read is done: no second Overnemen, the status read again, and the kas agrees with the kluisje.
  expect(screen.queryByRole("button", { name: "Overnemen" })).not.toBeInTheDocument();
  expect(await screen.findByText("Ingelezen uit het auditbestand van 25-11-2026: 41 boekingen")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Overgenomen" })).getByText("41 boekingen uit e-Boekhouden staan nu in de boeken.")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Kas" })).getByText("1000 Kas in de boeken: € 37,50; in het kluisje volgens de kassa: € 37,50")).toBeInTheDocument();
  expect(screen.queryByText(/Boek het verschil/)).not.toBeInTheDocument();
});

it("stops at the first refusal and never finishes", async () => {
  open(ebStatus(), ebSummary(), { [`POST ${eb}/entries`]: [409, { error: "year_closed" }] });
  await choose(xaf(buildXaf({ bookings: many })));
  await tap("Overnemen");
  expect(await screen.findByText("2026 is afgesloten; heropen het jaar eerst.")).toBeInTheDocument();
  // No second chunk and no finish: the finish would open the books on a part of the file.
  expect(urls()).toEqual([`${eb}/start`, `${eb}/entries`]);
  expect(screen.getByRole("button", { name: "Overnemen" })).toBeEnabled();

  // Trying again sends the whole file again, from the start.
  mockApi({ [`POST ${eb}/entries`]: acceptEntries });
  await tap("Overnemen");
  expect(await screen.findByRole("region", { name: "Overgenomen" })).toBeInTheDocument();
  expect(urls()).toEqual([`${eb}/start`, `${eb}/entries`, `${eb}/start`, `${eb}/entries`, `${eb}/entries`, `${eb}/finish`]);
  expect(screen.queryByText("2026 is afgesloten; heropen het jaar eerst.")).not.toBeInTheDocument();
});

it("asks before replacing an earlier import", async () => {
  open(ebStatus({ done: true, createdOn: "2026-11-20", imported: 10 }));
  expect(await screen.findByText("Ingelezen uit het auditbestand van 20-11-2026: 10 boekingen")).toBeInTheDocument();
  await choose(xaf());
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  await tap("Overnemen");
  expect(confirm).toHaveBeenCalledWith("Er staan al boekingen uit e-Boekhouden. Vervangen door dit bestand?");
  expect(calls("POST")).toHaveLength(0);

  confirm.mockReturnValue(true);
  await tap("Overnemen");
  expect(await screen.findByRole("region", { name: "Overgenomen" })).toBeInTheDocument();
  expect(urls()).toEqual([`${eb}/start`, `${eb}/entries`, `${eb}/finish`]);
  confirm.mockRestore();
});

it("shows the kas difference after Overnemen", async () => {
  open(ebStatus(), ebSummary({ emptied: 2, cash: { ledgerCents: 0, kluisjeCents: 5000 }, open: [{ accountCode: "1700", cents: -12000 }] }));
  await choose(xaf());
  await tap("Overnemen");

  const kas = within(await screen.findByRole("region", { name: "Kas" }));
  expect(kas.getByText("1000 Kas in de boeken: € 0,00; in het kluisje volgens de kassa: € 50,00")).toBeInTheDocument();
  expect(
    kas.getByText(
      "Boek het verschil één keer met een gewone boeking. Kwam het wisselgeld uit de oude kas, dan tegen de rekening waar het vandaan kwam; anders op 4515 Kasverschillen.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("2 boekingen zijn leeggemaakt, omdat ze niet meer in het bestand staan.")).toBeInTheDocument();

  const openItems = within(screen.getByRole("region", { name: "Open op 24 november" }));
  expect(openItems.getByText("1700 Nog te betalen: € 120,00")).toBeInTheDocument();
  expect(openItems.getByText("Boek de betaling hiervan in Te boeken op 1300 (of 1700).")).toBeInTheDocument();

  // Each bank account next to its bank; the kas has its own line above, and Mollie starts on nil.
  const money = within(screen.getByRole("region", { name: "Geldrekeningen op 24 november" }));
  expect(money.queryByRole("listitem", { name: "Kas (kluisje)" })).not.toBeInTheDocument();
  expect(money.queryByRole("listitem", { name: /Mollie/ })).not.toBeInTheDocument();
  expect(money.getAllByRole("listitem")).toHaveLength(3);
  const ing = within(money.getByRole("listitem", { name: "ING betaalrekening" }));
  expect(ing.getByText("Saldo bij de bank op 24-11-2026")).toBeInTheDocument();
  expect(ing.getByText("verschil € 0,00")).toBeInTheDocument();
  const asn = within(money.getByRole("listitem", { name: "ASN MeerSparen" }));
  expect(asn.getByText("€ 10.883,45")).toBeInTheDocument();
  expect(asn.getByText("Saldo bij de bank op 31-10-2026")).toBeInTheDocument();
  expect(asn.getByText("€ 10.800,00")).toBeInTheDocument();
  expect(asn.getByText("verschil € 83,45")).toBeInTheDocument();
  expect(
    within(money.getByRole("listitem", { name: "ASN deposito" })).getByText(
      "Geen saldo van de bank op of vóór 24-11-2026. Vergelijk met uw bankapp, of met het overzicht na Nu bijwerken.",
    ),
  ).toBeInTheDocument();
  const update = screen.getByText(/worden vannacht bijgewerkt/);
  expect(update).toHaveTextContent("De kassa, ING en Mollie worden vannacht bijgewerkt, of nu met Nu bijwerken op het overzicht.");
  expect(within(update).getByRole("link", { name: "het overzicht" })).toHaveAttribute("href", "/beheer/boekhouding");
});

it("says why a file cannot be read", async () => {
  open();
  // A bank statement, picked with "Alle bestanden".
  await choose(xaf(camtXml, "ing-betaal.xml"), userEvent.setup({ applyAccept: false }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Dit is geen auditbestand van e-Boekhouden.");
  await choose(xaf(buildXaf({ fiscalYear: 2025 })));
  expect(await screen.findByRole("alert")).toHaveTextContent("Dit auditbestand gaat niet over 2026.");
  const lopsided = booking("MEMO", "10020", "2026-08-01", "Scheef", debit("1080", "10"), credit("8040", "9"));
  await choose(xaf(buildXaf({ extraBookings: [lopsided] })));
  expect(await screen.findByRole("alert")).toHaveTextContent("Er staat een boeking in die niet sluit; download het bestand opnieuw.");
  expect(screen.queryByRole("button", { name: "Overnemen" })).not.toBeInTheDocument();
  expect(calls("POST")).toHaveLength(0);
});
