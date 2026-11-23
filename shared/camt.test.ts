import { describe, expect, it } from "vitest";
import { CamtError, parseCamt053 } from "./camt";
import betaalXml from "./fixtures/camt-ing-betaal.xml?raw";
import spaarXml from "./fixtures/camt-ing-spaar.xml?raw";

const fixture = (name: string) => (name === "camt-ing-spaar.xml" ? spaarXml : betaalXml);

const wrap = (inner: string, ns = "urn:iso:std:iso:20022:tech:xsd:camt.053.001.02") =>
  `<Document xmlns="${ns}"><BkToCstmrStmt>${inner}</BkToCstmrStmt></Document>`;
const stmt = (body: string) => `<Stmt><Acct><Id><IBAN>NL00INGB0000000000</IBAN></Id></Acct>${body}</Stmt>`;
const entry = (amt: string, extra = "", ind = "CRDT", date: string | null = "2027-02-03") =>
  `<Ntry>${amt === "" ? "" : `<Amt Ccy="EUR">${amt}</Amt>`}${ind ? `<CdtDbtInd>${ind}</CdtDbtInd>` : ""}${date ? `<BookgDt><Dt>${date}</Dt></BookgDt>` : ""}${extra}</Ntry>`;

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(CamtError);
    return (e as CamtError).message;
  }
  return "no error";
}

