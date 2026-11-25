import { useState } from "react";
import { Link } from "react-router";
import type { EbMapped, EbResult, EbUnplaced } from "../../../shared/eboekhouden-result";
import type { ComparisonYear, LedgerAccount } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { Button } from "../../ui/Button";
import { useToast } from "../../ui/Toast";
import { Loaded, PageTitle, Problem, Section, amount, amountHead, cell, field, head, pillLink, table, tableScroll, textLink } from "../parts";
import { useAdminData } from "../useAdmin";
import { wasNote } from "./ComparisonPage";
import { FIRST_LEDGER_YEAR, comparisonRoute, explainWrite, ledgerPath, useLedgerWrites, type Figure } from "./ledger-api";
import { useBusy } from "./useBusy";

const NOT_EBOEKHOUDEN = "Dit is geen winst-en-verliesrekening uit e-Boekhouden.";
const NOT_WHOLE_YEAR = "Lees de winst-en-verliesrekening van een heel jaar in (1 januari tot en met 31 december).";

type Read = { result: EbResult; mapped: EbMapped };
const isResult = (account: LedgerAccount) => account.kind === "income" || account.kind === "expense";

/** What an unplaced row adds to the result: positive under "Winst", negative under "Verlies" (see EbUnplaced). */
const effectOf = (row: EbUnplaced) => (row.kind === "expense" ? 0 - row.amountCents : row.amountCents);

/** The figures to take over: the placed ones, with each unplaced row on the account chosen for it (by index). */
function figuresOf(mapped: EbMapped, choices: Record<number, string>, accounts: LedgerAccount[]): Figure[] {
  const sums = new Map(mapped.figures.map((figure) => [figure.accountCode, figure.amountCents]));
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  mapped.unplaced.forEach((row, index) => {
    const account = byCode.get(choices[index] ?? "");
    if (!account) return;
    // As the report shows the chosen account: income adds the result, costs take it away.
    const cents = account.kind === "income" ? effectOf(row) : 0 - effectOf(row);
    sums.set(account.code, (sums.get(account.code) ?? 0) + cents);
  });
  return accounts.filter((account) => sums.has(account.code)).map((account) => ({ accountCode: account.code, amountCents: sums.get(account.code)! }));
}

