import { useState } from "react";
import { useSearchParams } from "react-router";
import type { LedgerAccount } from "../../../shared/ledger-types";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { Loaded, PageTitle, Problem, Section } from "../parts";
import { useAdminData } from "../useAdmin";
import { AmountField } from "./AmountField";
import { FIRST_LEDGER_YEAR, FROM_LEDGER, ledgerPath, useLedgerWrites, type Comparison } from "./ledger-api";

/** The year the page opens without `?jaar=`: the last one before the books. */
const DEFAULT_YEAR = FIRST_LEDGER_YEAR - 1;

/** `4302 en 4303`, `8000, 8001, 8002 en 8003`. */
const joined = (items: string[]): string => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} en ${items.at(-1)}`);

/** "was 4302 en 4303" for an account that took over other old numbers than its own; null otherwise. */
export const wasNote = (account: LedgerAccount): string | null =>
  account.formerly.some((old) => old !== account.code) ? `was ${joined(account.formerly)}` : null;

function ComparisonForm({ year, accounts, comparison }: { year: number; accounts: LedgerAccount[]; comparison: Comparison }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const rows = accounts.filter((account) => account.kind === "income" || account.kind === "expense");
  const typed = new Map(comparison.figures.map((figure) => [figure.accountCode, figure.amountCents]));
  const [cents, setCents] = useState<Record<string, number | null>>(() => Object.fromEntries(rows.map((row) => [row.code, typed.get(row.code) ?? null])));
  const [problem, setProblem] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState<Set<string>>(new Set());
  const mark = (key: string) => (bad: boolean) =>
    setUnreadable((before) => {
      const next = new Set(before);
      if (bad) next.add(key);
      else next.delete(key);
      return next;
    });

  const save = async () => {
    setProblem(null);
    const figures = rows.filter((row) => cents[row.code] !== null).map((row) => ({ accountCode: row.code, amountCents: cents[row.code]! }));
    const answer = await api.putComparison(year, figures);
    if (!answer.ok) return setProblem(answer.status === 0 ? "Geen verbinding. Probeer het opnieuw." : "Opslaan is niet gelukt. Probeer het opnieuw.");
    toast.show("Opgeslagen.");
  };

  const part = (kind: "income" | "expense", title: string) => (
    <Section title={title}>
      <ul className="px-2 sm:px-3">
        {rows
          .filter((row) => row.kind === kind)
          .map((row) => (
            <li key={row.code} className="flex flex-wrap items-center justify-between gap-2 border-t border-sand py-2 first:border-t-0">
              <span className="text-lg">
                <span className="tabular-nums">{row.code}</span> {row.name}
                {wasNote(row) && <span className="block text-sm text-ink/70">{wasNote(row)}</span>}
              </span>
              <AmountField
                label={row.name}
                onUnreadable={mark(row.code)}
                valueCents={cents[row.code] ?? null}
                onChange={(value) => setCents((before) => ({ ...before, [row.code]: value }))}
                className="w-40 text-right tabular-nums"
              />
            </li>
          ))}
      </ul>
    </Section>
  );

  return (
    <>
      {part("income", "Opbrengsten")}
      {part("expense", "Kosten")}
      <div className="mt-6 flex flex-col items-start gap-3">
        <Button variant="primary" disabled={unreadable.size > 0} onClick={() => void save()}>
          Opslaan
        </Button>
        {problem && <Problem>{problem}</Problem>}
      </div>
    </>
  );
}

/** The year asked for in the address (`?jaar=2025`), or DEFAULT_YEAR. */
function yearAsked(value: string | null): number {
  return value !== null && /^\d{4}$/.test(value) ? Number(value) : DEFAULT_YEAR;
}

/**
 * The result of a year before the books per account as e-Boekhouden has it (`?jaar=`, 2026 without), typed or read
 * from e-Boekhouden's export, so the app's years can be read next to it.
 */
export function ComparisonPage() {
  const [params] = useSearchParams();
  const year = yearAsked(params.get("jaar"));
  const before = year < FIRST_LEDGER_YEAR;
  const accounts = useAdminData<LedgerAccount[]>(before ? ledgerPath.accounts : null);
  const comparison = useAdminData<Comparison>(before ? ledgerPath.comparison(year) : null);
  return (
    <div>
      <PageTitle>{`Cijfers ${year}`}</PageTitle>
      {before ? (
        <>
          <p className="mt-2 text-lg text-ink/70">{`Wat e-Boekhouden over ${year} laat zien, per rekening. Laat leeg wat nul is.`}</p>
          <Loaded from={accounts}>
            {(list) => <Loaded from={comparison}>{(data) => <ComparisonForm key={year} year={year} accounts={list} comparison={data} />}</Loaded>}
          </Loaded>
        </>
      ) : (
        <p className="mt-2 text-lg">{FROM_LEDGER}</p>
      )}
    </div>
  );
}
