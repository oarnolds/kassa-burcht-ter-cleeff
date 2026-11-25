import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { VASTE_ACTIVA_2026 } from "../../../shared/fixtures/vaste-activa-2026";
import type { Asset, DepreciationPlan } from "../../../shared/ledger-types";
import { calls, mockApi, mockLoggedIn, renderAt, rowIn, tap, user } from "../../test-utils";
import { base, entry } from "./ledger-test-data";

const page = "/beheer/boekhouding/toestellen";

const asset = (extra: Partial<Asset> = {}): Asset => ({
  id: "a1",
  name: "Straaljager",
  purchaseDate: "2008-01-01",
  costCents: 949600,
  residualCents: 0,
  lifeYears: 20,
  writtenOffCents: 902120,
  bookValueCents: 47480,
  disposedOn: null,
  ...extra,
});
const dome = asset({ id: "a2", name: "Dome - Kopan", purchaseDate: "2012-07-10", costCents: 4445721, writtenOffCents: 3072928, bookValueCents: 1372793 });
const plan = (extra: Partial<DepreciationPlan> = {}): DepreciationPlan => ({
  year: 2027,
  rows: [
    { assetId: "a1", name: "Straaljager", cents: 47480 },
    { assetId: "a2", name: "Dome - Kopan", cents: 212286 },
  ],
  totalCents: 259766,
  booked: false,
  upToDate: false,
  laterBooked: null,
  ...extra,
});

function open(assets: Asset[] = [asset(), dome], more: Record<string, unknown> = {}) {
  mockLoggedIn();
  mockApi({ [`${base}/assets`]: assets, [`${base}/depreciation`]: plan(), ...more });
}

/** The page during December 2027, so the year to depreciate is 2027 whenever the test runs. */
function inDecember2027() {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-12-20T10:00:00.000Z") });
}

it("shows the toestellen with their value", async () => {
  inDecember2027();
  open([asset(), dome, asset({ id: "a3", name: "Wip", purchaseDate: "2015-04-01", costCents: 100000, writtenOffCents: 100000, bookValueCents: 0, disposedOn: "2027-03-20" })]);
  renderAt(page);
  expect(await screen.findByRole("heading", { name: "Toestellen" })).toBeInTheDocument();
  await within(await screen.findByRole("region", { name: "Lijst" })).findByText("Straaljager");
  const row = rowIn("Lijst", "Dome - Kopan");
  expect(row.getByText("10-07-2012")).toBeInTheDocument();
  expect(row.getByText("€ 44.457,21")).toBeInTheDocument();
  expect(row.getByText("€ 30.729,28")).toBeInTheDocument();
  expect(row.getByText("€ 13.727,93")).toBeInTheDocument();
  expect(row.getByText("20 jaar")).toBeInTheDocument();
  expect(row.getByRole("button", { name: "Dome - Kopan afvoeren" })).toBeInTheDocument();
  const gone = rowIn("Lijst", "Wip");
  expect(gone.getByText("afgevoerd 20-03-2027")).toBeInTheDocument();
  expect(gone.queryByRole("button", { name: "Wip afvoeren" })).not.toBeInTheDocument();
});

it("shows what it read from a paste and what it skipped, and takes it over", async () => {
  inDecember2027();
  open([], { [`POST ${base}/assets/paste`]: [asset(), dome] });
  renderAt(page);
  const box = await screen.findByLabelText("Overzicht uit e-Boekhouden");
  expect(screen.getByRole("button", { name: "Overnemen" })).toBeDisabled();
  fireEvent.change(box, { target: { value: VASTE_ACTIVA_2026 } });

  const read = screen.getByRole("region", { name: "Plakken uit e-Boekhouden" });
  expect(within(read).getByText("2 toestellen gelezen")).toBeInTheDocument();
  expect(rowIn("Plakken uit e-Boekhouden", "Dome - Kopan").getByText("€ 28.606,42")).toBeInTheDocument();
  expect(within(read).getByText("3 regels overgeslagen")).toBeInTheDocument();
  expect(within(read).getByText("Speeltoestellen")).toBeInTheDocument();
  expect(calls("POST")).toHaveLength(0);

  await tap("Overnemen");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toEqual({
    method: "POST",
    url: `${base}/assets/paste`,
    body: {
      assets: [
        { name: "Straaljager", purchaseDate: "2008-01-01", costCents: 949600, writtenOffCents: 854640, lifeYears: 20 },
        { name: "Dome - Kopan", purchaseDate: "2012-07-10", costCents: 4445721, writtenOffCents: 2860642, lifeYears: 20 },
      ],
    },
  });
  expect(await screen.findByText("Overgenomen.")).toBeInTheDocument();
  expect(screen.getByLabelText("Overzicht uit e-Boekhouden")).toHaveValue("");
});

