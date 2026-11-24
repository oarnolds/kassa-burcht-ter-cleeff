import { useEffect, useRef, useState } from "react";
import { type BudgetLine, type BudgetRule, formatWholeEuros, readWholeEuros, spread } from "../../../shared/budget";
import type { LedgerAccount } from "../../../shared/ledger-types";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { Problem, Section, field, table, tableScroll } from "../parts";
import { MONTH_NAMES, MONTH_SHORT, QUARTER_MONTHS, monthHead, sumOf } from "./budget-grid";
import { explainWrite, useLedgerWrites } from "./ledger-api";
import { useBusy } from "./useBusy";

type Kind = BudgetRule["kind"];
/** What is typed, per rhythm: one amount (with its quarter or month), or twelve. */
type Fields = { amount: string; quarter: 1 | 2 | 3; month: number; months: string[] };

const label = "flex flex-col gap-1 font-semibold";
const small = "px-1 py-1 text-right text-sm whitespace-nowrap tabular-nums";
const CENTS = "Vul hele euro's in, zonder centen.";
const UNREADABLE = "Dit bedrag kan ik niet lezen.";

/** A month in the preview: whole euros, empty when nothing. */
const shown = (cents: number) => (cents === 0 ? "" : formatWholeEuros(cents));

/** The fields as a line's own rule fills them; the twelve months are what it gives now. */
function fieldsOfLine({ rule, months }: BudgetLine): Fields {
  return {
    amount: rule.kind === "custom" ? "" : formatWholeEuros(rule.amountCents),
    quarter: rule.kind === "quarterly" ? rule.month : 1,
    month: rule.kind === "yearly" ? rule.month : 1,
    months: months.map(formatWholeEuros),
  };
}

/** The fields of another rhythm, filled so the year stays about what `months` add up to. */
function fieldsFor(kind: Kind, months: number[]): Fields {
  const total = sumOf(months);
  const largest = months.reduce((best, cents, i) => (Math.abs(cents) > Math.abs(months[best]!) ? i : best), 0);
  const amount = { monthly: total / 12, quarterly: total / 4, yearly: total, pattern: total, custom: 0 }[kind];
  return { amount: formatWholeEuros(amount), quarter: 1, month: largest + 1, months: months.map(formatWholeEuros) };
}

type Read = { rule: BudgetRule | null; problem: string | null };

/** The rule the fields make; or nothing yet, with what is wrong. */
function readFields(kind: Kind, fields: Fields): Read {
  const explain = (answer: "cents" | "unreadable" | "empty") => (answer === "cents" ? CENTS : answer === "unreadable" ? UNREADABLE : null);
  if (kind === "custom") {
    const answers = fields.months.map(readWholeEuros);
    const wrong = answers.find((answer) => answer === "cents") ?? answers.find((answer) => answer === "unreadable");
    if (wrong) return { rule: null, problem: explain(wrong) };
    return { rule: { kind, months: answers.map((answer) => (typeof answer === "number" ? answer : 0)) }, problem: null };
  }
  const amountCents = readWholeEuros(fields.amount);
  if (typeof amountCents !== "number") return { rule: null, problem: explain(amountCents) };
  if (kind === "quarterly") return { rule: { kind, amountCents, month: fields.quarter }, problem: null };
  if (kind === "yearly") return { rule: { kind, amountCents, month: fields.month }, problem: null };
  return { rule: { kind, amountCents }, problem: null };
}

function PreviewRow({ name, months }: { name: string; months: number[] | null }) {
  return (
    <tr className="border-t border-sand">
      <th scope="row" className="px-1 py-1 text-left text-sm font-semibold whitespace-nowrap">
        {name}
      </th>
      {Array.from({ length: 12 }, (_, i) => (
        <td key={i} className={small}>
          {months ? shown(months[i]!) : ""}
        </td>
      ))}
      <td className={`${small} font-semibold`}>{months ? formatWholeEuros(sumOf(months)) : ""}</td>
    </tr>
  );
}

type Props = {
  year: number;
  account: LedgerAccount;
  /** null: an account that is not in the budget yet. */
  line: BudgetLine | null;
  baseYear: number | null;
  onClose(): void;
  onSaved(): void;
};

/**
 * One line of the budget: its rhythm and amount in whole euros, what that gives per month next to the base year,
 * and "Uit de begroting halen".
 */
