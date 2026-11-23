import { useState } from "react";
import { Link } from "react-router";
import type { BankLine, Entry, LedgerAccount } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { formatDateNl } from "../../../shared/time";
import { Button } from "../../ui/Button";
import { Problem, field, textLink } from "../parts";
import { AmountField } from "./AmountField";
import { AttachmentButton } from "./AttachmentButton";
import { entryRoute, explainWrite, useLedgerWrites } from "./ledger-api";
import { useBusy } from "./useBusy";

type SplitRow = { accountCode: string; cents: number | null };

/** What is said after booking when the receipt did not make it. */
export type BookedNotice = { entryId: string; attachmentProblem: string | null };

function AccountSelect({ label, value, accounts, onChange }: { label: string; value: string; accounts: LedgerAccount[]; onChange(code: string): void }) {
  return (
    <select aria-label={label} className={`${field} min-w-0 max-w-full`} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Kies een rekening</option>
      {accounts.map((account) => (
        <option key={account.code} value={account.code}>{`${account.code} ${account.name}`}</option>
      ))}
    </select>
  );
}

/** One line to book: the suggested account and one tap, or a split over more accounts. */
export function BankLineRow({ line, accounts, onBooked }: { line: BankLine; accounts: LedgerAccount[]; onBooked(notice: BookedNotice): void }) {
  const api = useLedgerWrites();
  const [busy, run] = useBusy();
  const choices = accounts.filter((account) => !account.hidden && account.code !== line.accountCode);
  const [code, setCode] = useState(choices.some((account) => account.code === line.suggestion) ? line.suggestion! : "");
  const [rows, setRows] = useState<SplitRow[] | null>(null);
  const [unreadable, setUnreadable] = useState<Set<number>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // The other side of the line: the money that went out is debited on the account it was spent on.
  const sign = line.amountCents < 0 ? 1 : -1;
  const total = Math.abs(line.amountCents);
  const sum = rows?.reduce((all, row) => all + (row.cents ?? 0), 0) ?? 0;
  const off = total - sum;
  const rowsReady = rows !== null && off === 0 && unreadable.size === 0 && rows.every((row) => row.accountCode !== "" && row.cents !== null && row.cents > 0);
  const ready = rows === null ? code !== "" : rowsReady;

  const mark = (index: number) => (bad: boolean) =>
    setUnreadable((before) => {
      const next = new Set(before);
      if (bad) next.add(index);
      else next.delete(index);
      return next;
    });
  const change = (index: number, part: Partial<SplitRow>) => setRows((before) => before!.map((row, i) => (i === index ? { ...row, ...part } : row)));

  const book = () =>
    run(async () => {
      setProblem(null);
      const split =
        rows === null ? [{ accountCode: code, amountCents: sign * total }] : rows.map((row) => ({ accountCode: row.accountCode, amountCents: sign * row.cents! }));
      const answer = await api.bookLine(line.id, split);
      if (!answer.ok) return setProblem(explainWrite(answer.status, answer.error));
      const entry: Entry = answer.data;
      let attachmentProblem: string | null = null;
      if (file) {
        const saved = await api.addAttachment(entry.id, file);
        if (!saved.ok) attachmentProblem = explainWrite(saved.status, saved.error);
      }
      onBooked({ entryId: entry.id, attachmentProblem });
    });

  const closed = line.inClosedYear;
  const waiting = line.status === "waiting";
  return (
    <li aria-label={`${line.counterpartyName ?? line.counterpartyIban ?? "Onbekend"} ${line.description}`} className="flex flex-col gap-3 border-t border-sand px-2 py-3 first:border-t-0 sm:px-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="tabular-nums text-ink/70">{formatDateNl(line.date)}</span>
        <span className="min-w-0 flex-1 text-lg font-semibold">{line.counterpartyName ?? line.counterpartyIban ?? "Onbekend"}</span>
        <strong className={`text-lg tabular-nums ${line.amountCents < 0 ? "text-redbrown" : ""}`}>{formatEuro(line.amountCents)}</strong>
      </div>
      <p className="text-ink/80">{line.description}</p>
      {waiting && <p className="font-semibold text-ink/70">wacht op Mollie</p>}
      {line.note && <p className="font-semibold text-redbrown">{line.note}</p>}
      {closed && <p className="font-semibold text-redbrown">{`valt in afgesloten jaar ${line.date.slice(0, 4)}`}</p>}
      {!closed && (
        <>
          {rows === null ? (
            <div className="flex flex-wrap items-center gap-2">
              <AccountSelect label="Rekening" value={code} accounts={choices} onChange={setCode} />
              <Button onClick={() => setRows([{ accountCode: code, cents: null }, { accountCode: "", cents: null }])} disabled={busy}>
                Verdelen
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((row, index) => (
                <div key={index} className="flex flex-wrap items-start gap-2">
                  <AccountSelect label={`Rekening ${index + 1}`} value={row.accountCode} accounts={choices} onChange={(value) => change(index, { accountCode: value })} />
                  <AmountField
                    label={`Bedrag ${index + 1}`}
                    valueCents={row.cents}
                    onChange={(cents) => change(index, { cents })}
                    onUnreadable={mark(index)}
                    className="w-32 text-right tabular-nums"
                  />
                  {rows.length > 2 && (
                    <Button
                      aria-label={`Rij ${index + 1} weghalen`}
                      onClick={() => {
                        setRows(rows.filter((_, i) => i !== index));
                        setUnreadable(new Set());
                      }}
                    >
                      Weghalen
                    </Button>
                  )}
                </div>
              ))}
              {off !== 0 && <p className="font-semibold text-redbrown">{`Het verdeelde bedrag klopt niet: verschil ${formatEuro(Math.abs(off))}`}</p>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setRows([...rows, { accountCode: "", cents: null }])}>Rij erbij</Button>
                <Button
                  onClick={() => {
                    setRows(null);
                    setUnreadable(new Set());
                  }}
                >
                  Niet verdelen
                </Button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <AttachmentButton label="Bijlage" onPick={setFile} disabled={busy} />
            {file && <span className="min-w-0 break-all">{file.name}</span>}
            <Button variant="primary" className="ml-auto" disabled={!ready || busy} onClick={() => void book()}>
              Boeken
            </Button>
          </div>
          {problem && <Problem>{problem}</Problem>}
        </>
      )}
      {line.entryId && (
        <Link className={textLink} to={entryRoute(line.entryId)}>
          Naar de boeking
        </Link>
      )}
    </li>
  );
}
