// Made-up data for the tests of the boekhouding pages.

import type { BankLine, Entry, LedgerAccount, MoneyAccount, YearChange, YearExport } from "../../../shared/ledger-types";

export const base = "/api/admin/boekhouding";

const account = (code: string, name: string, kind: LedgerAccount["kind"], extra: Partial<LedgerAccount> = {}): LedgerAccount => ({
  code,
  name,
  kind,
  money: false,
  hidden: false,
  formerly: [code],
  ...extra,
});

export const accounts: LedgerAccount[] = [
  account("1010", "ING betaalrekening", "asset", { money: true }),
  account("1020", "ING kwartaalrekening", "asset", { money: true }),
  account("4501", "Inkoop kiosk", "expense"),
  account("4514", "Onderhoud", "expense"),
  account("4999", "Oude kosten", "expense", { hidden: true }),
  account("8020", "Subsidie gemeente", "income"),
];

export const moneyAccount = (extra: Partial<MoneyAccount> = {}): MoneyAccount => ({
  accountCode: "1020",
  name: "ING kwartaalrekening",
  identifier: "V00000000",
  source: "file",
  ledgerCents: 0,
  bank: null,
  differenceCents: null,
  ...extra,
});

export const bankLine = (extra: Partial<BankLine> = {}): BankLine => ({
  id: "l1",
  accountCode: "1010",
  date: "2027-01-04",
  amountCents: -41280,
  counterpartyName: "Goodoo BV",
  counterpartyIban: null,
  description: "factuur 0001",
  status: "open",
  waitingFor: null,
  note: null,
  entryId: null,
  suggestion: "4501",
  inClosedYear: false,
  ...extra,
});

export const entry = (extra: Partial<Entry> = {}): Entry => ({
  id: "e1",
  year: 2027,
  number: 7,
  date: "2027-01-04",
  description: "Factuur Goodoo",
  source: "manual",
  sourceRef: null,
  lines: [
    { accountCode: "4501", amountCents: 41280, note: null, assetId: null },
    { accountCode: "1010", amountCents: -41280, note: null, assetId: null },
  ],
  attachments: [],
  editable: true,
  changed: false,
  ...extra,
});

/** The accounts the jaaroverzicht of the tests books on, as the Worker sends them. */
const yearAccounts: YearExport["accounts"] = [
  { code: "0130", name: "Speeltoestellen en inventaris", kind: "asset" },
  { code: "0135", name: "Afschrijving speeltoestellen en inventaris", kind: "asset" },
  { code: "1010", name: "ING betaalrekening", kind: "asset" },
  { code: "1400", name: "Eigen vermogen", kind: "equity" },
  { code: "1700", name: "Nog te betalen", kind: "liability" },
  { code: "4514", name: "Diversen", kind: "expense" },
  { code: "4601", name: "Afschrijving speeltoestellen en inventaris", kind: "expense" },
  { code: "8012", name: "Entree", kind: "income" },
  { code: "8030", name: "Rente", kind: "income" },
];
const balanceRow = (code: string, cents: number) => {
  const { name, kind } = yearAccounts.find((account) => account.code === code)!;
  return { code, name, kind, cents };
};

/**
 * 2027, closed: an opening of € 5.474,80, entree € 120, rente € 3, diversen € 25 and € 200 depreciation on the
 * Straaljager; a result of -€ 102,00, next to -€ 108,00 in 2026.
 */
