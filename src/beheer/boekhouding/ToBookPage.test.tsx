import { screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import spaarXml from "../../../shared/fixtures/camt-ing-spaar.xml?raw";
import { calls, mockApi, mockLoggedIn, renderAt, tap, user } from "../../test-utils";
import { accounts, bankLine, base, entry, moneyAccount } from "./ledger-test-data";

const page = "/beheer/boekhouding/te-boeken";
const open = (lines = [bankLine()], more: Record<string, unknown> = {}) => {
  mockLoggedIn();
  mockApi({ [`${base}/accounts`]: accounts, [`${base}/money-accounts`]: [moneyAccount()], [`${base}/bank/lines`]: lines, ...more });
};
const xml = () => new File([spaarXml], "afschrift.xml", { type: "text/xml" });

it("reads a bank file in the browser and sends its lines", async () => {
  open([], { [`POST ${base}/bank/import`]: { added: 1, known: 0, beforeStart: 0, autoBooked: 0 } });
  renderAt(page);
  await user().upload(await screen.findByLabelText("Bankbestand inlezen"), xml());
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  const post = calls("POST")[0]!;
  expect(post.url).toBe(`${base}/bank/import`);
  const body = post.body as { accountCode: string; statement: { account: string; lines: unknown[] } };
  expect(body.accountCode).toBe("1020");
  expect(body.statement.account).toBe("V00000000");
  expect(body.statement.lines).toHaveLength(1);
  expect(await screen.findByText("1 nieuw, 0 al bekend, 0 vanzelf geboekt.")).toBeInTheDocument();
});

it("says when a file belongs to another account", async () => {
  open([], { [`POST ${base}/bank/import`]: [409, { error: "wrong_account" }] });
  renderAt(page);
  await user().upload(await screen.findByLabelText("Bankbestand inlezen"), xml());
  expect(await screen.findByText("Dit bestand hoort bij een andere rekening (V00000000).")).toBeInTheDocument();
});

it("says when a file is not a bank statement", async () => {
  open([]);
  renderAt(page);
  await user().upload(await screen.findByLabelText("Bankbestand inlezen"), new File(["<a/>"], "x.xml", { type: "text/xml" }));
  expect(await screen.findByText("Dit is geen bankafschrift dat ik kan lezen (CAMT.053).")).toBeInTheDocument();
  expect(calls("POST")).toHaveLength(0);
});

it("books a line with the suggested account in one tap", async () => {
  open([bankLine()], { [`POST ${base}/bank/lines/l1/book`]: entry() });
  renderAt(page);
  const row = within(await screen.findByRole("listitem", { name: /Goodoo BV/ }));
  expect(row.getByRole("combobox", { name: "Rekening" })).toHaveValue("4501");
  expect(row.queryByRole("option", { name: "4999 Oude kosten" })).not.toBeInTheDocument();
  expect(row.queryByRole("option", { name: "1010 ING betaalrekening" })).not.toBeInTheDocument();
  await tap("Boeken");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({ url: `${base}/bank/lines/l1/book`, body: { split: [{ accountCode: "4501", amountCents: 41280 }] } });
});

it("splits a line and refuses a split that does not add up", async () => {
  open([bankLine({ suggestion: null })], { [`POST ${base}/bank/lines/l1/book`]: entry() });
  renderAt(page);
  await tap("Verdelen");
  await user().selectOptions(screen.getByLabelText("Rekening 1"), "4501");
  await user().type(screen.getByLabelText("Bedrag 1"), "300");
  await user().selectOptions(screen.getByLabelText("Rekening 2"), "4514");
  expect(screen.getByText("Het verdeelde bedrag klopt niet: verschil € 112,80")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Boeken" })).toBeDisabled();
  await user().type(screen.getByLabelText("Bedrag 2"), "112,80");
  expect(screen.queryByText(/klopt niet/)).not.toBeInTheDocument();
  await tap("Boeken");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]!.body).toEqual({
    split: [
      { accountCode: "4501", amountCents: 30000 },
      { accountCode: "4514", amountCents: 11280 },
    ],
  });
});

