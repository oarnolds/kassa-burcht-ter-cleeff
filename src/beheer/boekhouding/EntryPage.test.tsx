import { screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { expect, it } from "vitest";
import type { EntryChange } from "../../../shared/ledger-types";
import { calls, mockApi, mockLoggedIn, renderAt, tap, user } from "../../test-utils";
import { accounts, base, entry } from "./ledger-test-data";

const page = "/beheer/boekhouding/boekingen/e1";
const open = (e = entry(), history: EntryChange[] = [], more: Record<string, unknown> = {}) => {
  mockLoggedIn();
  mockApi({ [`${base}/accounts`]: accounts, [`${base}/entries/e1`]: e, [`${base}/entries/e1/history`]: history, ...more });
};

it("shows what an entry was before it was changed", async () => {
  open(entry({ changed: true }), [
    {
      at: "2027-02-01T10:30:00.000Z",
      note: null,
      before: { date: "2027-01-04", description: "Factuur", lines: [{ accountCode: "4514", amountCents: 41280, note: null, assetId: null }, { accountCode: "1010", amountCents: -41280, note: null, assetId: null }] },
      after: { date: "2027-01-04", description: "Factuur Goodoo", lines: entry().lines },
    },
    { at: "2027-02-02T09:00:00.000Z", note: "bijlage verborgen: bon.pdf", before: null, after: { date: "2027-01-04", description: "Factuur Goodoo", lines: entry().lines } },
  ]);
  renderAt(page);
  expect(await screen.findByRole("heading", { name: /Boeking 7/ })).toBeInTheDocument();
  const history = await screen.findByText(/Gewijzigd op 01-02-2027 11:30: eerst/);
  expect(history).toHaveTextContent("4514 Onderhoud € 412,80");
  expect(screen.getByText(/bijlage verborgen: bon.pdf/)).toBeInTheDocument();
});

it("offers Wijzigen and Leegmaken only for an editable entry", async () => {
  open(entry({ editable: false, source: "kassa_day" }));
  renderAt(page);
  await screen.findByRole("heading", { name: /Boeking 7/ });
  expect(screen.queryByRole("button", { name: "Wijzigen" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Leegmaken" })).not.toBeInTheDocument();
});

it("tells where a booking from e-Boekhouden is corrected", async () => {
  open(entry({ year: 2026, date: "2026-03-14", source: "eboekhouden", sourceRef: "1010:10003", editable: false }));
  renderAt(page);
  expect(await screen.findByText("Deze boeking kan niet worden aangepast.")).toBeInTheDocument();
  expect(screen.getByText("Hij komt uit e-Boekhouden. Corrigeer hem daar en lees het auditbestand opnieuw in, of maak een gewone boeking.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Wijzigen" })).not.toBeInTheDocument();
});

it("says nothing about e-Boekhouden for another booking that cannot be changed", async () => {
  open(entry({ editable: false, source: "kassa_day" }));
  renderAt(page);
  expect(await screen.findByText("Deze boeking kan niet worden aangepast.")).toBeInTheDocument();
  expect(screen.queryByText(/e-Boekhouden/)).not.toBeInTheDocument();
});

it("empties an entry after asking once", async () => {
  open(entry(), [], { [`POST ${base}/entries/e1/empty`]: entry({ lines: [], editable: true }) });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  renderAt(page);
  await tap("Leegmaken");
  expect(confirm).toHaveBeenCalledWith("Boeking 7 leegmaken? De boeking blijft bestaan met haar geschiedenis.");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  confirm.mockRestore();
});

it("changes an entry", async () => {
  open(entry(), [], { [`PUT ${base}/entries/e1`]: entry() });
  renderAt(page);
  await tap("Wijzigen");
  const description = screen.getByLabelText("Omschrijving");
  await user().clear(description);
  await user().type(description, "Anders");
  await tap("Opslaan");
  await waitFor(() => expect(calls("PUT")).toHaveLength(1));
  expect(calls("PUT")[0]!.body).toMatchObject({ description: "Anders", lines: [{ accountCode: "4501", amountCents: 41280 }, { accountCode: "1010", amountCents: -41280 }] });
});

it("adds a photo of a receipt to an entry", async () => {
  open(entry(), [], { [`POST ${base}/entries/e1/attachments`]: [201, { id: "a1" }] });
  renderAt(page);
  const input = await screen.findByLabelText("Bijlage toevoegen");
  expect(input).toHaveAttribute("accept", "application/pdf,image/jpeg,image/png");
  await user().upload(input, new File(["x"], "bon nr 1.jpg", { type: "image/jpeg" }));
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]!.url).toBe(`${base}/entries/e1/attachments`);
  const [, init] = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/attachments"))!;
  const headers = init!.headers as Record<string, string>;
  expect(headers["Content-Type"]).toBe("image/jpeg");
  expect(headers["X-Filename"]).toBe(encodeURIComponent("bon nr 1.jpg"));
  expect(headers["X-Requested-With"]).toBe("kassa");
});

it("links attachments and hides one", async () => {
  const attachment = { id: "a1", filename: "bon.pdf", contentType: "application/pdf", sizeBytes: 10, uploadedAt: "2027-01-05T10:00:00.000Z" };
  open(entry({ attachments: [attachment] }), [], { [`POST ${base}/attachments/a1/hide`]: { ok: true } });
  renderAt(page);
  const link = await screen.findByRole("link", { name: "bon.pdf" });
  expect(link).toHaveAttribute("href", `${base}/attachments/a1`);
  expect(link).toHaveAttribute("target", "_blank");
  await tap("Verbergen");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]!.url).toBe(`${base}/attachments/a1/hide`);
});