export const yearData = (extra: Partial<YearExport> = {}): YearExport => ({
  year: 2027,
  status: "closed",
  opening: {
    date: "2027-01-01",
    rows: [balanceRow("0130", 949600), balanceRow("0135", -902120), balanceRow("1010", 500000), balanceRow("1400", 517480), balanceRow("1700", 30000)],
    assetsCents: 547480,
    liabilitiesAndEquityCents: 547480,
    resultCents: 0,
  },
  closing: {
    date: "2027-12-31",
    rows: [balanceRow("0130", 949600), balanceRow("0135", -922120), balanceRow("1010", 509800), balanceRow("1400", 517480), balanceRow("1700", 30000)],
    assetsCents: 537280,
    liabilitiesAndEquityCents: 547480,
    resultCents: -10200,
  },
  result: {
    from: "2027-01-01",
    to: "2027-12-31",
    rows: [
      { code: "4514", name: "Diversen", kind: "expense", cents: 2500, previousCents: 1800 },
      { code: "4601", name: "Afschrijving speeltoestellen en inventaris", kind: "expense", cents: 20000, previousCents: 20000 },
      { code: "8012", name: "Entree", kind: "income", cents: 12000, previousCents: 11000 },
      { code: "8030", name: "Rente", kind: "income", cents: 300, previousCents: 0 },
    ],
    resultCents: -10200,
    previousResultCents: -10800,
  },
  checks: [
    { key: "bank_lines", ok: true, detail: "Alle bankregels van 2027 zijn geboekt", required: true },
    { key: "bank_balances", ok: false, detail: "ING betaalrekening: boekhouding € 5.098,00, bank € 5.090,00 op 31-12-2027", required: false },
    { key: "cash", ok: true, detail: "Kas € 0,00, volgens de kassa € 0,00", required: false },
    { key: "mollie", ok: true, detail: "Mollie: boekhouding € 0,00, bij Mollie € 0,00 op 31-12-2027", required: false },
    { key: "depreciation", ok: true, detail: "Afschrijving 2027 is geboekt", required: false },
    { key: "in_transit", ok: true, detail: "1080 Kruisposten staat op nul", required: false },
    { key: "assets", ok: true, detail: "0130 € 9.496,00 en 0135 -€ 9.221,20, volgens de lijst toestellen € 9.496,00 en -€ 9.221,20", required: false },
  ],
  events: [
    { at: "2028-01-15T12:00:00.000Z", kind: "closed", note: "Rente volgt" },
    { at: "2028-02-03T09:00:00.000Z", kind: "reopened", note: "Kascommissie vond een fout" },
    { at: "2028-02-04T09:00:00.000Z", kind: "closed", note: null },
  ],
  assets: [
    {
      id: "a1",
      name: "Straaljager",
      purchaseDate: "2008-01-01",
      costCents: 949600,
      residualCents: 0,
      lifeYears: 20,
      writtenOffCents: 922120,
      bookValueCents: 27480,
      disposedOn: null,
    },
  ],
  depreciation: { year: 2027, rows: [{ assetId: "a1", name: "Straaljager", cents: 20000 }], totalCents: 20000, booked: true, upToDate: true, laterBooked: null },
  entryCount: 5,
  accounts: yearAccounts,
  ...extra,
});

const line = (accountCode: string, amountCents: number, note: string | null = null) => ({ accountCode, amountCents, note, assetId: null });
const file = (id: string, filename: string) => ({ id, filename, contentType: "application/pdf", sizeBytes: 100, uploadedAt: "2027-03-01T10:00:00.000Z" });

/** The entries of `yearData`, by number: the opening, entree, a factuur with two attachments, rente and the depreciation. */
export const yearEntries = (): Entry[] => [
  entry({
    id: "e1",
    number: 1,
    date: "2027-01-01",
    description: "Beginbalans 2027",
    source: "opening",
    sourceRef: "2027",
    lines: [line("0130", 949600), line("0135", -902120), line("1010", 500000), line("1700", -30000), line("1400", -517480)],
    editable: false,
  }),
  entry({ id: "e2", number: 2, date: "2027-02-01", description: "Entree & ijs <zomer>", lines: [line("1010", 12000), line("8012", -12000)] }),
  entry({
    id: "e12",
    number: 12,
    date: "2027-03-01",
    description: "Factuur Goodoo",
    lines: [line("4514", 2500, "schroeven"), line("1010", -2500)],
    attachments: [file("a1", "bon-goodoo.pdf"), file("a2", "foto.jpg")],
    changed: true,
  }),
  entry({ id: "e13", number: 13, date: "2027-12-31", description: "Rente", lines: [line("1010", 300), line("8030", -300)], attachments: [file("a3", "rente/overzicht:2027.pdf")] }),
  entry({ id: "e14", number: 14, date: "2027-12-31", description: "Afschrijving 2027", source: "depreciation", sourceRef: "2027", lines: [line("4601", 20000), line("0135", -20000)], editable: false }),
];

/** The changes of `yearEntries`: the factuur was typed with a wrong amount, and a wrong attachment was hidden. */
export const yearChanges = (): YearChange[] => {
  const typed = { date: "2027-03-01", description: "Factuur Goodo", lines: [line("4514", 2400), line("1010", -2400)] };
  const right = { date: "2027-03-01", description: "Factuur Goodoo", lines: [line("4514", 2500, "schroeven"), line("1010", -2500)] };
  return [
    { id: 4, entryId: "e12", number: 12, at: "2027-03-02T10:00:00.000Z", note: null, before: typed, after: right },
    { id: 9, entryId: "e12", number: 12, at: "2027-03-05T10:00:00.000Z", note: "bijlage verborgen: oud.pdf", before: right, after: right },
  ];
};
