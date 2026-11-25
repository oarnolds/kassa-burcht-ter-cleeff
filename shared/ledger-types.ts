// The boekhouding: types shared by the Worker and beheer. Amounts are integer cents, debit positive, credit negative.

export type AccountKind = "asset" | "liability" | "equity" | "expense" | "income";

/** `formerly`: the e-Boekhouden numbers this account takes over, so 2026 can be laid next to earlier years. */
export type LedgerAccount = { code: string; name: string; kind: AccountKind; money: boolean; hidden: boolean; formerly: string[] };

/** Who wrote an entry. Only `manual` and `bank` are the penningmeester's; the rest follow their own source. */
export type EntrySource =
  | "manual"
  | "opening"
  | "bank"
  | "kassa_day"
  | "kassa_late"
  | "handover"
  | "mollie_other"
  | "mollie_settlement"
  | "depreciation"
  | "disposal"
  | "closing"
  | "eboekhouden";

export type EntryLine = { accountCode: string; amountCents: number; note: string | null; assetId: string | null };

export type Attachment = { id: string; filename: string; contentType: string; sizeBytes: number; uploadedAt: string };

export type Entry = {
  id: string;
  year: number;
  /** Numbered per year, one after the other. */
  number: number;
  date: string;
  description: string;
  source: EntrySource;
  sourceRef: string | null;
  lines: EntryLine[];
  attachments: Attachment[];
  /** The penningmeester may change it: a `manual` or `bank` entry in an open year. */
  editable: boolean;
  /** It was changed after it was made; the history says how. */
  changed: boolean;
};

export type EntryChange = {
  at: string;
  /** Set when the change is not an edit, e.g. "bijlage verborgen: bon.pdf". */
  note: string | null;
  before: { date: string; description: string; lines: EntryLine[] } | null;
  after: { date: string; description: string; lines: EntryLine[] };
};

/** The first day the app keeps the books. Everything before it stays in e-Boekhouden. */
export const LEDGER_START = "2026-01-01";
/** The first day of bank lines in the app; before it the bank is in e-Boekhouden's auditfile. */
export const OVERSTAP = "2026-11-25";
/** The first day of Mollie payments, refunds and chargebacks in the app; earlier ones are in payouts e-Boekhouden booked. */
export const MOLLIE_START = "2026-11-01";
/**
 * A Mollie payout's reference as ING writes it in a line's description. Bounded by digits, not words: ING may glue a
 * letter to it ("T05665564.2611.01"), and a longer run of digits is no reference.
 */
export const PAYOUT_REFERENCE = /(?<!\d)\d{7,8}\.\d{4}\.\d{2}(?!\d)/;

/** Where a money account's lines come from. 1000 follows the kassa and 1030 Mollie; a bank is a file or Enable Banking. */
export type MoneySource = "file" | "enable_banking" | "kassa" | "mollie";

/**
 * A money account next to what the bank said. `bank` is the newest balance the bank gave (from a file or Enable
 * Banking); `ledgerCents` is the ledger on that same date (today without one); `differenceCents` = ledger − bank,
 * for 1030 less the payouts of Mollie still on their way to ING on that date.
 */
export type MoneyAccount = {
  accountCode: string;
  name: string;
  /** What the app knows the account by in a file or at Enable Banking: an IBAN, or a savings account's number. */
  identifier: string | null;
  source: MoneySource;
  ledgerCents: number;
  bank: { date: string; balanceCents: number } | null;
  differenceCents: number | null;
};

export type BankLine = {
  id: string;
  accountCode: string;
  date: string;
  amountCents: number;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  description: string;
  status: "open" | "booked" | "waiting";
  waitingFor: "mollie" | null;
  note: string | null;
  entryId: string | null;
  /** The account proposed for the other side; filled by `openLines`. */
  suggestion: string | null;
  /** Dated in a closed year: it waits, and cannot be booked there. */
  inClosedYear: boolean;
};

/** `known`: lines that were already there. `beforeStart`: lines before OVERSTAP, not kept. */
export type ImportResult = { added: number; known: number; beforeStart: number; autoBooked: number };

/** Where the consent for ING (Enable Banking) stands. `daysLeft` is whole days until `validUntil` (0 on the last day); below 0 once the consent has ended, also when it ended early (`validUntil` is then the day it was noticed). */
export type ConsentState = { status: "none" | "pending" | "active" | "expired"; validUntil: string | null; daysLeft: number | null };

/** The penningmeester's rule for Mollie's other payments: a description that holds `keyword` (case ignored) books on `accountCode`. */
export type MollieRule = { id: string; keyword: string; accountCode: string };

/**
 * A month of Mollie next to the books (`month` is `YYYY-MM`). The kassa's pin (paid pin sales, turned-back ones
 * included) next to Mollie's terminal payments, with the payments found on one side only; the other payments
 * booked by rule, per account; Mollie's costs of the payouts settled in the month; and 1030 next to Mollie's
 * balance at the end of the month (today in the current one). `inTransitCents`: payouts that have left Mollie but
 * are not on ING yet (amount plus costs), which 1030 still holds; `differenceCents` = ledger − in transit − Mollie,
 * null without a balance from Mollie.
 */
export type MollieMonth = {
  month: string;
  kassaPinCents: number;
  molliePosCents: number;
  onlyInKassa: { saleId: string; date: string; amountCents: number }[];
  onlyAtMollie: { paymentId: string; date: string; amountCents: number }[];
  otherByAccount: { accountCode: string; cents: number }[];
  costsCents: number;
  balance: { ledgerCents: number; mollieCents: number | null; inTransitCents: number; differenceCents: number | null };
};

