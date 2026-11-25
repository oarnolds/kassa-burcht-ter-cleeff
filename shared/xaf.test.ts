import { describe, expect, it } from "vitest";
import camtXml from "./fixtures/camt-ing-betaal.xml?raw";
import { booking, buildXaf, credit, debit, XAF_2026 } from "./fixtures/xaf-2026";
import { parseXaf, XafError } from "./xaf";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(XafError);
    return (e as XafError).message;
  }
  return "no error";
}

describe("parseXaf", () => {
  it("reads the opening and every booking with signed cents", () => {
    const file = parseXaf(XAF_2026);
    expect(file.year).toBe(2026);
    expect(file.createdOn).toBe("2026-11-25");
    expect(file.accounts).toContainEqual({ id: "4305", name: "Buitenmeubilair" });
    expect(file.accounts).toHaveLength(25);

    expect(file.opening).toHaveLength(15);
    expect(file.opening.slice(0, 5)).toEqual([
      { accountId: "0130", amountCents: 18593891 },
      { accountId: "0135", amountCents: -7162368 },
      { accountId: "0800", amountCents: -150000 },
      { accountId: "0801", amountCents: 0 },
      { accountId: "1000", amountCents: 8400 },
    ]);
    expect(file.opening).toContainEqual({ accountId: "1010", amountCents: 1234560 });
    expect(Object.is(file.opening.find((l) => l.accountId === "9998")?.amountCents, 0)).toBe(true); // "0" C is 0, not -0
    // The opening does not balance: that is the old difference, and allowed.
    expect(file.opening.reduce((sum, line) => sum + line.amountCents, 0)).toBe(-1123622);

    expect(file.transactions).toHaveLength(14);
    expect(file.transactions.find((t) => t.nr === "10006")).toEqual({
      journal: "1010",
      nr: "10006",
      date: "2026-06-06",
      description: "Schoolreis De Klimop",
      lines: [
        { accountId: "1010", amountCents: 65000, description: "Schoolreis De Klimop" },
        { accountId: "8010", amountCents: -50000, description: "Zaalhuur" },
        { accountId: "8012", amountCents: -15000, description: "Entree groep" },
      ],
    });
    expect(file.transactions.find((t) => t.nr === "10004")?.lines.map((l) => l.amountCents)).toEqual([12340, -12340]);
    // A correction with negative amounts: "-9.99" D is a credit, "-9.99" C a debit.
    expect(file.transactions.find((t) => t.nr === "10013")?.lines).toEqual([
      { accountId: "4513", amountCents: -999, description: "Correctie website" },
      { accountId: "4514", amountCents: 999, description: "Naar diversen" },
    ]);
  });

  it("reads amounts without rounding errors", () => {
    const xml = buildXaf({ bookings: [booking("1010", "10001", "2026-02-01", "Rente", debit("1020", "0.29"), debit("1020", "1.15"), credit("8030", "1.44"))] });
    expect(parseXaf(xml).transactions[0]!.lines.map((l) => l.amountCents)).toEqual([29, 115, -144]);
  });

  it("reads a negative amount", () => {
    const amounts = (...lines: ReturnType<typeof debit>[]) =>
      parseXaf(buildXaf({ bookings: [booking("MEMO", "10001", "2026-02-01", "Correctie", ...lines)] })).transactions[0]!.lines.map((l) => l.amountCents);
    expect(amounts(debit("4513", "-12.5"), credit("4514", "-12.5"))).toEqual([-1250, 1250]);
    const zero = amounts(debit("4513", "-0"), credit("4514", "-0.00"), debit("4514", "-0.0"));
    expect(zero.every((cents) => Object.is(cents, 0))).toBe(true);
  });

  it("leaves the customers and suppliers out", () => {
    const text = JSON.stringify(parseXaf(XAF_2026));
    expect(text).not.toContain("example.org");
    expect(text).not.toContain("Krakeling");
    expect(text).not.toContain("Voorbeeld");
    expect(text).not.toContain("D0001");
  });

  it("refuses a file that is not an auditfile", () => {
    expect(codeOf(() => parseXaf(camtXml))).toBe("not_auditfile");
    expect(codeOf(() => parseXaf("<auditfile><oops"))).toBe("not_auditfile");
    expect(codeOf(() => parseXaf(XAF_2026.replace("XmlauditfileXAF_4.0", "XmlauditfileXAF_3.2")))).toBe("not_auditfile");
    for (const amount of ["12,50", "--5", "+5", "1.234", "1.2.3", "", "-", "5-"]) {
      const xml = buildXaf({ extraBookings: [booking("1010", "10020", "2026-08-01", "Vreemd bedrag", debit("1010", amount), credit("8000", amount))] });
      expect(codeOf(() => parseXaf(xml)), amount).toBe("not_auditfile");
    }
  });

  it("refuses a booking that does not balance", () => {
    const xml = buildXaf({ extraBookings: [booking("1010", "10020", "2026-08-01", "Scheef", debit("1010", "10"), credit("8000", "9.99"))] });
    expect(codeOf(() => parseXaf(xml))).toBe("unbalanced");
  });

  it("refuses another year", () => {
    expect(codeOf(() => parseXaf(buildXaf({ fiscalYear: 2025 })))).toBe("not_2026");
  });
});
