import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { LEDGER_START, type Entry, type LedgerAccount } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { formatDateNl } from "../../../shared/time";
import { Button } from "../../ui/Button";
import { Loaded, PageTitle, Section, count, field, pillLink, today } from "../parts";
import { useAdminData } from "../useAdmin";
import { AmountField } from "./AmountField";
import { EntryForm } from "./EntryForm";
import { GmailSearch } from "./GmailSearch";
import { entryRoute, ledgerPath, useLedgerWrites, type EntryFilter } from "./ledger-api";

const label = "flex flex-col gap-1 font-semibold";
const firstYear = Number(LEDGER_START.slice(0, 4));

/** The value as it was a moment ago, so a request does not go out on every key. */
function useSettled<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

const thisYear = (): number => Math.max(Number(today().slice(0, 4)), firstYear);

/** The years to choose from: the first one of the books up to next year. */
const years = (): number[] => Array.from({ length: thisYear() + 1 - firstYear + 1 }, (_, i) => firstYear + i);

/** What an entry counts for: the sum of its debit lines. */
const amountOf = (entry: Entry): number => entry.lines.reduce((all, line) => all + Math.max(line.amountCents, 0), 0);

function Filters({ accounts, value, onChange }: { accounts: LedgerAccount[]; value: EntryFilter; onChange(next: EntryFilter): void }) {
  return (
    <div className="flex flex-wrap items-end gap-3 px-2 sm:px-3">
      <label className={label}>
        Jaar
        <select className={`${field} w-28`} value={value.year} onChange={(event) => onChange({ ...value, year: Number(event.target.value) })}>
          {years().map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Van
        <input type="date" className={field} value={value.from ?? ""} onChange={(event) => onChange({ ...value, from: event.target.value })} />
      </label>
      <label className={label}>
        Tot
        <input type="date" className={field} value={value.to ?? ""} onChange={(event) => onChange({ ...value, to: event.target.value })} />
      </label>
      <label className={label}>
        Rekening
        <select className={field} value={value.account ?? ""} onChange={(event) => onChange({ ...value, account: event.target.value })}>
          <option value="">Alle rekeningen</option>
          {accounts.map((account) => (
            <option key={account.code} value={account.code}>{`${account.code} ${account.name}`}</option>
          ))}
        </select>
      </label>
      <label className={label}>
        Bedrag
        <AmountField valueCents={value.amountCents ?? null} onChange={(cents) => onChange({ ...value, amountCents: cents ?? undefined })} onUnreadable={() => {}} className="w-32 text-right tabular-nums" />
      </label>
      <label className={`${label} min-w-0 flex-1`}>
        Tekst
        <input type="search" className={field} value={value.text ?? ""} onChange={(event) => onChange({ ...value, text: event.target.value })} />
      </label>
    </div>
  );
}

/** Search the entries of a year, and make a new one. */
export function EntriesPage() {
  const api = useLedgerWrites();
  const navigate = useNavigate();
  const accounts = useAdminData<LedgerAccount[]>(ledgerPath.accounts);
  const [filter, setFilter] = useState<EntryFilter>({ year: thisYear() });
  const settled = useSettled(filter);
  const entries = useAdminData<Entry[]>(ledgerPath.entries(settled));
  const [creating, setCreating] = useState(false);
  // The entry whose "Zoek bijlage" is open; one at a time.
  const [searching, setSearching] = useState<string | null>(null);

  return (
    <div>
      <PageTitle>Boekingen</PageTitle>
      <p className="mt-4">
        <Button onClick={() => setCreating(!creating)}>Nieuwe boeking</Button>
      </p>
      <Loaded from={accounts}>
        {(list) => (
          <>
            {creating && (
              <Section title="Nieuwe boeking">
                <div className="px-2 sm:px-3">
                  <EntryForm
                    accounts={list}
                    onCancel={() => setCreating(false)}
                    onSave={async (body) => {
                      const answer = await api.createEntry(body);
                      if (answer.ok) void navigate(entryRoute(answer.data.id));
                      return answer;
                    }}
                  />
                </div>
              </Section>
            )}
            <Section title="Zoeken">
              <Filters accounts={list} value={filter} onChange={setFilter} />
            </Section>
          </>
        )}
      </Loaded>
      <Loaded from={entries}>
        {(list) => (
          <Section title={`Boekingen ${settled.year}`}>
            {list.length === 0 ? (
              <p className="px-2 text-lg text-ink/70 sm:px-3">Geen boekingen gevonden.</p>
            ) : (
              <ul>
                {/* The Worker sends them oldest first (the jaaroverzicht needs that order); here the newest is on top. */}
                {[...list].reverse().map((entry) => (
                  <li key={entry.id} className="border-t border-sand first:border-t-0">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 sm:px-3">
                      <Link to={entryRoute(entry.id)} className="flex min-h-11 min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1 py-3 active:bg-sand">
                        <span className="w-10 font-semibold tabular-nums">{entry.number}</span>
                        <span className="tabular-nums text-ink/70">{formatDateNl(entry.date)}</span>
                        <span className="min-w-0 flex-1 text-lg">{entry.description}</span>
                        {entry.changed && <span className="rounded-full bg-sand px-3 py-1 text-sm font-semibold">gewijzigd</span>}
                      </Link>
                      {/* Directly left of the amount, as the penningmeester asked: the file, or the way to find it. */}
                      {entry.attachments.length === 1 ? (
                        <a className={pillLink} href={ledgerPath.attachment(entry.attachments[0]!.id)} target="_blank" rel="noopener">
                          Bijlage
                        </a>
                      ) : entry.attachments.length > 1 ? (
                        <Link className={pillLink} to={entryRoute(entry.id)}>
                          {count(entry.attachments.length, "bijlage", "bijlagen")}
                        </Link>
                      ) : (
                        <Button aria-expanded={searching === entry.id} onClick={() => setSearching(searching === entry.id ? null : entry.id)}>
                          Zoek bijlage
                        </Button>
                      )}
                      <strong className="tabular-nums">{formatEuro(amountOf(entry))}</strong>
                    </div>
                    {searching === entry.id && (
                      <GmailSearch
                        entryId={entry.id}
                        onClose={() => setSearching(null)}
                        onAdded={() => {
                          // Only this entry's panel closes: another may have been opened while the file was added.
                          setSearching((open) => (open === entry.id ? null : open));
                          entries.reload();
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </Loaded>
    </div>
  );
}