function StoredYears({ years }: { years: ComparisonYear[] }) {
  if (years.length === 0) return <p className="px-2 text-lg text-ink/70 sm:px-3">Er is nog geen jaar ingelezen.</p>;
  return (
    <div className={tableScroll}>
      <table className={table}>
        <thead>
          <tr>
            <th className={head}>Jaar</th>
            <th className={amountHead}>Opbrengsten</th>
            <th className={amountHead}>Kosten</th>
            <th className={amountHead}>Resultaat</th>
            <th className={head}>
              <span className="sr-only">Cijfers</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {years.map((year) => (
            <tr key={year.year} className="border-t border-sand">
              <td className={`${cell} font-semibold tabular-nums`}>{year.year}</td>
              <td className={amount}>{formatEuro(year.incomeCents)}</td>
              <td className={amount}>{formatEuro(year.costsCents)}</td>
              <td className={amount}>{formatEuro(year.resultCents)}</td>
              <td className={cell}>
                <Link to={comparisonRoute(year.year)} className={`${textLink} inline-flex min-h-11 items-center`}>
                  Bekijken of wijzigen
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TotalRow({ name, cents }: { name: string; cents: number }) {
  return (
    <tr className="border-t-2 border-ink/30 font-bold">
      <td className={cell} colSpan={2}>
        {name}
      </td>
      <td className={amount}>{formatEuro(cents)}</td>
    </tr>
  );
}

/**
 * What was read from the file, on the app's accounts: the figures per account with their totals, the rows no account
 * takes (each "Niet meenemen" or onto an account), and "Overnemen", which replaces the year's figures.
 */
function ReadYear({ read, accounts, stored, onSaved }: { read: Read; accounts: LedgerAccount[]; stored: boolean; onSaved(): void }) {
  const api = useLedgerWrites();
  const toast = useToast();
  const [busy, run] = useBusy();
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const { year, saldo } = read.result;
  const figures = figuresOf(read.mapped, choices, accounts);
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const total = (kind: "income" | "expense") =>
    figures.filter((figure) => byCode.get(figure.accountCode)?.kind === kind).reduce((sum, figure) => sum + figure.amountCents, 0);
  const income = total("income");
  const costs = total("expense");
  const offered = accounts.filter((account) => isResult(account) && !account.hidden);
  const replaces = `${year} staat er al; overnemen vervangt die cijfers.`;

  const save = () =>
    run(async () => {
      setProblem(null);
      if (stored && !window.confirm(replaces)) return;
      const answer = await api.putComparison(year, figures);
      if (!answer.ok) return setProblem(explainWrite(answer.status, answer.error));
      toast.show("Overgenomen.");
      onSaved();
    });

  const part = (title: string, kind: "income" | "expense") => (
    <>
      <tr>
        <th colSpan={3} scope="colgroup" className="px-1.5 pt-4 pb-1 text-left text-sm font-bold text-ink/70 sm:px-3">
          {title}
        </th>
      </tr>
      {figures
        .filter((figure) => byCode.get(figure.accountCode)?.kind === kind)
        .map((figure) => {
          const account = byCode.get(figure.accountCode)!;
          const note = wasNote(account);
          return (
            <tr key={figure.accountCode} className="border-t border-sand">
              <td className={`${cell} tabular-nums`}>{account.code}</td>
              <td className={cell}>
                {account.name}
                {note && <span className="block text-sm text-ink/70">{note}</span>}
              </td>
              <td className={amount}>{formatEuro(figure.amountCents)}</td>
            </tr>
          );
        })}
    </>
  );

  return (
    <>
      <Section title={`Winst en verlies ${year}`} note="Zo komen de cijfers op de rekeningen van de app.">
        <div className={tableScroll}>
          <table className={table}>
            <thead>
              <tr>
                <th className={head}>Nummer</th>
                <th className={head}>Naam</th>
                <th className={amountHead}>Bedrag</th>
              </tr>
            </thead>
            <tbody>
              {part("Opbrengsten", "income")}
              {part("Kosten", "expense")}
              <TotalRow name="Totaal opbrengsten" cents={income} />
              <TotalRow name="Totaal kosten" cents={costs} />
              <TotalRow name="Resultaat" cents={income - costs} />
            </tbody>
          </table>
        </div>
        {saldo && <p className="mt-3 px-2 text-lg sm:px-3">{`Volgens e-Boekhouden: ${saldo.label} ${formatEuro(saldo.cents)}`}</p>}
      </Section>
      {read.mapped.unplaced.length > 0 && (
        <Section
          title="Niet geplaatst"
          note="Deze regels horen bij geen rekening van de app. Kies een rekening, of neem ze niet mee (zoals 9999 Eindresultaat meestal)."
        >
          <ul className="px-2 sm:px-3">
            {read.mapped.unplaced.map((row, index) => {
              const label = `${row.code} ${row.name}`;
              const effect = effectOf(row);
              return (
                <li key={index} aria-label={label} className="flex flex-wrap items-center justify-between gap-2 border-t border-sand py-2 first:border-t-0">
                  <span className="text-lg">
                    <span className="tabular-nums">{row.code}</span> {row.name}
                    <span className="block text-sm text-ink/70">{`${effect < 0 ? "Verlies" : "Winst"} ${formatEuro(Math.abs(effect))}`}</span>
                  </span>
                  <select
                    aria-label={`Rekening voor ${label}`}
                    className={field}
                    value={choices[index] ?? ""}
                    onChange={(event) => setChoices((before) => ({ ...before, [index]: event.target.value }))}
                  >
                    <option value="">Niet meenemen</option>
                    {(
                      [
                        ["Kosten", "expense"],
                        ["Opbrengsten", "income"],
                      ] as const
                    ).map(([title, kind]) => (
                      <optgroup key={kind} label={title}>
                        {offered
                          .filter((account) => account.kind === kind)
                          .map((account) => (
                            <option key={account.code} value={account.code}>{`${account.code} ${account.name}`}</option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      <div className="mt-6 flex flex-col items-start gap-3">
        {stored && <p className="text-lg font-semibold">{replaces}</p>}
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          Overnemen
        </Button>
        {problem && <Problem>{problem}</Problem>}
      </div>
    </>
  );
}

function Reader({ accounts, years, onSaved }: { accounts: LedgerAccount[]; years: ComparisonYear[]; onSaved(): void }) {
  const [busy, run] = useBusy();
  const [read, setRead] = useState<Read | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A new key for each file read, so the choices of the one before do not stay.
  const [round, setRound] = useState(0);

  const readFile = (file: File) =>
    run(async () => {
      setProblem(null);
      setRead(null);
      try {
        const { readEBoekhoudenFile } = await import("./eboekhouden-file");
        const answer = await readEBoekhoudenFile(file, accounts);
        if (!answer.ok) return setProblem(answer.error === "not_whole_year" ? NOT_WHOLE_YEAR : NOT_EBOEKHOUDEN);
        if (answer.result.year >= FIRST_LEDGER_YEAR) return setProblem(`${answer.result.year} staat in de boekhouding zelf; dat jaar hoeft u hier niet in te lezen.`);
        setRound((n) => n + 1);
        setRead(answer);
      } catch {
        setProblem("Het bestand kon niet worden gelezen. Probeer het opnieuw.");
      }
    });

  return (
    <>
      <Section title="Inlezen" note="Exporteer in e-Boekhouden bij Rapportages → Winst & verlies een heel jaar naar Excel, en kies dat bestand.">
        <div className="flex flex-col items-start gap-2 px-2 sm:px-3">
          <label className={`${pillLink} relative cursor-pointer has-[:disabled]:opacity-40`}>
            W&V uit e-Boekhouden inlezen
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
          {problem && <Problem>{problem}</Problem>}
        </div>
      </Section>
      {read && (
        <ReadYear
          key={round}
          read={read}
          accounts={accounts}
          stored={years.some((year) => year.year === read.result.year)}
          onSaved={() => {
            setRead(null);
            onSaved();
          }}
        />
      )}
    </>
  );
}

/**
 * Eerdere jaren: the winst-en-verliesrekening of years before the books, read from e-Boekhouden's export. Only to
 * compare: the figures are not booked, and are not in the balance or the year's closing.
 */
export function EarlierYearsPage() {
  const accounts = useAdminData<LedgerAccount[]>(ledgerPath.accounts);
  const years = useAdminData<ComparisonYear[]>(ledgerPath.comparisonYears);
  return (
    <div>
      <PageTitle>Eerdere jaren</PageTitle>
      <p className="mt-2 text-lg text-ink/70">
        {`De winst-en-verliesrekening van jaren vóór ${FIRST_LEDGER_YEAR}, uit e-Boekhouden. Alleen om te vergelijken (Rapporten → Meerjarenoverzicht): ze staan niet in de balans of de jaarafsluiting.`}
      </p>
      <Loaded from={years}>
        {(list) => (
          <>
            <Section title="Ingelezen jaren">
              <StoredYears years={list} />
            </Section>
            <Loaded from={accounts}>{(chart) => <Reader accounts={chart} years={list} onSaved={years.reload} />}</Loaded>
          </>
        )}
      </Loaded>
    </div>
  );
}
