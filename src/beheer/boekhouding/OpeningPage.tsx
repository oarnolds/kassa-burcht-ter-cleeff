import { useState } from "react";
import { formatEuro } from "../../../shared/money";
import type { LedgerAccount } from "../../../shared/ledger-types";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { Loaded, PageTitle, Problem, Section } from "../parts";
import { useAdminData } from "../useAdmin";
import { AmountField } from "./AmountField";
import { ledgerPath, useLedgerWrites, type Opening } from "./ledger-api";

const YEAR = 2027;
/** The account that is the other side of the opening: worked out, never typed. */
const EQUITY = "1400";
/** An asset that is shown the other way round: it is subtracted from the assets. */
const DEPRECIATION = "0135";

function OpeningForm({ accounts, opening }: { accounts: LedgerAccount[]; opening: Opening }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const saved = new Map(opening.lines.map((line) => [line.accountCode, line.amountCents]));
  const rows = accounts.filter(
    (account) => account.code !== EQUITY && (account.kind === "asset" || account.kind === "liability") && (!account.hidden || saved.has(account.code)),
  );
  const [cents, setCents] = useState<Record<string, number | null>>(() => Object.fromEntries(rows.map((row) => [row.code, saved.get(row.code) || null])));
  const [eBoekhouden, setEBoekhouden] = useState<number | null>(opening.eBoekhoudenEquityCents);
  const [problem, setProblem] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState<Set<string>>(new Set());
  const mark = (key: string) => (bad: boolean) =>
    setUnreadable((before) => {
      const next = new Set(before);
      if (bad) next.add(key);
      else next.delete(key);
      return next;
    });

  // Assets (without 0135) minus 0135 minus liabilities: what is left for the club itself.
  const equity = rows.reduce((total, row) => {
    const value = cents[row.code] ?? 0;
    return row.kind === "liability" || row.code === DEPRECIATION ? total - value : total + value;
  }, 0);

  const save = async () => {
    setProblem(null);
    const lines = rows.filter((row) => cents[row.code]).map((row) => ({ accountCode: row.code, amountCents: cents[row.code]! }));
    const answer = await api.putOpening(YEAR, { lines, eBoekhoudenEquityCents: eBoekhouden });
    if (!answer.ok) return setProblem(answer.status === 0 ? "Geen verbinding. Probeer het opnieuw." : "Opslaan is niet gelukt. Probeer het opnieuw.");
    toast.show("Opgeslagen.");
  };

  return (
    <>
      <Section title="Bezittingen en schulden" note="Zoals e-Boekhouden ze op 31 december 2026 laat zien.">
        <ul className="px-2 sm:px-3">
          {rows.map((row) => (
            <li key={row.code} className="flex flex-wrap items-center justify-between gap-2 border-t border-sand py-2 first:border-t-0">
              <span className="text-lg">
                <span className="tabular-nums">{row.code}</span> {row.name}
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
        {rows.some((row) => row.code === "1000") ? (
          <p className="mt-3 px-2 text-ink/70 sm:px-3">{`Volgens de kassa hoort er op 31 december ${formatEuro(opening.expectedCashCents)} in het kluisje.`}</p>
        ) : null}
      </Section>
      <Section title="Uitkomst">
        <div className="flex flex-col gap-3 px-2 sm:px-3">
          <p className="flex flex-wrap justify-between gap-2 text-lg">
            <span className="font-semibold">Eigen vermogen (uitgerekend)</span>
            <strong className="tabular-nums">{formatEuro(equity)}</strong>
          </p>
          <label className="flex flex-wrap items-center justify-between gap-2 text-lg font-semibold">
            Eigen vermogen in e-Boekhouden (ter vergelijking)
            <AmountField valueCents={eBoekhouden} onChange={setEBoekhouden} onUnreadable={mark("eb")} className="w-40 text-right font-normal tabular-nums" />
          </label>
          {eBoekhouden !== null && (
            <p className="flex flex-wrap justify-between gap-2 text-lg">
              <span>Verschil met e-Boekhouden</span>
              <strong className="tabular-nums">{formatEuro(eBoekhouden - equity)}</strong>
            </p>
          )}
        </div>
      </Section>
      <div className="mt-6 flex flex-col items-start gap-3">
        <Button variant="primary" disabled={unreadable.size > 0} onClick={() => void save()}>
          Opslaan
        </Button>
        {problem && <Problem>{problem}</Problem>}
      </div>
    </>
  );
}

/** The balance on 1 January 2027, typed from e-Boekhouden: one entry, replaced on every save. */
export function OpeningPage() {
  const accounts = useAdminData<LedgerAccount[]>(ledgerPath.accounts);
  const opening = useAdminData<Opening>(ledgerPath.opening(YEAR));
  return (
    <div>
      <PageTitle>Beginbalans 1 januari 2027</PageTitle>
      <Loaded from={accounts}>{(list) => <Loaded from={opening}>{(data) => <OpeningForm accounts={list} opening={data} />}</Loaded>}</Loaded>
    </div>
  );
}