it("asks for Vaste activa 2026 at its state of 1 January", async () => {
  inDecember2027();
  open([]);
  renderAt(page);
  const box = await screen.findByLabelText("Overzicht uit e-Boekhouden");
  expect(
    screen.getByText(
      "Kopieer in e-Boekhouden het overzicht Vaste activa 2026 en plak het hier. De app neemt de stand van 1 januari 2026 over en boekt de afschrijving van 2026 zelf. Overnemen vervangt wat eerder is overgenomen; gekochte toestellen blijven staan. De restwaarde staat er niet in: vul die daarna per toestel in.",
    ),
  ).toBeInTheDocument();
  fireEvent.change(box, { target: { value: VASTE_ACTIVA_2026 } });
  expect(within(screen.getByRole("region", { name: "Plakken uit e-Boekhouden" })).getByText("Afgeschreven t/m 2025")).toBeInTheDocument();
});

it("says why a paste is refused", async () => {
  inDecember2027();
  open([asset()], { [`POST ${base}/assets/paste`]: [409, { error: "depreciation_booked" }] });
  renderAt(page);
  fireEvent.change(await screen.findByLabelText("Overzicht uit e-Boekhouden"), { target: { value: VASTE_ACTIVA_2026 } });
  await tap("Overnemen");
  expect(await screen.findByText("De afschrijving is al geboekt. De lijst uit e-Boekhouden kan niet meer worden vervangen.")).toBeInTheDocument();
});

it("changes the residual value of a toestel", async () => {
  inDecember2027();
  open([asset(), dome], { [`PATCH ${base}/assets/a2`]: { ...dome, residualCents: 200000 } });
  renderAt(page);
  await tap("Dome - Kopan wijzigen");
  const form = screen.getByRole("region", { name: "Wijzigen: Dome - Kopan" });
  expect(within(form).getByLabelText("Naam")).toHaveValue("Dome - Kopan");
  expect(within(form).getByLabelText("Levensduur in jaren")).toHaveValue("20");
  await user().type(within(form).getByLabelText("Restwaarde"), "2.000,00");
  await user().click(within(form).getByRole("button", { name: "Opslaan" }));
  await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
  expect(calls("PATCH")[0]).toMatchObject({ url: `${base}/assets/a2`, body: { residualCents: 200000, lifeYears: 20 } });
  expect(calls("PATCH")[0]!.body).not.toHaveProperty("name");
  expect(await screen.findByText("Opgeslagen.")).toBeInTheDocument();
});

it("renames a toestel and refuses a life it cannot use", async () => {
  inDecember2027();
  open([asset(), dome], { [`PATCH ${base}/assets/a2`]: { ...dome, name: "Dome-Kopan" } });
  renderAt(page);
  await tap("Dome - Kopan wijzigen");
  const form = within(screen.getByRole("region", { name: "Wijzigen: Dome - Kopan" }));
  await user().clear(form.getByLabelText("Levensduur in jaren"));
  await user().type(form.getByLabelText("Levensduur in jaren"), "0");
  expect(form.getByText("Een levensduur van 1 tot 50 jaar.")).toBeInTheDocument();
  expect(form.getByRole("button", { name: "Opslaan" })).toBeDisabled();
  await user().clear(form.getByLabelText("Levensduur in jaren"));
  await user().type(form.getByLabelText("Levensduur in jaren"), "15");
  await user().clear(form.getByLabelText("Naam"));
  await user().type(form.getByLabelText("Naam"), "Dome-Kopan");
  await user().click(form.getByRole("button", { name: "Opslaan" }));
  await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
  expect(calls("PATCH")[0]!.body).toEqual({ name: "Dome-Kopan", residualCents: 0, lifeYears: 15 });
});

it("shows the depreciation of the year per toestel and books it", async () => {
  inDecember2027();
  open([asset(), dome], { [`POST ${base}/depreciation`]: entry({ source: "depreciation" }) });
  renderAt(page);
  const section = await screen.findByRole("region", { name: "Afschrijving 2027" });
  await within(section).findByText("€ 2.597,66");
  expect(rowIn("Afschrijving 2027", "Straaljager").getByText("€ 474,80")).toBeInTheDocument();
  expect(rowIn("Afschrijving 2027", "Dome - Kopan").getByText("€ 2.122,86")).toBeInTheDocument();
  expect(within(section).getByText("Nog niet geboekt.")).toBeInTheDocument();
  expect(calls("GET").some((call) => call.url === `${base}/depreciation`)).toBe(true);

  await tap("Afschrijving 2027 boeken");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({ url: `${base}/depreciation`, body: { year: 2027 } });
  expect(await screen.findByText("Geboekt.")).toBeInTheDocument();
  // It stays on the year just booked, even when the Worker would now start on the next one.
  await waitFor(() => expect(calls("GET").some((call) => call.url === `${base}/depreciation?year=2027`)).toBe(true));
});