describe("parseCamt053", () => {
  it("reads the savings file as the bank wrote it", () => {
    expect(parseCamt053(fixture("camt-ing-spaar.xml"))).toEqual([
      {
        account: "V00000000",
        opening: { date: "2026-01-01", cents: 1088345 },
        closing: { date: "2026-11-22", cents: 1102747 },
        lines: [
          { bookingDate: "2026-01-01", amountCents: 14402, description: "Rente", counterpartyName: null, counterpartyIban: null, bankRef: null },
        ],
      },
    ]);
  });

  it("takes the other party from the right side", () => {
    const [s] = parseCamt053(fixture("camt-ing-betaal.xml"));
    expect(s.account).toBe("NL00INGB0000000000");
    expect(s.opening).toEqual({ date: "2026-03-01", cents: 100000 });
    expect(s.closing).toEqual({ date: "2026-03-31", cents: 201050 });
    expect(s.lines[0]).toEqual({
      bookingDate: "2026-03-05",
      amountCents: 100000,
      description: "Subsidie speeltuin 2026",
      counterpartyName: "Gemeente Haarlem",
      counterpartyIban: "NL00BANK0123456789",
      bankRef: "REF-0001",
    });
    expect(s.lines[1]).toEqual({
      bookingDate: "2026-03-10",
      amountCents: -6950,
      description: "Factuur 2026-014",
      counterpartyName: "Goodoo BV",
      counterpartyIban: "NL00BANK0987654321",
      bankRef: null, // only NtryRef: a bank may number that per file, so it is no reference
    });
  });

  it("keeps two equal lines on one day as two", () => {
    const [s] = parseCamt053(fixture("camt-ing-betaal.xml"));
    const kas = s.lines.filter((l) => l.description === "kasstorting");
    expect(kas).toHaveLength(2);
    expect(kas.every((l) => l.amountCents === 4000 && l.bookingDate === "2026-03-20")).toBe(true);
  });

  it("refuses XML that is not a bank statement", () => {
    expect(codeOf(() => parseCamt053("<a/>"))).toBe("not_camt053");
    expect(codeOf(() => parseCamt053(wrap("", "urn:iso:std:iso:20022:tech:xsd:camt.052.001.02")))).toBe("not_camt053");
    expect(codeOf(() => parseCamt053(wrap("")))).toBe("not_camt053");
  });

  it("refuses broken XML and entries missing amount, indicator or date", () => {
    expect(codeOf(() => parseCamt053("<Document><oops"))).toBe("unreadable");
    expect(codeOf(() => parseCamt053(wrap(stmt(entry("")))))).toBe("unreadable");
    expect(codeOf(() => parseCamt053(wrap(stmt(entry("1.00", "", "")))))).toBe("unreadable");
    expect(codeOf(() => parseCamt053(wrap(stmt(entry("1.00", "", "CRDT", null)))))).toBe("unreadable");
  });

  it("accepts a later camt.053 version", () => {
    const xml = wrap(stmt(entry("1.00")), "urn:iso:std:iso:20022:tech:xsd:camt.053.001.08");
    expect(parseCamt053(xml)[0].lines).toHaveLength(1);
  });

  it("parses amounts without floating point and refuses odd ones", () => {
    const cents = (a: string) => parseCamt053(wrap(stmt(entry(a))))[0].lines[0].amountCents;
    expect(cents("144.02")).toBe(14402);
    expect(cents("144.2")).toBe(14420);
    expect(cents("144")).toBe(14400);
    expect(cents("0.29")).toBe(29);
    for (const bad of ["1.234", "1,00", "abc", "-1.00", "1.", ".5", "1e3"]) {
      expect(codeOf(() => parseCamt053(wrap(stmt(entry(bad)))))).toBe("unreadable");
    }
  });

  it("returns several statements in document order", () => {
    const a = `<Stmt><Acct><Id><IBAN>NL00AAAA0000000001</IBAN></Id></Acct></Stmt>`;
    const b = `<Stmt><Acct><Id><Othr><Id>X2</Id></Othr></Id></Acct></Stmt>`;
    const res = parseCamt053(wrap(a + b));
    expect(res.map((s) => s.account)).toEqual(["NL00AAAA0000000001", "X2"]);
    expect(res[0].opening).toBeNull();
    expect(res[0].closing).toBeNull();
  });

  it("cuts a balance date-time to the date, falls back to PRCD and ignores other balances", () => {
    const bal = (cd: string, amt: string, dt: string) =>
      `<Bal><Tp><CdOrPrtry><Cd>${cd}</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">${amt}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt>${dt}</Dt></Bal>`;
    const [s] = parseCamt053(
      wrap(stmt(bal("PRCD", "5.00", "<Dt>2026-12-31</Dt>") + bal("CLBD", "7.00", "<DtTm>2027-01-31T23:59:59+01:00</DtTm>") + bal("ITBD", "9.00", "<Dt>2027-01-15</Dt>"))),
    );
    expect(s.opening).toEqual({ date: "2026-12-31", cents: 500 });
    expect(s.closing).toEqual({ date: "2027-01-31", cents: 700 });
  });

  it("makes a debit balance negative", () => {
    const [s] = parseCamt053(
      wrap(stmt(`<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">5.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Dt><Dt>2027-01-31</Dt></Dt></Bal>`)),
    );
    expect(s.closing).toEqual({ date: "2027-01-31", cents: -500 });
  });

  it("takes the reference from the entry, else its details, never from NtryRef", () => {
    const ref = (extra: string) => parseCamt053(wrap(stmt(entry("1.00", extra))))[0].lines[0].bankRef;
    expect(ref("<AcctSvcrRef>E1</AcctSvcrRef><NtryDtls><TxDtls><Refs><AcctSvcrRef>T1</AcctSvcrRef></Refs></TxDtls></NtryDtls>")).toBe("E1");
    expect(ref("<NtryDtls><TxDtls><Refs><AcctSvcrRef>T1</AcctSvcrRef></Refs></TxDtls></NtryDtls><NtryRef>N1</NtryRef>")).toBe("T1");
    // A bank may number NtryRef per file: two different lines in two files would share it.
    expect(ref("<NtryRef>N1</NtryRef>")).toBeNull();
    expect(ref("")).toBeNull();
  });

  it("cleans up descriptions", () => {
    const d = (extra: string) => parseCamt053(wrap(stmt(entry("1.00", extra))))[0].lines[0].description;
    expect(d("<NtryDtls><TxDtls><RmtInf><Ustrd>  a \n  b </Ustrd><Ustrd>c</Ustrd></RmtInf></TxDtls></NtryDtls><AddtlNtryInf>x</AddtlNtryInf>")).toBe("a b c");
    expect(d("<AddtlNtryInf> Rente\n  2026 </AddtlNtryInf>")).toBe("Rente 2026");
    expect(d("")).toBe("");
  });
});