it("keeps the toestel of a line on 0130 when the entry is changed, and names it", async () => {
  const withToestellen = [...accounts, { code: "0130", name: "Speeltoestellen en inventaris", kind: "asset" as const, money: false, hidden: false, formerly: ["0130"] }];
  const schommel = { id: "a9", name: "Schommel", purchaseDate: "2027-01-04", costCents: 41280, residualCents: 0, lifeYears: 10, writtenOffCents: 0, bookValueCents: 41280, disposedOn: null };
  const bought = entry({
    source: "bank",
    lines: [
      { accountCode: "1010", amountCents: -41280, note: null, assetId: null },
      { accountCode: "0130", amountCents: 41280, note: null, assetId: "a9" },
    ],
  });
  open(bought, [], { [`${base}/accounts`]: withToestellen, [`${base}/assets`]: [schommel], [`PUT ${base}/entries/e1`]: bought });
  renderAt(page);
  await tap("Wijzigen");
  expect(await screen.findByText("Toestel: Schommel")).toBeInTheDocument();
  const description = screen.getByLabelText("Omschrijving");
  await user().clear(description);
  await user().type(description, "Schommel van Goodoo");
  await tap("Opslaan");
  await waitFor(() => expect(calls("PUT")).toHaveLength(1));
  expect(calls("PUT")[0]!.body).toEqual({
    date: "2027-01-04",
    description: "Schommel van Goodoo",
    lines: [
      { accountCode: "1010", amountCents: -41280, note: null },
      { accountCode: "0130", amountCents: 41280, note: null, assetId: "a9" },
    ],
  });
});

it("says that the purchase of a disposed toestel cannot be changed", async () => {
  const withToestellen = [...accounts, { code: "0130", name: "Speeltoestellen en inventaris", kind: "asset" as const, money: false, hidden: false, formerly: ["0130"] }];
  const bought = entry({
    source: "bank",
    lines: [
      { accountCode: "1010", amountCents: -41280, note: null, assetId: null },
      { accountCode: "0130", amountCents: 41280, note: null, assetId: "a9" },
    ],
  });
  open(bought, [], { [`${base}/accounts`]: withToestellen, [`${base}/assets`]: [], [`PUT ${base}/entries/e1`]: [409, { error: "asset_disposed" }] });
  renderAt(page);
  await tap("Wijzigen");
  await user().clear(screen.getByLabelText("Debet regel 2"));
  await user().type(screen.getByLabelText("Debet regel 2"), "400");
  await user().clear(screen.getByLabelText("Credit regel 1"));
  await user().type(screen.getByLabelText("Credit regel 1"), "400");
  await tap("Opslaan");
  expect(await screen.findByText("Dit toestel is afgevoerd; de aankoop kan niet meer worden gewijzigd.")).toBeInTheDocument();
});

it("starts Wijzigen of an emptied entry with two blank rows", async () => {
  open(entry({ lines: [], changed: true }));
  renderAt(page);
  expect(await screen.findByText("Deze boeking is leeggemaakt.")).toBeInTheDocument();
  await tap("Wijzigen");
  expect(screen.getByLabelText("Rekening regel 1")).toHaveValue("");
  expect(screen.getByLabelText("Rekening regel 2")).toHaveValue("");
  expect(screen.queryByLabelText("Rekening regel 3")).not.toBeInTheDocument();
});

it("says that a bank entry keeps the bank's line and date", async () => {
  open(entry({ source: "bank", sourceRef: "l1" }), [], { [`PUT ${base}/entries/e1`]: [409, { error: "bank_line_fixed" }] });
  renderAt(page);
  await tap("Wijzigen");
  await user().clear(screen.getByLabelText("Datum"));
  await user().type(screen.getByLabelText("Datum"), "2027-01-05");
  await tap("Opslaan");
  expect(await screen.findByText("De regel van de bank en de datum blijven zoals de bank ze gaf.")).toBeInTheDocument();
});

it("tells that emptying a bank entry puts its line back in Te boeken", async () => {
  open(entry({ source: "bank", sourceRef: "l1" }), [], { [`POST ${base}/entries/e1/empty`]: entry({ source: "bank", sourceRef: "l1", lines: [] }) });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  renderAt(page);
  await tap("Leegmaken");
  expect(confirm).toHaveBeenCalledWith("Boeking 7 leegmaken? De boeking blijft bestaan met haar geschiedenis, en de bankregel komt terug bij Te boeken.");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  confirm.mockRestore();
});

it("points an emptied bank entry to Te boeken", async () => {
  open(entry({ source: "bank", sourceRef: "l1", lines: [], changed: true }));
  renderAt(page);
  expect(await screen.findByText("Deze boeking is leeggemaakt.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "De bankregel staat weer bij Te boeken" })).toHaveAttribute("href", "/beheer/boekhouding/te-boeken");
});