it("says when the depreciation of the year is booked already", async () => {
  inDecember2027();
  open([asset()], { [`${base}/depreciation`]: plan({ booked: true, upToDate: true }) });
  renderAt(page);
  expect(await screen.findByText("Geboekt op 31-12-2027. Opnieuw boeken vervangt die boeking.")).toBeInTheDocument();
});

/** The plan the Worker gives for a year; without one, for the earliest open year still to book (here 2027). */
const plans = (byYear: Record<number, Partial<DepreciationPlan>>) => (req: { url: string }) => {
  const asked = new URL(req.url, "http://localhost").searchParams.get("year");
  const year = asked === null ? 2027 : Number(asked);
  return plan({ year, ...byYear[year] });
};

it("starts at the earliest year whose depreciation is still to book, in February 2028", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2028-02-01T10:00:00.000Z") });
  open([asset(), dome], { [`${base}/depreciation`]: plans({}) });
  renderAt(page);
  expect(await screen.findByRole("region", { name: "Afschrijving 2027" })).toBeInTheDocument();
  expect(calls("GET").find((call) => call.url.startsWith(`${base}/depreciation`))!.url).toBe(`${base}/depreciation`);
  expect(screen.getByLabelText("Jaar")).toHaveValue("2027");
  expect(within(screen.getByLabelText("Jaar")).getAllByRole("option").map((option) => option.textContent)).toEqual(["2026", "2027", "2028"]);
});

it("says to book the year before first, and to undo a later year first", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2028-02-01T10:00:00.000Z") });
  open([asset(), dome], {
    [`${base}/depreciation`]: plans({ 2027: { booked: true, upToDate: false, laterBooked: 2028 }, 2028: { booked: false } }),
    [`POST ${base}/depreciation`]: (req: { body: { year: number } }) => [409, { error: req.body.year === 2027 ? "depreciation_later" : "depreciation_first" }],
  });
  renderAt(page);
  await screen.findByRole("region", { name: "Afschrijving 2027" });
  expect(await screen.findByText("Geboekt op 31-12-2027, maar de bedragen zijn sindsdien veranderd. Opnieuw boeken past dat aan.")).toBeInTheDocument();
  await tap("Afschrijving 2027 boeken");
  expect(await screen.findByText("Er is al afgeschreven over 2028; pas dat eerst aan.")).toBeInTheDocument();

  await user().selectOptions(screen.getByLabelText("Jaar"), "2028");
  await screen.findByRole("region", { name: "Afschrijving 2028" });
  await tap("Afschrijving 2028 boeken");
  expect(await screen.findByText("Boek eerst de afschrijving van 2027.")).toBeInTheDocument();
});

it("empties a year's depreciation after asking", async () => {
  inDecember2027();
  open([asset(), dome], { [`${base}/depreciation`]: plan({ booked: true, upToDate: true }), [`POST ${base}/depreciation`]: entry({ source: "depreciation", lines: [] }) });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  renderAt(page);
  await tap("Afschrijving 2027 leegmaken");
  expect(confirm).toHaveBeenCalledWith("De afschrijving van 2027 leegmaken? Daarna kan het jaar ervoor opnieuw worden geboekt.");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({ url: `${base}/depreciation`, body: { year: 2027, empty: true } });
  expect(await screen.findByText("Leeggemaakt.")).toBeInTheDocument();
  confirm.mockRestore();
});

it("disposes of a toestel on a date, after asking once more", async () => {
  inDecember2027();
  open([asset(), dome], { [`POST ${base}/assets/a2/dispose`]: entry({ source: "disposal" }) });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  renderAt(page);
  await tap("Dome - Kopan afvoeren");
  const form = screen.getByRole("region", { name: "Afvoeren: Dome - Kopan" });
  const date = within(form).getByLabelText("Datum van afvoeren");
  await user().clear(date);
  await user().type(date, "2027-03-20");
  await user().click(within(form).getByRole("button", { name: "Afvoeren" }));
  expect(confirm).toHaveBeenCalledWith("Dome - Kopan afvoeren op 20-03-2027? De boekwaarde gaat naar afschrijving.");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({ url: `${base}/assets/a2/dispose`, body: { date: "2027-03-20" } });
  expect(await screen.findByText("Afgevoerd.")).toBeInTheDocument();
  confirm.mockRestore();
});

it("does not dispose of a toestel when he says no", async () => {
  inDecember2027();
  open([asset(), dome]);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  renderAt(page);
  await tap("Straaljager afvoeren");
  await user().click(within(screen.getByRole("region", { name: "Afvoeren: Straaljager" })).getByRole("button", { name: "Afvoeren" }));
  expect(confirm).toHaveBeenCalled();
  expect(calls("POST")).toHaveLength(0);
  confirm.mockRestore();
});
