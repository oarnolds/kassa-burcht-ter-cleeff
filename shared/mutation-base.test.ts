import { describe, expect, it } from "vitest";
import { ACCOUNTS } from "./accounts";
import type { EbMutation, EbMutations } from "./eboekhouden-mutations";
import { mutationBase, type MutationChoices } from "./mutation-base";

const chart = [...ACCOUNTS];
const none: MutationChoices = { combined: {}, unplaced: {} };

let nr = 0;
const m = (date: string, kind: string, amount: number, contra: string, account = "1010"): EbMutation => ({
  nr: ++nr,
  date,
  kind,
  amountCents: Math.round(amount * 100),
  account,
  contra: contra.split(","),
  invoice: "",
  document: "",
});
const year = (rows: EbMutation[]): EbMutations => ({ year: 2026, from: "2026-01-02", to: "2026-11-20", rows });

/** Twelve months with `cents` in the given months (1 to 12). */
const at = (...pairs: [month: number, cents: number][]): number[] => {
  const months = Array<number>(12).fill(0);
  for (const [month, cents] of pairs) months[month - 1] += cents;
  return months;
};

describe("mutationBase", () => {
  it("takes the direction from the Soort: income credit positive, costs debit positive, per month", () => {
    const base = mutationBase(
      year([
        m("2026-01-10", "Geld ontv", 100, "8000"),
        m("2026-02-03", "Geld uit", 20, "8000"),
        m("2026-01-20", "Geld uit", 31, "4308"),
        m("2026-09-12", "Geld ontv", 12.4, "4309"),
        m("2026-07-15", "Fact verst", 250, "8004", "1300"),
        m("2026-03-03", "Fact ontv", 80, "4501", "1700"),
        m("2026-04-04", "Factbet verst", 5, "4511"),
        m("2026-05-05", "Factbet ontv", 3, "8030"),
        m("2026-01-25", "Geld uit", 33.5, "4308"),
      ]),
      chart,
      none,
    );
    expect(base.months).toEqual([
      { accountCode: "4308", cents: at([1, 3100], [1, 3350]) },
      { accountCode: "4309", cents: at([9, -1240]) },
      { accountCode: "4501", cents: at([3, 8000]) },
      { accountCode: "4511", cents: at([4, 500]) },
      { accountCode: "8000", cents: at([1, 10000], [2, -2000]) },
      { accountCode: "8004", cents: at([7, 25000]) },
      { accountCode: "8030", cents: at([5, 300]) },
    ]);
    expect(base.skipped).toEqual([]);
    expect(base).toMatchObject({ year: 2026, from: "2026-01-02", to: "2026-11-20", count: 9 });
  });

  it("ignores transfers and balance bookings without a word, and skips a Memoriaal or an unknown Soort with a result code", () => {
    const memoriaal = m("2026-03-31", "Memoriaal", 400, "4601", "0135");
    const backwards = m("2026-04-30", "Memoriaal", 10, "1700", "4514");
    const unknown = m("2026-05-31", "Beginbalans", 99, "8040");
    const base = mutationBase(
      year([
        m("2026-02-14", "Geld uit", 500, "1020"),
        m("2026-07-20", "Factbet ontv", 250, "1300"),
        m("2026-08-20", "Factbet verst", 80, "1700"),
        m("2026-09-30", "Memoriaal", 75, "1000", "1080"),
        m("2026-10-01", "Memoriaal", 12, "0135", "0800"),
        memoriaal,
        backwards,
        unknown,
        m("2026-06-01", "Geld uit", 10, "4514"),
      ]),
      chart,
      none,
    );
    expect(base.months).toEqual([{ accountCode: "4514", cents: at([6, 1000]) }]);
    expect(base.skipped).toEqual([
      { nr: memoriaal.nr, date: "2026-03-31", kind: "Memoriaal", amountCents: 40000, account: "0135", contra: ["4601"] },
      { nr: backwards.nr, date: "2026-04-30", kind: "Memoriaal", amountCents: 1000, account: "4514", contra: ["1700"] },
      { nr: unknown.nr, date: "2026-05-31", kind: "Beginbalans", amountCents: 9900, account: "1010", contra: ["8040"] },
    ]);
    expect(base.count).toBe(9);
  });

  it("puts the old codes on the account that took them over, and a list of codes of one account on that account", () => {
    const base = mutationBase(
      year([
        m("2026-08-01", "Geld uit", 45, "4306,4307"),
        m("2026-08-02", "Geld uit", 5, "4307"),
        m("2026-03-01", "Geld uit", 60, "4305"),
        m("2026-04-01", "Geld uit", 75.15, "4810"),
        m("2026-05-01", "Geld uit", 9, "4790"),
        m("2026-06-01", "Geld ontv", 20, "8002"),
      ]),
      chart,
      none,
    );
    expect(base.months).toEqual([
      { accountCode: "4304", cents: at([3, 6000]) },
      { accountCode: "4306", cents: at([8, 4500], [8, 500]) },
      { accountCode: "4502", cents: at([4, 7515]) },
      { accountCode: "4514", cents: at([5, 900]) },
      { accountCode: "8000", cents: at([6, 2000]) },
    ]);
    expect(base.combined).toEqual([]);
  });

  it("keeps a mutation of several accounts together, on the account its direction suggests until another is chosen", () => {
    const rows = [
      m("2026-05-05", "Geld ontv", 500, "8010,8012"),
      m("2026-06-06", "Geld ontv", 692.82, "8012,8010"),
      m("2026-07-07", "Geld ontv", 1500, "8010,8012"),
      m("2026-08-08", "Geld ontv", 1000, "8010,8012"),
      m("2026-03-31", "Geld uit", 3.75, "4511,8030", "1020"),
      m("2026-06-30", "Geld uit", 3.75, "8030,4511", "1020"),
      m("2026-12-31", "Geld ontv", 2, "4511,8030", "1020"),
      m("2026-02-02", "Geld ontv", 7, "8030,4511", "1021"),
    ];
    const plain = mutationBase(year(rows), chart, none);
    expect(plain.combined).toEqual([
      { key: "4511+8030", accounts: ["4511", "8030"], count: 4, amountCents: 150, chosen: "8030" },
      { key: "8010+8012", accounts: ["8010", "8012"], count: 4, amountCents: 369282, chosen: "8010" },
    ]);
    expect(plain.months).toEqual([
      { accountCode: "8010", cents: at([5, 50000], [6, 69282], [7, 150000], [8, 100000]) },
      { accountCode: "8030", cents: at([3, -375], [6, -375], [12, 200], [2, 700]) },
    ]);

    // The bank's costs larger than the interest: a debit, so on the costs.
    const debit = mutationBase(year(rows.slice(4, 6)), chart, none);
    expect(debit.combined).toEqual([{ key: "4511+8030", accounts: ["4511", "8030"], count: 2, amountCents: 750, chosen: "4511" }]);
    expect(debit.months).toEqual([{ accountCode: "4511", cents: at([3, 375], [6, 375]) }]);

    const chosen = mutationBase(year(rows), chart, { combined: { "8010+8012": "8012", "4511+8030": "4511" }, unplaced: {} });
    expect(chosen.combined.map((group) => [group.key, group.chosen, group.amountCents])).toEqual([
      ["4511+8030", "4511", -150],
      ["8010+8012", "8012", 369282],
    ]);
    expect(chosen.months.map((line) => line.accountCode)).toEqual(["4511", "8012"]);
    expect(chosen.months[0]!.cents).toEqual(at([3, 375], [6, 375], [12, -200], [2, -700]));

    // A choice that is not one of the group's accounts is not taken.
    expect(mutationBase(year(rows), chart, { combined: { "8010+8012": "4308" }, unplaced: {} }).combined[1]!.chosen).toBe("8010");
  });

  it("groups three accounts under their codes in order, and leaves an unknown code out of a list with known ones", () => {
    const base = mutationBase(year([m("2026-01-05", "Geld uit", 30, "8030,4511,4308"), m("2026-01-06", "Geld uit", 12, "4511,4999")]), chart, none);
    expect(base.combined).toEqual([{ key: "4308+4511+8030", accounts: ["4308", "4511", "8030"], count: 1, amountCents: 3000, chosen: "4308" }]);
    expect(base.months).toEqual([
      { accountCode: "4308", cents: at([1, 3000]) },
      { accountCode: "4511", cents: at([1, 1200]) },
    ]);
    expect(base.unplaced).toEqual([]);
  });

  it("lists a code no account has, and counts it only on an income or expense account chosen for it", () => {
    const rows = [m("2026-04-10", "Geld uit", 30, "4999"), m("2026-05-10", "Geld uit", 20, "4999"), m("2026-03-01", "Geld ontv", 8, "8810"), m("2026-03-02", "Geld ontv", 1, "9100")];
    const plain = mutationBase(year(rows), chart, none);
    expect(plain.unplaced).toEqual([
      { code: "4999", count: 2, amountCents: 5000, kind: "expense", chosen: null },
      { code: "8810", count: 1, amountCents: 800, kind: "income", chosen: null },
      { code: "9100", count: 1, amountCents: 100, kind: null, chosen: null },
    ]);
    expect(plain.months).toEqual([]);

    const chosen = mutationBase(year(rows), chart, { combined: {}, unplaced: { "4999": "4514", "8810": "8040", "9100": "1010" } });
    expect(chosen.unplaced.map((row) => row.chosen)).toEqual(["4514", "8040", null]);
    expect(chosen.months).toEqual([
      { accountCode: "4514", cents: at([4, 3000], [5, 2000]) },
      { accountCode: "8040", cents: at([3, 800]) },
    ]);
    // On an account of the other kind it counts the other way round.
    const flipped = mutationBase(year(rows), chart, { combined: {}, unplaced: { "4999": "8040", "8810": null } });
    expect(flipped.months).toEqual([{ accountCode: "8040", cents: at([4, -3000], [5, -2000]) }]);
  });
});