export type NightlyStep = "kassa" | "ing" | "mollie";
/** What the nightly run did, step by step; a string other than ok/skipped is the error code of a step that failed. */
export type NightlyReport = { at: string; steps: Partial<Record<NightlyStep, "ok" | "skipped" | string>> };

// What the reports and the overview answer (worker/db/ledger-reports.ts builds them).
export type BalanceReport = {
  date: string;
  rows: { code: string; name: string; kind: AccountKind; cents: number }[];
  assetsCents: number;
  liabilitiesAndEquityCents: number;
  /** The result not yet booked to 1400: assets = liabilities and equity + result. */
  resultCents: number;
};
export type ResultReport = {
  from: string;
  to: string;
  rows: { code: string; name: string; kind: "income" | "expense"; cents: number; previousCents: number | null }[];
  resultCents: number;
  previousResultCents: number | null;
};
/** A year before LEDGER_START with comparison figures (read from e-Boekhouden or typed), as its result shows it. */
export type ComparisonYear = { year: number; incomeCents: number; costsCents: number; resultCents: number };
/**
 * The result per account with a column per year: the years with comparison figures, then every year of the books
 * (closing entries left out). `cents[i]` and `results[i]` belong to `years[i]`; null where that year has nothing.
 */
export type MultiYearReport = {
  years: number[];
  rows: { code: string; name: string; kind: "income" | "expense"; cents: (number | null)[] }[];
  results: (number | null)[];
};
export type AccountLines = {
  code: string;
  openingCents: number;
  lines: { entryId: string; number: number; date: string; description: string; amountCents: number; runningCents: number }[];
};
export type LedgerOverview = {
  openLines: number;
  waitingLines: number;
  moneyAccounts: MoneyAccount[];
  resultYearCents: number;
  cashDifferenceCents: number;
  consent: { validUntil: string; daysLeft: number } | null;
  /** 1030 against Mollie's balance, payouts on their way to ING left out; null without a balance from Mollie. */
  mollieDifferenceCents: number | null;
  /** Payouts that have left Mollie but are not on ING yet, on the date of Mollie's newest balance (amount plus costs). */
  mollieInTransitCents: number;
  lastNightly: NightlyReport | null;
  /**
   * When the books were last brought up to date (the last run, or without one the moment the kassa went into use),
   * when that is more than 36 hours ago: the nightly run stopped happening. Null while all is well, or on trial.
   */
  notUpdatedSince: string | null;
  /** Per money account (only those with any), the lines still to book dated up to the bank's newest balance: part of its difference. */
  toBookByAccount: Record<string, number>;
  /** The auditfile of e-Boekhouden has been read in; until then the app books nothing by itself. */
  eboekhoudenDone: boolean;
};

/**
 * One of the checks before a year is closed (spec §13), with a Dutch sentence of what was found. Only a `required`
 * check stops the closing; when another one fails, the penningmeester closes with a toelichting.
 */
export type YearCheck = {
  key: "bank_lines" | "bank_balances" | "cash" | "mollie" | "depreciation" | "in_transit" | "assets";
  ok: boolean;
  detail: string;
  required: boolean;
};

/** A year of the books, with its closing and reopening, oldest first. `note`: the toelichting or the reason. */
export type LedgerYear = {
  year: number;
  status: "open" | "closed";
  closedAt: string | null;
  closeNote: string | null;
  events: { at: string; kind: "closed" | "reopened"; note: string | null }[];
};

/**
 * A toestel of the list behind 0130 and 0135 (spec §12). `costCents`: pasted from e-Boekhouden, or for one bought
 * later what is booked on 0130 for it; `purchaseDate` is then the date of its first 0130 line (null while there is
 * none). `writtenOffCents`: up to 31 December 2026 from e-Boekhouden plus what is on 0135 for it since. A toestel
 * that is disposed of has nothing left: `writtenOffCents` = `costCents`, `bookValueCents` 0.
 */
export type Asset = {
  id: string;
  name: string;
  purchaseDate: string | null;
  costCents: number;
  residualCents: number;
  lifeYears: number;
  writtenOffCents: number;
  bookValueCents: number;
  disposedOn: string | null;
};

/**
 * What "Afschrijving {jaar} boeken" books: a row per toestel with something to write off. `booked`: the year's entry
 * has lines; `upToDate`: it books exactly these rows (with nothing to write off, no lines). `laterBooked`: the first
 * later year whose depreciation has lines, which must be undone before this year can change.
 */
export type DepreciationPlan = {
  year: number;
  rows: { assetId: string; name: string; cents: number }[];
  totalCents: number;
  booked: boolean;
  upToDate: boolean;
  laterBooked: number | null;
};

/**
 * What the jaaroverzicht reads in one call (spec §13, R35); the entries and their changes come in pages of
 * `YEAR_PAGE`. `opening`: everything dated before 1 January (the closing entries of earlier years included) plus the
 * year's own opening entry. `closing`: the balance on 31 December, the year's result apart (R8). `result`: next to
 * the year before. `accounts`: every account, in order, for the names in the Excel file.
 */
export type YearExport = {
  year: number;
  status: "open" | "closed";
  opening: BalanceReport;
  closing: BalanceReport;
  result: ResultReport;
  checks: YearCheck[];
  events: LedgerYear["events"];
  assets: Asset[];
  depreciation: DepreciationPlan;
  entryCount: number;
  accounts: Pick<LedgerAccount, "code" | "name" | "kind">[];
};

/** A change of one of the year's entries, for the jaaroverzicht; `id` orders them and asks for the next page. */
export type YearChange = EntryChange & { id: number; entryId: string; number: number };

/** At most this many entries or changes in one page of the jaaroverzicht, so one request stays within the CPU limit. */
export const YEAR_PAGE = 500;
