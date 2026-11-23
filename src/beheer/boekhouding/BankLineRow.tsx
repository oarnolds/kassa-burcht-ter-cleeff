import { useState } from "react";
import { Link } from "react-router";
import { readLifeYears } from "../../../shared/asset-paste";
import type { Asset, BankLine, Entry, LedgerAccount } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { formatDateNl } from "../../../shared/time";
import { Button } from "../../ui/Button";
import { Problem, field, textLink } from "../parts";
import { useAdminData } from "../useAdmin";
import { AmountField } from "./AmountField";
import { ASSET_ACCOUNT, AssetPick, NEW_ASSET, assetReady, noAsset, type AssetChoice } from "./AssetPick";
import { AttachmentButton } from "./AttachmentButton";
import { entryRoute, explainWrite, ledgerPath, useLedgerWrites, type SplitPart } from "./ledger-api";
import { useBusy } from "./useBusy";

/** A part of the split; on 0130 it names the toestel it buys. */
type SplitRow = { accountCode: string; cents: number | null; choice: AssetChoice };

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
  const [choice, setChoice] = useState<AssetChoice>(noAsset);
  const [rows, setRows] = useState<SplitRow[] | null>(null);
  // The toestellen, only once a part of the line is on 0130.
  const needsAssets = rows === null ? code === ASSET_ACCOUNT : rows.some((row) => row.accountCode === ASSET_ACCOUNT);
  const assets = useAdminData<Asset[]>(needsAssets ? ledgerPath.assets : null);
  const [unreadable, setUnreadable] = useState<Set<number>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // The other side of the line: the money that went out is debited on the account it was spent on.
  const sign = line.amountCents < 0 ? 1 : -1;
  const total = Math.abs(line.amountCents);
  const sum = rows?.reduce((all, row) => all + (row.cents ?? 0), 0) ?? 0;
  const off = total - sum;
  const rowsReady =
    rows !== null &&
    off === 0 &&
    unreadable.size === 0 &&
    rows.every((row) => row.accountCode !== "" && row.cents !== null && row.cents > 0 && (row.accountCode !== ASSET_ACCOUNT || assetReady(row.choice)));
  const ready = rows === null ? code !== "" && (code !== ASSET_ACCOUNT || assetReady(choice)) : rowsReady;

  const mark = (index: number) => (bad: boolean) =>
    setUnreadable((before) => {
      const next = new Set(before);
      if (bad) next.add(index);
      else next.delete(index);
      return next;
    });
  const change = (index: number, part: Partial<SplitRow>) => setRows((before) => before!.map((row, i) => (i === index ? { ...row, ...part } : row)));
  /** `index` -1 is the line booked whole. */
  const changeChoice = (index: number) => (part: Partial<AssetChoice>) =>
    index === -1
      ? setChoice((before) => ({ ...before, ...part }))
      : setRows((before) => before!.map((row, i) => (i === index ? { ...row, choice: { ...row.choice, ...part } } : row)));

  const book = () =>
    run(async () => {
      setProblem(null);
      const parts =
        rows === null
          ? [{ index: -1, accountCode: code, cents: total, choice }]
          : rows.map((row, index) => ({ index, accountCode: row.accountCode, cents: row.cents!, choice: row.choice }));
      const split: SplitPart[] = [];
      for (const part of parts) {
        let assetId = part.accountCode === ASSET_ACCOUNT ? part.choice.asset : "";
        if (assetId === NEW_ASSET) {
          const made = await api.addAsset({ name: part.choice.name.trim(), lifeYears: readLifeYears(part.choice.years)!, residualCents: part.choice.residualCents ?? 0 });
          if (!made.ok) return setProblem(explainWrite(made.status, made.error));
          assetId = made.data.id;
          // Made once: tapped again after a booking that failed, the line is booked on it instead of making another.
          changeChoice(part.index)({ asset: assetId });
          assets.reload();
        }
        split.push({ accountCode: part.accountCode, amountCents: sign * part.cents, ...(assetId ? { assetId } : {}) });
      }
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
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <AccountSelect label="Rekening" value={code} accounts={choices} onChange={setCode} />
                <Button
                  onClick={() => setRows([{ accountCode: code, cents: null, choice }, { accountCode: "", cents: null, choice: noAsset() }])}
                  disabled={busy}
                >
                  Verdelen
                </Button>
              </div>
              {code === ASSET_ACCOUNT && <AssetPick assets={assets.data ?? []} value={choice} onChange={changeChoice(-1)} />}
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
                  {row.accountCode === ASSET_ACCOUNT && (
                    <div className="basis-full">
                      <AssetPick assets={assets.data ?? []} value={row.choice} onChange={changeChoice(index)} suffix={` ${index + 1}`} />
                    </div>
                  )}
                </div>
              ))}
              {off !== 0 && <p className="font-semibold text-redbrown">{`Het verdeelde bedrag klopt niet: verschil ${formatEuro(Math.abs(off))}`}</p>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setRows([...rows, { accountCode: "", cents: null, choice: noAsset() }])}>Rij erbij</Button>
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
          {needsAssets && assets.error && <Problem>{`De toestellen zijn niet geladen. ${assets.error}`}</Problem>}
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
