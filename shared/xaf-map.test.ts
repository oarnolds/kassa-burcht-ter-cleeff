import { describe, expect, it } from "vitest";
import { ACCOUNTS } from "./accounts";
import { booking, buildXaf, credit, debit, XAF_2026 } from "./fixtures/xaf-2026";
import { parseXaf, type XafFile } from "./xaf";
import { mapXaf } from "./xaf-map";

const base = parseXaf(XAF_2026);
const plan = (file: XafFile = base, options: { kassaSince?: string | null; choices?: Record<string, string> } = {}) =>
  mapXaf(file, [...ACCOUNTS], { kassaSince: options.kassaSince ?? null, choices: options.choices ?? {} });
const withBookings = (...extraBookings: ReturnType<typeof booking>[]) => parseXaf(buildXaf({ extraBookings }));
const entry = (file: XafFile, ref: string) => plan(file).entries.find((e) => e.ref === ref);

describe("mapXaf", () => {
  it("maps old accounts through formerly and the fixed list", () => {
    const { mapping, unplaced } = plan();
    expect(mapping.map((m) => [m.from, m.to])).toEqual([
      ["0130", "0130"],
      ["0135", "0135"],
      ["0800", "0135"],
      ["1000", "1000"],
      ["1010", "1010"],
      ["1011", "1011"],
      ["1012", "1080"],
      ["1020", "1020"],
      ["1080", "1080"],
      ["1300", "1300"],
      ["1400", "1400"],
      ["1590", "1300"],
      ["1700", "1700"],
      ["1890", "1700"],
      ["4305", "4304"],
      ["4513", "4513"],
      ["4514", "4514"],
      ["8010", "8010"],
      ["8011", "8011"],
      ["8012", "8012"],
    ]);
    expect(mapping.find((m) => m.from === "4305")).toEqual({ from: "4305", name: "Buitenmeubilair", to: "4304" });
    expect(unplaced).toEqual([]);

    // Two old accounts on one new one are added up; a line keeps its own description as a note.
    expect(entry(base, "1010:10004")?.lines).toEqual([
      { accountCode: "4304", amountCents: 12340, note: null },
      { accountCode: "1010", amountCents: -12340, note: null },
    ]);
    expect(entry(base, "1010:10002")?.lines).toEqual([
      { accountCode: "1010", amountCents: 29050, note: null },
      { accountCode: "1300", amountCents: -29050, note: null },
    ]);
    expect(entry(base, "1010:10001")).toEqual({
      ref: "1010:10001",
      date: "2026-01-20",
      description: "Energie december",
      lines: [
        { accountCode: "1010", amountCents: -15500, note: null },
        { accountCode: "1700", amountCents: 15500, note: "Afrekening water" },
      ],
    });
    expect(entry(base, "1010:10006")?.lines).toEqual([
      { accountCode: "1010", amountCents: 65000, note: null },
      { accountCode: "8010", amountCents: -50000, note: "Zaalhuur" },
      { accountCode: "8012", amountCents: -15000, note: "Entree groep" },
    ]);
    expect(entry(base, "MEMO:10013")?.lines).toEqual([
      { accountCode: "4513", amountCents: -999, note: null },
      { accountCode: "4514", amountCents: 999, note: "Naar diversen" },
    ]);
    const lines = [debit("4304", "10", "Hout"), debit("4305", "5", "Hout"), debit("4305", "2", "Schroeven"), credit("1010", "17")];
    const merged = withBookings(booking("1010", "10020", "2026-08-01", "Bouwmarkt", ...lines));
    expect(entry(merged, "1010:10020")?.lines).toEqual([
      { accountCode: "4304", amountCents: 1700, note: "Hout; Schroeven" },
      { accountCode: "1010", amountCents: -1700, note: null },
    ]);
  });

  it("builds the opening per new account, without equity, the toestellen and Mollie", () => {
    const result = plan();
    expect(result.year).toBe(2026);
    expect(result.createdOn).toBe("2026-11-25");
    // 0130 and 0135 (with 0800) come from the toestellen list, 1400 is computed, zero lines go.
    expect(result.opening).toEqual([
      { accountCode: "1000", amountCents: 8400 },
      { accountCode: "1010", amountCents: 1234560 },
      { accountCode: "1011", amountCents: 250000 },
      { accountCode: "1020", amountCents: 1088345 },
      { accountCode: "1300", amountCents: 29050 },
      { accountCode: "1700", amountCents: -15500 },
    ]);

    const withMollie = { ...base, opening: [...base.opening, { accountId: "1035", amountCents: 5000 }] };
    expect(plan(withMollie, { choices: { "1035": "1030" } }).opening.map((l) => l.accountCode)).not.toContain("1030");
  });

  it("lets a transfer within one new account fall away", () => {
    const result = plan();
    expect(result.fallenAway).toEqual([
      { ref: "MEMO:10005", date: "2026-05-20", description: "Voorziening naar afschrijving" },
      { ref: "1012:10008", date: "2026-07-02", description: "Van ING" },
    ]);
    const refs = result.entries.map((e) => e.ref);
    expect(refs).not.toContain("MEMO:10005");
    expect(refs).not.toContain("1012:10008");
  });

  it("keeps Revolut's costs and income on 1080", () => {
    expect(entry(base, "1012:10010")?.lines).toEqual([
      { accountCode: "4513", amountCents: 11420, note: null },
      { accountCode: "1080", amountCents: -11420, note: null },
    ]);
    expect(entry(base, "1012:10009")?.lines).toEqual([
      { accountCode: "1080", amountCents: 420, note: null },
      { accountCode: "8012", amountCents: -420, note: null },
    ]);
  });

  it("leaves bookings from the overstap on out and counts them", () => {
    const result = plan();
    expect(result.skippedFromOverstap).toBe(1);
    // In date order, though the file lists them per journal.
    expect(result.entries.map((e) => e.ref)).toEqual([
      "1010:10001",
      "1010:10002",
      "1010:10003",
      "1010:10004",
      "1010:10006",
      "1010:10007",
      "1012:10009",
      "1012:10010",
      "1010:10011",
      "1000:10012",
      "MEMO:10013",
    ]);

    const sameDay = withBookings(
      booking("MEMO", "10020", "2026-03-14", "Later dagboek", debit("1080", "1"), credit("8040", "1")),
      booking("1000", "10021", "2026-03-14", "Eerder dagboek", debit("1000", "1"), credit("8040", "1")),
    );
    const refs = plan(sameDay).entries.map((e) => e.ref);
    expect(refs.slice(2, 5)).toEqual(["1000:10021", "1010:10003", "MEMO:10020"]);
  });

  it("asks for a place for an account it does not know", () => {
    const file = parseXaf(
      buildXaf({
        extraAccounts: [{ id: "4999", name: "Onbekende kosten" }],
        extraBookings: [booking("1010", "10020", "2026-08-15", "Iets onbekends", debit("4999", "20"), credit("1010", "20"))],
      }),
    );
    const open = plan(file);
    expect(open.unplaced).toEqual([{ code: "4999", name: "Onbekende kosten" }]);
    expect(open.mapping).toContainEqual({ from: "4999", name: "Onbekende kosten", to: null });

    const placed = plan(file, { choices: { "4999": "4514" } });
    expect(placed.unplaced).toEqual([]);
    expect(placed.mapping).toContainEqual({ from: "4999", name: "Onbekende kosten", to: "4514" });
    expect(placed.entries.find((e) => e.ref === "1010:10020")?.lines).toEqual([
      { accountCode: "4514", amountCents: 2000, note: null },
      { accountCode: "1010", amountCents: -2000, note: null },
    ]);
    // A choice must be one of the app's accounts, and does not move an account the fixed list or formerly places.
    expect(plan(file, { choices: { "4999": "4999" } }).unplaced).toEqual([{ code: "4999", name: "Onbekende kosten" }]);
    const moved = plan(file, { choices: { "4999": "4514", "4305": "4514", "1012": "4514" } }).mapping;
    expect(moved.filter((m) => m.from === "4305" || m.from === "1012")).toEqual([
      { from: "1012", name: "Revolut", to: "1080" },
      { from: "4305", name: "Buitenmeubilair", to: "4304" },
    ]);

    // 0801 and 9998 may only carry 0: then they do not show at all.
    expect(plan().mapping.map((m) => m.from)).not.toContain("0801");
    const zero = plan(withBookings(booking("MEMO", "10021", "2026-08-16", "Nul", debit("9998", "0"), debit("1080", "1"), credit("8040", "1"))));
    expect(zero.mapping.map((m) => m.from)).not.toContain("9998");
    expect(zero.unplaced).toEqual([]);
    const nonZero = plan(withBookings(booking("MEMO", "10021", "2026-08-16", "Naar voorziening", debit("0801", "5"), credit("1010", "5"))));
    expect(nonZero.unplaced).toEqual([{ code: "0801", name: "Voorziening groot onderhoud" }]);
  });

  it("blocks a booking on a toestel account", () => {
    expect(plan().assetLines).toEqual([]);
    const file = withBookings(booking("1010", "10020", "2026-09-01", "Nieuwe wip", debit("0130", "1250"), credit("1010", "1250")));
    expect(plan(file).assetLines).toEqual([{ ref: "1010:10020", date: "2026-09-01", description: "Nieuwe wip" }]);
  });

  it("warns about kassa revenue from the kassa's first day", () => {
    expect(plan(base, { kassaSince: "2026-11-21" }).kassaLines).toEqual([{ ref: "1000:10012", date: "2026-11-22", description: "Entree zaterdag" }]);
    expect(plan(base, { kassaSince: "2026-11-23" }).kassaLines).toEqual([]);
    expect(plan(base, { kassaSince: null }).kassaLines).toEqual([]);
  });

  it("finds Mollie's payout references on ING", () => {
    // The one of 25-11 is from the overstap on, so the app reads it from ING itself.
    expect(plan().payouts).toEqual(["05665564.2611.01"]);

    const file = withBookings(
      booking("1010", "10020", "2026-03-02", "Mollie", debit("1010", "50", "Uitbetaling 05665564.2603.01"), credit("8011", "50")),
      booking("MEMO", "10021", "2026-04-01", "Correctie 05665564.2604.01", debit("1080", "5"), credit("8011", "5")),
      booking("1010", "10022", "2026-11-03", "Nog eens 05665564.2611.01", debit("1010", "1"), credit("8011", "1")),
    );
    expect(plan(file).payouts).toEqual(["05665564.2603.01", "05665564.2611.01"]);
  });

  it("gives e-Boekhouden's equity and the balances at the switch", () => {
    const result = plan();
    expect(result.ebEquityCents).toBe(15000000);
    // 1010: 12.345,60 at the start, then -155 + 290,50 + 84 - 123,40 + 650 - 110 + 412,35.
    expect(result.atSwitch).toEqual([
      { accountCode: "1000", cents: 3750 },
      { accountCode: "1010", cents: 1339405 },
      { accountCode: "1011", cents: 250000 },
      { accountCode: "1020", cents: 1088345 },
      { accountCode: "1021", cents: 0 },
      { accountCode: "1080", cents: 0 },
      { accountCode: "1300", cents: 0 },
      { accountCode: "1700", cents: 0 },
    ]);
  });
});