it("posts a credit line with negative amounts", async () => {
  open([bankLine({ amountCents: 609147, suggestion: "8020" })], { [`POST ${base}/bank/lines/l1/book`]: entry() });
  renderAt(page);
  await tap("Boeken");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]!.body).toEqual({ split: [{ accountCode: "8020", amountCents: -609147 }] });
});

it("shows a waiting line and a line in a closed year without a Boeken button", async () => {
  open([
    bankLine({ id: "w", status: "waiting", waitingFor: "mollie", counterpartyName: "Mollie", suggestion: null }),
    bankLine({ id: "c", counterpartyName: "Oud", date: "2026-12-30", inClosedYear: true }),
  ]);
  renderAt(page);
  expect(await screen.findByText("wacht op Mollie")).toBeInTheDocument();
  expect(screen.getByText("valt in afgesloten jaar 2026")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Boeken" })).not.toBeInTheDocument();
});

it("tells why a payout of Mollie was not booked by itself, and lets him book it", async () => {
  open([bankLine({ counterpartyName: "Stichting Mollie Payments", amountCents: 9800, suggestion: null, note: "Bedrag wijkt af van de uitbetaling bij Mollie (€ 98,12)" })]);
  renderAt(page);
  const row = within(await screen.findByRole("listitem", { name: /Stichting Mollie Payments/ }));
  expect(row.getByText("Bedrag wijkt af van de uitbetaling bij Mollie (€ 98,12)")).toBeInTheDocument();
  expect(row.getByRole("button", { name: "Boeken" })).toBeInTheDocument();
});

it("keeps a receipt with the line and uploads it once the line is booked", async () => {
  open([bankLine()], { [`POST ${base}/bank/lines/l1/book`]: entry(), [`POST ${base}/entries/e1/attachments`]: [201, { id: "a1" }] });
  renderAt(page);
  const photo = new File(["x"], "bon.jpg", { type: "image/jpeg" });
  await user().upload(await screen.findByLabelText("Bijlage"), photo);
  expect(screen.getByText("bon.jpg")).toBeInTheDocument();
  await tap("Boeken");
  await waitFor(() => expect(calls("POST")).toHaveLength(2));
  expect(calls("POST")[1]!.url).toBe(`${base}/entries/e1/attachments`);
});

it("tells the booking stands when its receipt could not be saved", async () => {
  open([bankLine()], { [`POST ${base}/bank/lines/l1/book`]: entry(), [`POST ${base}/entries/e1/attachments`]: [400, { error: "too_large" }] });
  renderAt(page);
  await user().upload(await screen.findByLabelText("Bijlage"), new File(["x"], "bon.pdf", { type: "application/pdf" }));
  await tap("Boeken");
  expect(await screen.findByText(/De boeking staat erin, maar de bijlage is niet opgeslagen/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Naar de boeking" })).toHaveAttribute("href", "/beheer/boekhouding/boekingen/e1");
});

it("types a bank line by hand", async () => {
  open([], { [`POST ${base}/bank/lines`]: [201, bankLine()] });
  renderAt(page);
  await tap("Regel intypen");
  await user().selectOptions(screen.getByLabelText("Rekening"), "1020");
  await user().clear(screen.getByLabelText("Datum"));
  await user().type(screen.getByLabelText("Datum"), "2027-02-03");
  await user().type(screen.getByLabelText("Bedrag"), "-12,50");
  await user().type(screen.getByLabelText("Omschrijving"), "Pinkosten");
  await tap("Regel toevoegen");
  await waitFor(() => expect(calls("POST")).toHaveLength(1));
  expect(calls("POST")[0]).toMatchObject({
    url: `${base}/bank/lines`,
    body: { accountCode: "1020", date: "2027-02-03", amountCents: -1250, description: "Pinkosten" },
  });
});
