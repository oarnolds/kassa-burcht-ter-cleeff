// Reads a CAMT.053 bank statement (ISO 20022) in the browser. Amounts are integer cents.
// Only parseCamt053 touches DOMParser, so the Worker typecheck can include this file.

export type CamtLine = {
  bookingDate: string;
  amountCents: number;
  description: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  bankRef: string | null;
};
export type CamtStatement = {
  account: string;
  opening: { date: string; cents: number } | null;
  closing: { date: string; cents: number } | null;
  lines: CamtLine[];
};

/** The message is "not_camt053" or "unreadable". */
export class CamtError extends Error {
  constructor(code: "not_camt053" | "unreadable") {
    super(code);
    this.name = "CamtError";
  }
}

// The Worker typecheck has no DOM library, so the few DOM members used here are described by hand.
type El = {
  localName: string;
  namespaceURI: string | null;
  textContent: string | null;
  children: ArrayLike<El>;
  getElementsByTagNameNS(ns: string, name: string): ArrayLike<El>;
};
type XmlDoc = { documentElement: El | null; getElementsByTagName(name: string): ArrayLike<unknown> };

const NS_PREFIX = "urn:iso:std:iso:20022:tech:xsd:camt.053.001.";

function children(el: El, name: string): El[] {
  return Array.from(el.children as ArrayLike<El>).filter((c) => c.localName === name);
}

/** Follows a path of child names, returning the first match (or null). */
function path(el: El | null, ...names: string[]): El | null {
  let cur: El | null = el;
  for (const n of names) {
    if (!cur) return null;
    cur = children(cur, n)[0] ?? null;
  }
  return cur;
}

function text(el: El | null): string | null {
  const t = el?.textContent?.trim();
  return t ? t : null;
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function toCents(raw: string | null): number {
  const m = raw === null ? null : /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) throw new CamtError("unreadable");
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

function dateOf(el: El | null): string | null {
  const d = text(path(el, "Dt")) ?? text(path(el, "DtTm"));
  const m = d === null ? null : /^\d{4}-\d{2}-\d{2}/.exec(d);
  return m ? m[0] : null;
}

function balance(stmt: El, codes: string[]): { date: string; cents: number } | null {
  for (const code of codes) {
    for (const bal of children(stmt, "Bal")) {
      if (text(path(bal, "Tp", "CdOrPrtry", "Cd")) !== code) continue;
      const date = dateOf(path(bal, "Dt"));
      if (!date) throw new CamtError("unreadable");
      const cents = toCents(text(path(bal, "Amt")));
      return { date, cents: text(path(bal, "CdtDbtInd")) === "DBIT" ? -cents : cents };
    }
  }
  return null;
}

function entryLine(ntry: El): CamtLine {
  const amount = text(path(ntry, "Amt"));
  const ind = text(path(ntry, "CdtDbtInd"));
  const bookingDate = dateOf(path(ntry, "BookgDt"));
  if (amount === null || (ind !== "CRDT" && ind !== "DBIT") || !bookingDate) throw new CamtError("unreadable");
  const cents = toCents(amount);

  const details = children(path(ntry, "NtryDtls") ?? ntry, "TxDtls");
  const ustrd = details.flatMap((tx) => children(path(tx, "RmtInf") ?? tx, "Ustrd")).map((u) => clean(u.textContent ?? ""));
  const joined = ustrd.filter(Boolean).join(" ");
  const description = joined || clean(text(path(ntry, "AddtlNtryInf")) ?? "");

  const tx = details[0] ?? null;
  const credit = ind === "CRDT";
  const party = path(tx, "RltdPties", credit ? "Dbtr" : "Cdtr");
  const partyAcct = path(tx, "RltdPties", credit ? "DbtrAcct" : "CdtrAcct", "Id", "IBAN");

  // Only the bank's own reference. NtryRef is left out: a bank may number it per file, so two different lines
  // in two files could share it. A line without a reference is recognised by its content instead.
  const bankRef =
    text(path(ntry, "AcctSvcrRef")) ?? details.map((d) => text(path(d, "Refs", "AcctSvcrRef"))).find((r) => r !== null) ?? null;

  return {
    bookingDate,
    amountCents: credit ? cents : -cents,
    description,
    counterpartyName: text(path(party, "Nm")),
    counterpartyIban: text(partyAcct),
    bankRef,
  };
}

export function parseCamt053(xml: string): CamtStatement[] {
  const Parser = (globalThis as unknown as { DOMParser: new () => { parseFromString(s: string, type: string): XmlDoc } }).DOMParser;
  const doc = new Parser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new CamtError("unreadable");
  const root = doc.documentElement;
  if (!root || !(root.namespaceURI ?? "").startsWith(NS_PREFIX)) throw new CamtError("not_camt053");
  const statements = Array.from(root.getElementsByTagNameNS("*", "Stmt"));
  if (statements.length === 0) throw new CamtError("not_camt053");

  return statements.map((stmt) => {
    const acct = path(stmt, "Acct", "Id");
    const account = text(path(acct, "IBAN")) ?? text(path(acct, "Othr", "Id"));
    if (!account) throw new CamtError("unreadable");
    return {
      account,
      opening: balance(stmt, ["OPBD", "PRCD"]),
      closing: balance(stmt, ["CLBD"]),
      lines: children(stmt, "Ntry").map(entryLine),
    };
  });
}
