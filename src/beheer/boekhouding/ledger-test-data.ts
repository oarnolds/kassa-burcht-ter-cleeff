// Made-up data for the tests of the boekhouding pages.

import type { BankLine, Entry, LedgerAccount, MoneyAccount } from "../../../shared/ledger-types";

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
