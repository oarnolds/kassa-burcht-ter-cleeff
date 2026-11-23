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
  before: { date: string; description: string; lines: EntryLine[] } | null;
  after: { date: string; description: string; lines: EntryLine[] };
};

/** The first day the app keeps the books. Everything before it stays in e-Boekhouden. */
export const LEDGER_START = "2027-01-01";
