import { useState } from "react";
import {
  type Budget,
  type BudgetActuals,
  type BudgetLine,
  type BudgetRule,
  type BudgetSource,
  budgetYears,
  formatWholeEuros,
  proposeRule,
  spread,
  wholeMonths,
} from "../../../shared/budget";
import type { EbMutations } from "../../../shared/eboekhouden-mutations";
import type { DepreciationPlan, LedgerAccount } from "../../../shared/ledger-types";
import { formatEuro, formatEuroShort } from "../../../shared/money";
import { type MutationBase, type MutationChoices, mutationBase } from "../../../shared/mutation-base";
import { formatDateNl } from "../../../shared/time";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { Loaded, PageTitle, Problem, Section, amount, amountHead, cell, count, field, head, pillLink, table, tableScroll, today } from "../parts";
import { useAdminData } from "../useAdmin";
import { BudgetEditor } from "./BudgetEditor";
import { MONTH_NAMES, MONTH_SHORT, budgetGrid, missingMonthsText, monthHead, ruleText, sourceText, sumOf, type GridRow } from "./budget-grid";
import { saveFile } from "./download";
import { FIRST_LEDGER_YEAR, explainWrite, ledgerPath, useLedgerWrites } from "./ledger-api";
import { useBusy } from "./useBusy";

const DEPRECIATION = "4601";
const isResult = (account: LedgerAccount) => account.kind === "income" || account.kind === "expense";
const monthOf = (date: string) => Number(date.slice(5, 7));
const zeros = (): number[] => Array<number>(12).fill(0);

/** The penningmeester's names for what can go wrong with a file. */
const NOT_MUTATIONS = "Dit is geen mutatieoverzicht uit e-Boekhouden.";
const NOT_ONE_YEAR = "Lees de mutaties van één jaar in.";

/** Where a proposal comes from: e-Boekhouden's mutations of a year, or the books of the year before. */
type Origin = { kind: "mutations"; mutations: EbMutations } | { kind: "ledger"; actuals: BudgetActuals & { lastDate: string } };

/** A line of the proposal; `fromAssets`: the depreciation the list of toestellen gives. */
type Proposed = { accountCode: string; rule: BudgetRule; base: number[] | null; fromAssets: boolean };

/**
 * A rule per account for the months of the source, in the order of the chart; and 4601 once in December with the
 * depreciation the toestellen give for the year, when there is any.
 */
function proposalOf(months: { accountCode: string; cents: number[] }[], covered: number, plan: DepreciationPlan | null, chart: LedgerAccount[]): Proposed[] {
  const lines = new Map<string, Proposed>();
  for (const { accountCode, cents } of months) {
    const rule = proposeRule(cents, covered);
    if (rule) lines.set(accountCode, { accountCode, rule, base: wholeMonths(cents), fromAssets: false });
  }
  const depreciation = plan ? wholeMonths([plan.totalCents])[0]! : 0;
  if (depreciation > 0 && chart.some((account) => account.code === DEPRECIATION)) {
    const rule: BudgetRule = { kind: "yearly", amountCents: depreciation, month: 12 };
    lines.set(DEPRECIATION, { accountCode: DEPRECIATION, rule, base: lines.get(DEPRECIATION)?.base ?? null, fromAssets: true });
  }
  return chart.flatMap((account) => {
    const line = lines.get(account.code);
    return line && isResult(account) ? [line] : [];
  });
}

