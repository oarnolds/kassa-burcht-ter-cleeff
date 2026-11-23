import { useState } from "react";
import type { LedgerAccount } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { Button } from "../../ui/Button";
import { Problem, field, today } from "../parts";
import { AmountField } from "./AmountField";
import { explainWrite, type EntryBody } from "./ledger-api";
import { useBusy } from "./useBusy";
import type { ApiResult } from "../../lib/api";

/** `assetId`: the toestel the line belongs to, carried along unseen so an edit keeps it (R32). */
type Row = { accountCode: string; debit: number | null; credit: number | null; note: string; assetId: string | null };

const blank = (): Row => ({ accountCode: "", debit: null, credit: null, note: "", assetId: null });
/** The accounts a line may keep a toestel on. */
const ASSET_ACCOUNTS = ["0130", "0135"];
/** The toestel of a row, while the row is on 0130 or 0135. */
const assetOf = (row: Row): string | null => (row.assetId && ASSET_ACCOUNTS.includes(row.accountCode) ? row.assetId : null);
const amountOf = (row: Row) => (row.debit ?? 0) - (row.credit ?? 0);
const isBlank = (row: Row) => row.accountCode === "" && amountOf(row) === 0 && row.note.trim() === "";
const label = "flex flex-col gap-1 font-semibold";

const rowsOf = (body: EntryBody | undefined): Row[] =>
  body
    ? body.lines.map((line) => ({
        accountCode: line.accountCode,
        debit: line.amountCents > 0 ? line.amountCents : null,
        credit: line.amountCents < 0 ? -line.amountCents : null,
        note: line.note ?? "",
        assetId: line.assetId ?? null,
      }))
    : [blank(), blank()];

/**
 * The form of an entry: date, description and lines. It saves only when debit and credit are equal. A line on 0130
 * or 0135 that belongs to a toestel shows its name (`assetNames`) and keeps it.
 */
export function EntryForm({
  accounts,
  initial,
  assetNames = new Map(),
  explain = explainWrite,
  onSave,
  onCancel,
}: {
  accounts: LedgerAccount[];
  initial?: EntryBody;
  assetNames?: Map<string, string>;
  /** The sentence for a refusal; the page may know better than the general one. */
  explain?: (status: number, error: string) => string;
  onSave(body: EntryBody): Promise<ApiResult<unknown>>;
  onCancel(): void;
}) {
  const [busy, run] = useBusy();
  const [date, setDate] = useState(initial?.date ?? today());
  const [description, setDescription] = useState(initial?.description ?? "");
  const [rows, setRows] = useState<Row[]>(() => rowsOf(initial));
  const [unreadable, setUnreadable] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);

  // A hidden account stays on offer when the entry already uses it.
  const used = new Set(initial?.lines.map((line) => line.accountCode));
  const choices = accounts.filter((account) => !account.hidden || used.has(account.code));
  const filled = rows.filter((row) => !isBlank(row));
  const sum = filled.reduce((all, row) => all + amountOf(row), 0);
  const complete = filled.length >= 2 && filled.every((row) => row.accountCode !== "" && amountOf(row) !== 0);
  const ready = complete && sum === 0 && unreadable.size === 0 && description.trim() !== "" && date !== "";

  const change = (index: number, part: Partial<Row>) => setRows((before) => before.map((row, i) => (i === index ? { ...row, ...part } : row)));
  const mark = (key: string) => (bad: boolean) =>
    setUnreadable((before) => {
      const next = new Set(before);
      if (bad) next.add(key);
      else next.delete(key);
      return next;
    });

  const save = () =>
    run(async () => {
      setProblem(null);
      const answer = await onSave({
        date,
        description: description.trim(),
        lines: filled.map((row) => {
          const assetId = assetOf(row);
          return { accountCode: row.accountCode, amountCents: amountOf(row), note: row.note.trim() || null, ...(assetId ? { assetId } : {}) };
        }),
      });
      if (!answer.ok) setProblem(explain(answer.status, answer.error));
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <label className={label}>
          Datum
          <input type="date" className={field} value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className={`${label} min-w-0 flex-1`}>
          Omschrijving
          <input type="text" maxLength={200} className={field} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const n = index + 1;
          return (
            <li key={index} className="flex flex-wrap items-start gap-2 rounded-xl bg-sand/50 p-2">
              <select aria-label={`Rekening regel ${n}`} className={`${field} min-w-0 max-w-full`} value={row.accountCode} onChange={(event) => change(index, { accountCode: event.target.value })}>
                <option value="">Kies een rekening</option>
                {choices.map((account) => (
                  <option key={account.code} value={account.code}>{`${account.code} ${account.name}`}</option>
                ))}
              </select>
              <AmountField
                label={`Debet regel ${n}`}
                valueCents={row.debit}
                onChange={(cents) => change(index, cents === null ? { debit: null } : { debit: cents, credit: null })}
                onUnreadable={mark(`d${index}`)}
                className="w-28 text-right tabular-nums"
              />
              <AmountField
                label={`Credit regel ${n}`}
                valueCents={row.credit}
                onChange={(cents) => change(index, cents === null ? { credit: null } : { credit: cents, debit: null })}
                onUnreadable={mark(`c${index}`)}
                className="w-28 text-right tabular-nums"
              />
              <input
                type="text"
                aria-label={`Notitie regel ${n}`}
                placeholder="Notitie"
                maxLength={200}
                className={`${field} min-w-0 flex-1`}
                value={row.note}
                onChange={(event) => change(index, { note: event.target.value })}
              />
              {assetOf(row) && <span className="basis-full px-1 text-ink/70">{`Toestel: ${assetNames.get(assetOf(row)!) ?? "onbekend"}`}</span>}
              {rows.length > 2 && (
                <Button
                  aria-label={`Regel ${n} weghalen`}
                  onClick={() => {
                    setRows(rows.filter((_, i) => i !== index));
                    setUnreadable(new Set());
                  }}
                >
                  Weghalen
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div>
        <Button onClick={() => setRows([...rows, blank()])}>Regel erbij</Button>
      </div>
      {sum !== 0 && <p className="font-semibold text-redbrown">{`Debet en credit zijn niet gelijk: verschil ${formatEuro(Math.abs(sum))}`}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!ready || busy} onClick={() => void save()}>
          Opslaan
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          Annuleren
        </Button>
      </div>
      {problem && <Problem>{problem}</Problem>}
    </div>
  );
}