export function BudgetEditor({ year, account, line, baseYear, onClose, onSaved }: Props) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [busy, run] = useBusy();
  const base = line?.base ?? null;
  const hasBase = base !== null && sumOf(base) !== 0;
  const [kind, setKind] = useState<Kind>(line?.rule.kind ?? "monthly");
  const [fields, setFields] = useState<Fields>(() => (line ? fieldsOfLine(line) : { amount: "", quarter: 1, month: 1, months: Array(12).fill("") }));
  const [problem, setProblem] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);

  // The editor opens under the grid: bring it into view.
  useEffect(() => top.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }), []);

  const read = readFields(kind, fields);
  const months = read.rule ? spread(read.rule, base) : null;
  const like = baseYear === null ? "het basisjaar" : String(baseYear);
  const kinds: [Kind, string][] = [
    ["monthly", "Elke maand hetzelfde"],
    ["quarterly", "Per kwartaal"],
    ["yearly", "Eén keer per jaar"],
    ...(hasBase ? [["pattern", `Zoals ${like}`] as [Kind, string]] : []),
    ["custom", "Eigen bedrag per maand"],
  ];

  const choose = (next: Kind) => {
    setFields(fieldsFor(next, months ?? line?.months ?? Array(12).fill(0)));
    setKind(next);
  };
  const set = (more: Partial<Fields>) => setFields((before) => ({ ...before, ...more }));

  const save = () =>
    run(async () => {
      if (!read.rule) return;
      setProblem(null);
      const answer = await api.putBudgetLine(year, account.code, read.rule);
      if (!answer.ok) return setProblem(explainWrite(answer.status, answer.error));
      toast.show("Opgeslagen.");
      onSaved();
    });
  const remove = () =>
    run(async () => {
      setProblem(null);
      const answer = await api.deleteBudgetLine(year, account.code);
      if (!answer.ok) return setProblem(explainWrite(answer.status, answer.error));
      toast.show("Uit de begroting gehaald.");
      onSaved();
    });

  const amountField = (name: string) => (
    <label className={label}>
      {name}
      <input type="text" autoComplete="off" className={`${field} w-40 text-right tabular-nums`} value={fields.amount} onChange={(event) => set({ amount: event.target.value })} />
    </label>
  );

  return (
    <div ref={top} className="scroll-mt-4">
      <Section title={`${account.code} ${account.name}`} note="Bedragen in hele euro's.">
        <div className="flex flex-col gap-3 px-2 sm:px-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className={label}>
              Ritme
              <select className={field} value={kind} onChange={(event) => choose(event.target.value as Kind)}>
                {kinds.map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {kind === "monthly" && amountField("Bedrag per maand")}
            {kind === "quarterly" && (
              <>
                {amountField("Bedrag per kwartaal")}
                <label className={label}>
                  In de maanden
                  <select className={field} value={fields.quarter} onChange={(event) => set({ quarter: Number(event.target.value) as 1 | 2 | 3 })}>
                    {QUARTER_MONTHS.map((names, i) => (
                      <option key={names} value={i + 1}>
                        {names}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {kind === "yearly" && (
              <>
                {amountField("Bedrag")}
                <label className={label}>
                  Maand
                  <select className={field} value={fields.month} onChange={(event) => set({ month: Number(event.target.value) })}>
                    {MONTH_NAMES.map((name, i) => (
                      <option key={name} value={i + 1}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {kind === "pattern" && (
              <>
                {amountField("Bedrag voor het hele jaar")}
                <span className="pb-2 text-ink/70">{`verdeeld zoals ${like}`}</span>
              </>
            )}
          </div>
          {kind === "custom" && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
              {MONTH_SHORT.map((name, i) => (
                <label key={name} className="flex flex-col gap-1 text-sm font-semibold">
                  {name}
                  <input
                    type="text"
                    autoComplete="off"
                    className={`${field} w-full min-w-0 px-2 text-right tabular-nums`}
                    value={fields.months[i]}
                    onChange={(event) => set({ months: fields.months.map((text, j) => (j === i ? event.target.value : text)) })}
                  />
                </label>
              ))}
            </div>
          )}
          {read.problem && <span className="text-sm font-semibold text-redbrown">{read.problem}</span>}
          <div className={tableScroll}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={monthHead}>
                    <span className="sr-only">Wat</span>
                  </th>
                  {MONTH_SHORT.map((name) => (
                    <th key={name} className={monthHead}>
                      {name}
                    </th>
                  ))}
                  <th className={monthHead}>Totaal</th>
                </tr>
              </thead>
              <tbody>
                <PreviewRow name="Dat wordt:" months={months} />
                {base && <PreviewRow name={`In ${like}:`} months={base} />}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!read.rule || busy} onClick={() => void save()}>
              Opslaan
            </Button>
            <Button onClick={onClose}>Annuleren</Button>
            {line && (
              <Button disabled={busy} onClick={() => void remove()}>
                Uit de begroting halen
              </Button>
            )}
          </div>
          {problem && <Problem>{problem}</Problem>}
        </div>
      </Section>
    </div>
  );
}