/** "A", "A en B", "A, B en C". */
const joined = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} en ${names.at(-1)}`);

/** An account select of the visible income and expense accounts, costs first. */
function AccountOptions({ chart }: { chart: LedgerAccount[] }) {
  return (
    <>
      {(
        [
          ["Kosten", "expense"],
          ["Opbrengsten", "income"],
        ] as const
      ).map(([title, kind]) => (
        <optgroup key={kind} label={title}>
          {chart
            .filter((account) => account.kind === kind && !account.hidden)
            .map((account) => (
              <option key={account.code} value={account.code}>{`${account.code} ${account.name}`}</option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

/** A group's title inside a table (a plain cell, so the table's column headers stay its own). */
function GroupTitle({ name, span }: { name: string; span: number }) {
  return (
    <tr>
      <td colSpan={span} className="px-1.5 pt-4 pb-1 text-left text-sm font-bold text-ink/70 sm:px-3">
        {name}
      </td>
    </tr>
  );
}

/** What the mutations of several accounts at once go on; what has no account; what is not counted. */
function MutationDetails({ base, chart, choices, onChoose }: { base: MutationBase; chart: LedgerAccount[]; choices: MutationChoices; onChoose(choices: MutationChoices): void }) {
  const byCode = new Map(chart.map((account) => [account.code, account]));
  const nameOf = (code: string) => `${code} ${byCode.get(code)?.name ?? ""}`.trim();
  return (
    <>
      {base.combined.length > 0 && (
        <Section title="Mutaties met meer rekeningen" note="Van deze mutaties geeft e-Boekhouden alleen het totaal. Kies bij welke rekening ze in het voorstel komen.">
          <ul className="px-2 sm:px-3">
            {base.combined.map((group) => {
              const name = joined(group.accounts.map(nameOf));
              return (
                <li key={group.key} aria-label={name} className="flex flex-wrap items-center justify-between gap-2 border-t border-sand py-2 first:border-t-0">
                  <span className="text-lg">{`${name}: ${count(group.count, "mutatie", "mutaties")}, ${formatEuro(group.amountCents)}`}</span>
                  <label className="flex items-center gap-2 font-semibold">
                    Bij rekening
                    <select
                      className={field}
                      value={group.chosen}
                      onChange={(event) => onChoose({ ...choices, combined: { ...choices.combined, [group.key]: event.target.value } })}
                    >
                      {group.accounts.map((code) => (
                        <option key={code} value={code}>
                          {nameOf(code)}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {base.unplaced.length > 0 && (
        <Section title="Niet geplaatst" note="Deze nummers horen bij geen rekening van de app. Kies een rekening, of neem ze niet mee.">
          <ul className="px-2 sm:px-3">
            {base.unplaced.map((row) => {
              const what = row.kind === "expense" ? "uitgaven " : row.kind === "income" ? "ontvangsten " : "";
              return (
                <li key={row.code} aria-label={row.code} className="flex flex-wrap items-center justify-between gap-2 border-t border-sand py-2 first:border-t-0">
                  <span className="text-lg">{`${row.code}: ${count(row.count, "mutatie", "mutaties")}, ${what}${formatEuro(row.amountCents)}`}</span>
                  <select
                    aria-label={`Rekening voor ${row.code}`}
                    className={field}
                    value={row.chosen ?? ""}
                    onChange={(event) => onChoose({ ...choices, unplaced: { ...choices.unplaced, [row.code]: event.target.value || null } })}
                  >
                    <option value="">Niet meenemen</option>
                    <AccountOptions chart={chart} />
                  </select>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {base.skipped.length > 0 && (
        <Section title="Niet meegenomen" note="Memorialen en mutaties van een soort die de app niet kent, tellen niet mee in het voorstel.">
          <div className={tableScroll}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={head}>Nr</th>
                  <th className={head}>Datum</th>
                  <th className={head}>Soort</th>
                  <th className={amountHead}>Bedrag</th>
                  <th className={head}>Rekening</th>
                  <th className={head}>Tegenrekening</th>
                </tr>
              </thead>
              <tbody>
                {base.skipped.map((row) => (
                  <tr key={`${row.nr}-${row.date}`} className="border-t border-sand">
                    <td className={`${cell} tabular-nums`}>{row.nr}</td>
                    <td className={`${cell} whitespace-nowrap tabular-nums`}>{formatDateNl(row.date)}</td>
                    <td className={cell}>{row.kind}</td>
                    <td className={amount}>{formatEuro(row.amountCents)}</td>
                    <td className={`${cell} tabular-nums`}>{row.account}</td>
                    <td className={`${cell} tabular-nums`}>{row.contra.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}

/** The proposal from a source, with the choices that place its mutations, and "Begroting maken". */
function Proposal({ year, chart, origin, plan, onMade }: { year: number; chart: LedgerAccount[]; origin: Origin; plan: DepreciationPlan | null; onMade(): void }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [busy, run] = useBusy();
  const [choices, setChoices] = useState<MutationChoices>({ combined: {}, unplaced: {} });
  const [problem, setProblem] = useState<string | null>(null);

  const base = origin.kind === "mutations" ? mutationBase(origin.mutations, chart, choices) : null;
  const baseYear = origin.kind === "mutations" ? origin.mutations.year : origin.actuals.year;
  const covered = origin.kind === "mutations" ? monthOf(origin.mutations.to) - monthOf(origin.mutations.from) + 1 : monthOf(origin.actuals.lastDate);
  const lines = proposalOf(origin.kind === "mutations" ? base!.months : origin.actuals.accounts, covered, plan, chart);
  const source: BudgetSource =
    origin.kind === "mutations"
      ? { kind: "mutations", baseYear, from: origin.mutations.from, to: origin.mutations.to }
      : { kind: "ledger", baseYear, from: `${baseYear}-01-01`, to: origin.actuals.lastDate };

  const byCode = new Map(chart.map((account) => [account.code, account]));
  const kindOf = (line: Proposed) => byCode.get(line.accountCode)?.kind;
  const totalOf = (kind: "income" | "expense", pick: (line: Proposed) => number) =>
    lines.filter((line) => kindOf(line) === kind).reduce((sum, line) => sum + pick(line), 0);
  const planned = (line: Proposed) => sumOf(spread(line.rule, line.base));
  const before = (line: Proposed) => (line.base ? sumOf(line.base) : 0);

  const make = () =>
    run(async () => {
      setProblem(null);
      const answer = await api.putBudget(year, { source, lines: lines.map(({ accountCode, rule, base: months }) => ({ accountCode, rule, base: months })) });
      if (!answer.ok) return setProblem(explainWrite(answer.status, answer.error));
      toast.show("Begroting gemaakt.");
      onMade();
    });

  const part = (title: string, kind: "income" | "expense") => (
    <>
      <GroupTitle name={title} span={4} />
      {lines
        .filter((line) => kindOf(line) === kind)
        .map((line) => (
          <tr key={line.accountCode} className="border-t border-sand">
            <td className={cell}>
              {`${line.accountCode} ${byCode.get(line.accountCode)!.name}`}
              {line.fromAssets && <span className="block text-sm text-ink/70">uit de lijst Toestellen</span>}
            </td>
            <td className={cell}>{ruleText(line.rule, baseYear)}</td>
            <td className={amount}>{formatEuroShort(planned(line))}</td>
            <td className={amount}>{line.base ? formatEuroShort(before(line)) : ""}</td>
          </tr>
        ))}
    </>
  );
  const totalRow = (name: string, planCents: number, beforeCents: number) => (
    <tr className="border-t-2 border-ink/30 font-bold">
      <td className={cell}>{name}</td>
      <td className={cell} />
      <td className={amount}>{formatEuroShort(planCents)}</td>
      <td className={amount}>{formatEuroShort(beforeCents)}</td>
    </tr>
  );

  return (
    <>
      {base && <MutationDetails base={base} chart={chart} choices={choices} onChoose={setChoices} />}
      <Section title={`Voorstel voor ${year}`} note={`Per rekening een ritme en het bedrag voor ${year}, naast wat er in ${baseYear} was. Na het maken kun je elke regel wijzigen.`}>
        {lines.length === 0 ? (
          <p className="px-2 text-lg text-ink/70 sm:px-3">Er is niets om voor te stellen.</p>
        ) : (
          <div className={tableScroll}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={head}>Rekening</th>
                  <th className={head}>Ritme</th>
                  <th className={amountHead}>{`Begroting ${year}`}</th>
                  <th className={amountHead}>{String(baseYear)}</th>
                </tr>
              </thead>
              <tbody>
                {part("Opbrengsten", "income")}
                {totalRow("Totaal opbrengsten", totalOf("income", planned), totalOf("income", before))}
                {part("Kosten", "expense")}
                {totalRow("Totaal kosten", totalOf("expense", planned), totalOf("expense", before))}
                {totalRow("Resultaat", totalOf("income", planned) - totalOf("expense", planned), totalOf("income", before) - totalOf("expense", before))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex flex-col items-start gap-3 px-2 sm:px-3">
          <Button variant="primary" disabled={busy || lines.length === 0} onClick={() => void make()}>
            Begroting maken
          </Button>
          {problem && <Problem>{problem}</Problem>}
        </div>
      </Section>
    </>
  );
}

/** "Begroting {jaar} maken": a proposal from e-Boekhouden's mutations, or from the bookings of the year before. */
function MakeBudget({ year, chart, onMade }: { year: number; chart: LedgerAccount[]; onMade(): void }) {
  const previousYear = year - 1;
  const previous = useAdminData<BudgetActuals>(previousYear >= FIRST_LEDGER_YEAR ? ledgerPath.budgetActuals(previousYear) : null);
  const plan = useAdminData<DepreciationPlan>(ledgerPath.depreciation(year));
  const [busy, run] = useBusy();
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A new key for each source, so the choices of the one before do not stay.
  const [round, setRound] = useState(0);
  const booked = previous.data?.lastDate ? { ...previous.data, lastDate: previous.data.lastDate } : null;

  const start = (next: Origin) => {
    setRound((n) => n + 1);
    setOrigin(next);
  };
  const readFile = (file: File) =>
    run(async () => {
      setProblem(null);
      setOrigin(null);
      try {
        const { readMutationsFile } = await import("./mutations-file");
        const answer = await readMutationsFile(file);
        if (!answer.ok) return setProblem(answer.error === "not_one_year" ? NOT_ONE_YEAR : NOT_MUTATIONS);
        if (answer.mutations.year >= year) return setProblem(`Lees de mutaties van een jaar vóór ${year} in.`);
        start({ kind: "mutations", mutations: answer.mutations });
      } catch {
        setProblem("Het bestand kon niet worden gelezen. Probeer het opnieuw.");
      }
    });

  const summary: string[] = [];
  if (origin?.kind === "mutations") {
    const { mutations } = origin;
    summary.push(`${count(mutations.rows.length, "mutatie", "mutaties")} gelezen, van ${formatDateNl(mutations.from)} t/m ${formatDateNl(mutations.to)}.`);
    summary.push("Overboekingen tussen eigen rekeningen tellen niet mee.");
    summary.push(missingMonthsText(monthOf(mutations.to), mutations.year) ?? "");
  } else if (origin?.kind === "ledger") {
    summary.push(`Voorstel uit de boekingen van ${origin.actuals.year}, t/m ${formatDateNl(origin.actuals.lastDate)}.`);
    summary.push(missingMonthsText(monthOf(origin.actuals.lastDate), origin.actuals.year) ?? "");
  }

  return (
    <>
      <Section title={`Begroting ${year} maken`}>
        <div className="flex flex-col items-start gap-2 px-2 sm:px-3">
          <h3 className="font-bold">Voorstel uit de mutaties van e-Boekhouden</h3>
          <p className="text-ink/70">Exporteer in e-Boekhouden het overzicht Mutaties van een jaar als Excel-bestand.</p>
          <label className={`${pillLink} relative cursor-pointer has-[:disabled]:opacity-40`}>
            Mutatieoverzicht inlezen
            <input
              type="file"
              accept=".xlsx"
              disabled={busy}
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void readFile(file);
              }}
            />
          </label>
          {booked && (
            <>
              <h3 className="mt-3 font-bold">{`Voorstel uit de boekingen van ${previousYear}`}</h3>
              <p className="text-ink/70">{`Wat er in ${previousYear} in de app is geboekt, tot en met ${formatDateNl(booked.lastDate)}.`}</p>
              <Button
                disabled={busy}
                onClick={() => {
                  setProblem(null);
                  start({ kind: "ledger", actuals: booked });
                }}
              >
                {`Voorstel uit de boekingen van ${previousYear}`}
              </Button>
            </>
          )}
          {problem && <Problem>{problem}</Problem>}
          {summary
            .filter((sentence) => sentence !== "")
            .map((sentence, i) => (
              <p key={i} className={i === 0 ? "mt-3 text-lg font-semibold" : "text-lg"}>
                {sentence}
              </p>
            ))}
        </div>
      </Section>
      {origin && <Proposal key={round} year={year} chart={chart} origin={origin} plan={plan.data} onMade={onMade} />}
    </>
  );
}

const num = "px-1 py-1 text-right text-sm whitespace-nowrap tabular-nums";
const numHead = monthHead;

/** A row of the grid: the account (a button that opens the editor), twelve months and the year. */
function LineRow({ row, onEdit }: { row: GridRow; onEdit(code: string): void }) {
  const name = `${row.account.code} ${row.account.name}`;
  return (
    <tr className="border-t border-sand">
      <td className="px-1 sm:px-2">
        <button type="button" aria-label={`${name} wijzigen`} className="min-h-11 py-1 text-left font-semibold text-green-dark underline underline-offset-2" onClick={() => onEdit(row.account.code)}>
          {name}
        </button>
      </td>
      {row.months.slice(0, 12).map((cents, i) => (
        <td key={i} className={num}>
          {cents === 0 ? "" : formatWholeEuros(cents)}
        </td>
      ))}
      <td className={`${num} font-semibold`}>{formatWholeEuros(row.months[12]!)}</td>
    </tr>
  );
}

function GridTotal({ name, months }: { name: string; months: number[] }) {
  return (
    <tr className="border-t-2 border-ink/30 font-bold">
      <td className="px-1 py-2 sm:px-2">{name}</td>
      {months.map((cents, i) => (
        <td key={i} className={num}>
          {formatWholeEuros(cents)}
        </td>
      ))}
    </tr>
  );
}

/** "Rekening toevoegen": a visible income or expense account that is not in the budget yet, into the editor. */
function AddAccount({ chart, budget, onAdd }: { chart: LedgerAccount[]; budget: Budget; onAdd(account: LedgerAccount): void }) {
  const [code, setCode] = useState("");
  const taken = new Set(budget.lines.map((line) => line.accountCode));
  const free = chart.filter((account) => isResult(account) && !taken.has(account.code));
  if (!free.some((account) => !account.hidden)) return null;
  const chosen = free.find((account) => account.code === code);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 font-semibold">
        Rekening toevoegen
        <select className={field} value={code} onChange={(event) => setCode(event.target.value)}>
          <option value="">Kies een rekening</option>
          <AccountOptions chart={free} />
        </select>
      </label>
      <Button
        disabled={!chosen}
        onClick={() => {
          if (!chosen) return;
          setCode("");
          onAdd(chosen);
        }}
      >
        Toevoegen
      </Button>
    </div>
  );
}

/** "Begroting {jaar}": the grid of the year, adding an account, the Excel file, and emptying the year (asked once more). */
function BudgetTable({ year, chart, budget, onEdit, onAdd, onChanged }: { year: number; chart: LedgerAccount[]; budget: Budget; onEdit(code: string): void; onAdd(account: LedgerAccount): void; onChanged(): void }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [busy, run] = useBusy();
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const grid = budgetGrid(budget.lines, chart);
  const source = sourceText(budget.source);

  const download = () =>
    run(async () => {
      setProblem(null);
      try {
        const { budgetWorkbook } = await import("./budget-export");
        saveFile(budgetWorkbook(budget, chart), `Begroting ${year}.xlsx`);
      } catch {
        setProblem("Het Excel-bestand kon niet worden gemaakt. Probeer het opnieuw.");
      }
    });
  const empty = () =>
    run(async () => {
      setProblem(null);
      const answer = await api.deleteBudget(year);
      if (!answer.ok) return setProblem(explainWrite(answer.status, answer.error));
      setAsking(false);
      toast.show("Leeggemaakt.");
      onChanged();
    });

  return (
    <Section title={`Begroting ${year}`}>
      <div className="px-2 text-ink/70 sm:px-3">
        {source && <p>{source}</p>}
        <p>Bedragen in hele euro's.</p>
      </div>
      {budget.lines.length === 0 ? (
        <p className="mt-2 px-2 text-lg text-ink/70 sm:px-3">{`Er staat nog niets in de begroting van ${year}.`}</p>
      ) : (
        <div className={tableScroll}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="px-1 py-2 text-left text-sm font-semibold text-ink/70 sm:px-2">Rekening</th>
                {MONTH_SHORT.map((name) => (
                  <th key={name} className={numHead}>
                    {name}
                  </th>
                ))}
                <th className={numHead}>Totaal</th>
              </tr>
            </thead>
            <tbody>
              <GroupTitle name="Opbrengsten" span={14} />
              {grid.income.map((row) => (
                <LineRow key={row.account.code} row={row} onEdit={onEdit} />
              ))}
              <GridTotal name="Totaal opbrengsten" months={grid.incomeTotal} />
              <GroupTitle name="Kosten" span={14} />
              {grid.costs.map((row) => (
                <LineRow key={row.account.code} row={row} onEdit={onEdit} />
              ))}
              <GridTotal name="Totaal kosten" months={grid.costsTotal} />
              <GridTotal name="Resultaat" months={grid.result} />
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex flex-col items-start gap-4 px-2 sm:px-3">
        <AddAccount chart={chart} budget={budget} onAdd={onAdd} />
        {(budget.lines.length > 0 || budget.source) && (
          <div className="flex flex-wrap gap-2">
            {budget.lines.length > 0 && (
              <Button disabled={busy} onClick={() => void download()}>
                Downloaden als Excel
              </Button>
            )}
            <Button disabled={busy || asking} onClick={() => setAsking(true)}>
              {`Begroting ${year} leegmaken`}
            </Button>
          </div>
        )}
        {asking && (
          <div className="flex flex-col items-start gap-2 rounded-xl border-2 border-redbrown/40 p-3">
            <p className="text-lg font-semibold">{`Alle regels van ${year} gaan weg.`}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" disabled={busy} onClick={() => void empty()}>
                Leegmaken
              </Button>
              <Button onClick={() => setAsking(false)}>Annuleren</Button>
            </div>
          </div>
        )}
        {problem && <Problem>{problem}</Problem>}
      </div>
    </Section>
  );
}

type CompareRow = { account: LedgerAccount; year: number; planned: number; actual: number };

/** "Begroting en werkelijk": per account the budget of the year and up to a month, next to what is booked up to then. */
function CompareTable({ year, chart, budget, actuals }: { year: number; chart: LedgerAccount[]; budget: Budget; actuals: BudgetActuals & { lastDate: string } }) {
  const [upTo, setUpTo] = useState(monthOf(actuals.lastDate));
  const planned = new Map(budget.lines.map((line) => [line.accountCode, line.months]));
  const booked = new Map(actuals.accounts.map((account) => [account.accountCode, account.cents]));
  const rows: CompareRow[] = chart
    .filter((account) => isResult(account) && (planned.has(account.code) || booked.has(account.code)))
    .map((account) => {
      const plan = planned.get(account.code) ?? zeros();
      return { account, year: sumOf(plan), planned: sumOf(plan.slice(0, upTo)), actual: sumOf((booked.get(account.code) ?? zeros()).slice(0, upTo)) };
    });
  const totalOf = (kind: "income" | "expense") => {
    const part = rows.filter((row) => row.account.kind === kind);
    const add = (pick: (row: CompareRow) => number) => part.reduce((sum, row) => sum + pick(row), 0);
    return { year: add((row) => row.year), planned: add((row) => row.planned), actual: add((row) => row.actual) };
  };
  const income = totalOf("income");
  const costs = totalOf("expense");
  const month = MONTH_NAMES[upTo - 1]!;

  const figures = (values: { year: number; planned: number; actual: number }) => (
    <>
      <td className={amount}>{formatEuro(values.year)}</td>
      <td className={amount}>{formatEuro(values.planned)}</td>
      <td className={amount}>{formatEuro(values.actual)}</td>
      <td className={amount}>{formatEuro(values.actual - values.planned)}</td>
    </>
  );
  const part = (title: string, kind: "income" | "expense") => (
    <>
      <GroupTitle name={title} span={5} />
      {rows
        .filter((row) => row.account.kind === kind)
        .map((row) => (
          <tr key={row.account.code} className="border-t border-sand">
            <td className={cell}>{`${row.account.code} ${row.account.name}`}</td>
            {figures(row)}
          </tr>
        ))}
    </>
  );
  const total = (name: string, values: { year: number; planned: number; actual: number }) => (
    <tr className="border-t-2 border-ink/30 font-bold">
      <td className={cell}>{name}</td>
      {figures(values)}
    </tr>
  );

  return (
    <>
      <label className="flex flex-wrap items-center gap-2 px-2 font-semibold sm:px-3">
        Tot en met
        <select className={field} value={upTo} onChange={(event) => setUpTo(Number(event.target.value))}>
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <div className={tableScroll}>
        <table className={table}>
          <thead>
            <tr>
              <th className={head}>Rekening</th>
              <th className={amountHead}>{`Begroot ${year}`}</th>
              <th className={amountHead}>{`Begroot t/m ${month}`}</th>
              <th className={amountHead}>{`Werkelijk t/m ${month}`}</th>
              <th className={amountHead}>Verschil</th>
            </tr>
          </thead>
          <tbody>
            {part("Opbrengsten", "income")}
            {total("Totaal opbrengsten", income)}
            {part("Kosten", "expense")}
            {total("Totaal kosten", costs)}
            {total("Resultaat", { year: income.year - costs.year, planned: income.planned - costs.planned, actual: income.actual - costs.actual })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 px-2 text-ink/70 sm:px-3">Verschil is werkelijk min begroot tot en met die maand. Een rekening zonder begroting staat er met 0.</p>
    </>
  );
}

function Comparison({ year, chart, budget }: { year: number; chart: LedgerAccount[]; budget: Budget }) {
  const actuals = useAdminData<BudgetActuals>(ledgerPath.budgetActuals(year));
  return (
    <Section title={`Begroting en werkelijk ${year}`}>
      <Loaded from={actuals}>
        {(data) =>
          data.lastDate === null ? (
            <p className="px-2 text-lg text-ink/70 sm:px-3">{`Er zijn nog geen boekingen in ${year}.`}</p>
          ) : (
            <CompareTable key={data.lastDate} year={year} chart={chart} budget={budget} actuals={{ ...data, lastDate: data.lastDate }} />
          )
        }
      </Loaded>
    </Section>
  );
}

type Editing = { account: LedgerAccount; line: BudgetLine | null };

/** Everything of one year: making it (while it has no lines), the grid, the editor, and the books next to it. */
function YearBudget({ year, chart, budget, onChanged }: { year: number; chart: LedgerAccount[]; budget: Budget; onChanged(): void }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const byCode = new Map(chart.map((account) => [account.code, account]));
  const edit = (code: string) => {
    const account = byCode.get(code);
    if (account) setEditing({ account, line: budget.lines.find((line) => line.accountCode === code) ?? null });
  };
  return (
    <>
      {budget.lines.length === 0 && <MakeBudget year={year} chart={chart} onMade={onChanged} />}
      <BudgetTable year={year} chart={chart} budget={budget} onEdit={edit} onAdd={(account) => setEditing({ account, line: null })} onChanged={onChanged} />
      {editing && (
        <BudgetEditor
          key={editing.account.code}
          year={year}
          account={editing.account}
          line={editing.line}
          baseYear={budget.source?.baseYear ?? null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {year >= FIRST_LEDGER_YEAR && <Comparison year={year} chart={chart} budget={budget} />}
    </>
  );
}

/**
 * Begroting: a budget per month for a year, proposed from e-Boekhouden's mutations of a year before (or from the
 * bookings of the year before), changed line by line, and laid next to what is booked. It never changes a booking.
 */
export function BudgetPage() {
  const years = budgetYears(today());
  const [year, setYear] = useState(() => Math.max(Number(today().slice(0, 4)), FIRST_LEDGER_YEAR));
  const accounts = useAdminData<LedgerAccount[]>(ledgerPath.accounts);
  const budget = useAdminData<Budget>(ledgerPath.budget(year));
  return (
    <div>
      <PageTitle>Begroting</PageTitle>
      <label className="mt-4 flex flex-wrap items-center gap-2 font-semibold">
        Jaar
        <select className={`${field} w-28`} value={year} onChange={(event) => setYear(Number(event.target.value))}>
          {years.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <Loaded from={accounts}>
        {(chart) => <Loaded from={budget}>{(data) => <YearBudget key={year} year={year} chart={chart} budget={data} onChanged={budget.reload} />}</Loaded>}
      </Loaded>
    </div>
  );
}
