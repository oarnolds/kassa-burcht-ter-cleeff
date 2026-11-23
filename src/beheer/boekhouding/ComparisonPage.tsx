import { useState } from "react";
import type { LedgerAccount } from "../../../shared/ledger-types";
import { Button } from "../../ui/Button";
import { EuroInput } from "../../ui/EuroInput";
import { useToast } from "../../ui/Toast";
import { Loaded, PageTitle, Problem, Section } from "../parts";
import { useAdminData, useAdminWrite } from "../useAdmin";
import { LEDGER, type Comparison } from "./ledger-api";

const YEAR = 2026;

/** `4302 en 4303`, `8000, 8001, 8002 en 8003`. */
const joined = (items: string[]): string => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} en ${items.at(-1)}`);

function ComparisonForm({ accounts, comparison }: { accounts: LedgerAccount[]; comparison: Comparison }) {
  const write = useAdminWrite();
  const toast = useToast();
  const rows = accounts.filter((account) => account.kind === "income" || account.kind === "expense");
  const typed = new Map(comparison.figures.map((figure) => [figure.accountCode, figure.amountCents]));
  const [cents, setCents] = useState<Record<string, number | null>>(() => Object.fromEntries(rows.map((row) => [row.code, typed.get(row.code) ?? null])));
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    setProblem(null);
    const figures = rows.filter((row) => cents[row.code] !== null).map((row) => ({ accountCode: row.code, amountCents: cents[row.code]! }));
    const answer = await write(`${LEDGER}/comparison?year=${YEAR}`, "PUT", { figures });
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
                {(row.formerly.length !== 1 || row.formerly[0] !== row.code) && (
                  <span className="block text-sm text-ink/70">{`was ${joined(row.formerly)}`}</span>
                )}
              </span>
              <EuroInput
                aria-label={row.name}
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
        <Button variant="primary" onClick={() => void save()}>
          Opslaan
        </Button>
        {problem && <Problem>{problem}</Problem>}
      </div>
    </>
  );
}

/** The 2026 result per account as e-Boekhouden has it, typed once, so 2027 can be read next to it. */
export function ComparisonPage() {
  const accounts = useAdminData<LedgerAccount[]>(`${LEDGER}/accounts`);
  const comparison = useAdminData<Comparison>(`${LEDGER}/comparison?year=${YEAR}`);
  return (
    <div>
      <PageTitle>Cijfers 2026</PageTitle>
      <p className="mt-2 text-lg text-ink/70">Wat e-Boekhouden over 2026 laat zien, per rekening. Laat leeg wat nul is.</p>
      <Loaded from={accounts}>{(list) => <Loaded from={comparison}>{(data) => <ComparisonForm accounts={list} comparison={data} />}</Loaded>}</Loaded>
    </div>
  );
}
