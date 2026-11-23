// The boekhouding: types shared by the Worker and beheer. Amounts are integer cents, debit positive, credit negative.

export type AccountKind = "asset" | "liability" | "equity" | "expense" | "income";

/** `formerly`: the e-Boekhouden numbers this account takes over, so 2027 can be laid next to earlier years. */
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
  | "closing";

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
export const LEDGER_START = "2027-01-01";

/** Where a money account's lines come from. 1000 follows the kassa and 1030 Mollie; a bank is a file or Enable Banking. */
export type MoneySource = "file" | "enable_banking" | "kassa" | "mollie";

/**
 * A money account next to what the bank said. `bank` is the newest balance the bank gave (from a file or Enable
 * Banking); `ledgerCents` is the ledger on that same date (today without one); `differenceCents` = ledger − bank.
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

/** `known`: lines that were already there. `beforeStart`: lines before LEDGER_START, not kept. */
export type ImportResult = { added: number; known: number; beforeStart: number; autoBooked: number };

export type NightlyStep = "kassa" | "ing" | "mollie";
/** What the nightly run did, step by step; a string other than ok/skipped is the error code of a step that failed. */
export type NightlyReport = { at: string; steps: Partial<Record<NightlyStep, "ok" | "skipped" | string>> };
