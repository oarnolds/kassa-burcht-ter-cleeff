// Reads e-Boekhouden's auditfile (XML Auditfile Financieel 4.0) in the browser. Amounts are integer cents, debit
// positive, credit negative. Only parseXaf touches DOMParser, so the Worker typecheck can include this file.
// The customers and suppliers (names, e-mail addresses) are never read.

export type XafLine = { accountId: string; amountCents: number; description: string };
export type XafTransaction = { journal: string; nr: string; date: string; description: string; lines: XafLine[] };
export type XafFile = {
  /** header/fiscalYear. */
  year: number;
  /** header/dateCreated, `YYYY-MM-DD`. */
  createdOn: string;
  accounts: { id: string; name: string }[];
  /** As the file has it: zero lines kept, and it need not balance (that is the old difference). */
  opening: { accountId: string; amountCents: number }[];
  transactions: XafTransaction[];
};

/** The message is "not_auditfile", "unbalanced" or "not_2026". */
export class XafError extends Error {
  constructor(code: "not_auditfile" | "unbalanced" | "not_2026") {
    super(code);
    this.name = "XafError";
  }
}

// The Worker typecheck has no DOM library, so the few DOM members used here are described by hand.
type El = { localName: string; namespaceURI: string | null; textContent: string | null; children: ArrayLike<El> };
type XmlDoc = { documentElement: El | null; getElementsByTagName(name: string): ArrayLike<unknown> };

const NAMESPACE_END = "/XmlauditfileXAF_4.0";

function children(el: El | null, name: string): El[] {
  return el ? Array.from(el.children).filter((c) => c.localName === name) : [];
}

/** Follows a path of child names, returning the first match (or null). */
function path(el: El | null, ...names: string[]): El | null {
  let cur: El | null = el;
  for (const n of names) cur = children(cur, n)[0] ?? null;
  return cur;
}

function text(el: El | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** A value the file cannot do without. */
function required(el: El | null, pattern = /\S/): string {
  const value = text(el);
  if (!pattern.test(value)) throw new XafError("not_auditfile");
  return value;
}

const DATE = /^\d{4}-\d{2}-\d{2}/;
const date = (el: El | null) => required(el, DATE).slice(0, 10);

/**
 * `amnt` with `amntTp`: "185938.91" D is 18593891, C is -18593891. e-Boekhouden sometimes writes a negative amount
 * ("-9.99" D is -999, "-9.99" C is 999). No floating point, and "-0" is 0, not -0.
 */
function signedCents(line: El): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text(path(line, "amnt")));
  const type = text(path(line, "amntTp"));
  if (!m || (type !== "D" && type !== "C")) throw new XafError("not_auditfile");
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  const written = m[1] === "-" ? 0 - cents : cents;
  return type === "D" ? written : 0 - written;
}

function transactionOf(journal: string, el: El): XafTransaction {
  const lines = children(el, "trLine").map((line) => ({
    accountId: required(path(line, "accID")),
    amountCents: signedCents(line),
    description: text(path(line, "desc")),
  }));
  if (lines.reduce((sum, line) => sum + line.amountCents, 0) !== 0) throw new XafError("unbalanced");
  return { journal, nr: required(path(el, "nr")), date: date(path(el, "trDt")), description: text(path(el, "desc")), lines };
}

export function parseXaf(xml: string): XafFile {
  const Parser = (globalThis as unknown as { DOMParser: new () => { parseFromString(s: string, type: string): XmlDoc } }).DOMParser;
  const doc = new Parser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new XafError("not_auditfile");
  const root = doc.documentElement;
  if (!root || root.localName !== "auditfile" || !(root.namespaceURI ?? "").endsWith(NAMESPACE_END)) throw new XafError("not_auditfile");

  const header = path(root, "header");
  const year = Number(required(path(header, "fiscalYear"), /^\d{4}$/));
  if (year !== 2026) throw new XafError("not_2026");
  const company = path(root, "company");
  if (!company) throw new XafError("not_auditfile");

  return {
    year,
    createdOn: date(path(header, "dateCreated")),
    accounts: children(path(company, "generalLedger"), "ledgerAccount").map((a) => ({
      id: required(path(a, "accID")),
      name: text(path(a, "accDesc")),
    })),
    opening: children(path(company, "openingBalance"), "obLine").map((line) => ({
      accountId: required(path(line, "accID")),
      amountCents: signedCents(line),
    })),
    transactions: children(path(company, "transactions"), "journal").flatMap((journal) => {
      const id = required(path(journal, "jrnID"));
      return children(journal, "transaction").map((t) => transactionOf(id, t));
    }),
  };
}
