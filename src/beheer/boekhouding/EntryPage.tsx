import { useState } from "react";
import { useParams } from "react-router";
import type { Entry, EntryChange, EntryLine, LedgerAccount } from "../../../shared/ledger-types";
import { formatEuro } from "../../../shared/money";
import { businessDate, formatDateNl, localTime } from "../../../shared/time";
import { Button } from "../../ui/Button";
import { Loaded, PageTitle, Problem, Section, textLink } from "../parts";
import { useAdminData } from "../useAdmin";
import { AttachmentButton } from "./AttachmentButton";
import { EntryForm } from "./EntryForm";
import { explainWrite, ledgerPath, useLedgerWrites } from "./ledger-api";
import { useBusy } from "./useBusy";

const linesText = (lines: EntryLine[], names: Map<string, string>): string =>
  lines.map((line) => `${line.accountCode} ${names.get(line.accountCode) ?? ""} ${formatEuro(line.amountCents)}`.replace("  ", " ")).join(", ");

/** One line of the history: when, and what it was before (or the note, for a change that is not an edit). */
function changeText(change: EntryChange, names: Map<string, string>): string {
  const when = `Gewijzigd op ${formatDateNl(businessDate(change.at))} ${localTime(change.at)}`;
  if (change.note) return `${when}: ${change.note}`;
  const before = change.before;
  if (!before) return `${when}.`;
  const parts: string[] = [];
  if (before.date !== change.after.date) parts.push(formatDateNl(before.date));
  if (before.description !== change.after.description) parts.push(before.description);
  parts.push(linesText(before.lines, names));
  return `${when}: eerst ${parts.join(", ")}`;
}

function EntryView({ entry, accounts, history, reload }: { entry: Entry; accounts: LedgerAccount[]; history: EntryChange[]; reload(): void }) {
  const api = useLedgerWrites();
  const [busy, run] = useBusy();
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const names = new Map(accounts.map((account) => [account.code, account.name]));

  const check = (answer: { ok: boolean; status?: number; error?: string }) => {
    if (answer.ok) return reload();
    setProblem(explainWrite(answer.status ?? 0, answer.error ?? ""));
  };
  const empty = () =>
    run(async () => {
      setProblem(null);
      if (!window.confirm(`Boeking ${entry.number} leegmaken? De boeking blijft bestaan met haar geschiedenis.`)) return;
      check(await api.emptyEntry(entry.id));
    });
  const attach = (file: File) =>
    run(async () => {
      setProblem(null);
      check(await api.addAttachment(entry.id, file));
    });
  const hide = (id: string) =>
    run(async () => {
      setProblem(null);
      check(await api.hideAttachment(id));
    });

  return (
    <>
      <PageTitle>{`Boeking ${entry.number}`}</PageTitle>
      <p className="mt-2 text-lg text-ink/70">{`${formatDateNl(entry.date)} · ${entry.description}`}</p>
      {!entry.editable && <p className="mt-2 text-ink/70">Deze boeking kan niet worden aangepast.</p>}
      {editing ? (
        <Section title="Wijzigen">
          <div className="px-2 sm:px-3">
            <EntryForm
              accounts={accounts}
              initial={{ date: entry.date, description: entry.description, lines: entry.lines.map(({ accountCode, amountCents, note }) => ({ accountCode, amountCents, note })) }}
              onCancel={() => setEditing(false)}
              onSave={async (body) => {
                const answer = await api.saveEntry(entry.id, body);
                if (answer.ok) {
                  setEditing(false);
                  reload();
                }
                return answer;
              }}
            />
          </div>
        </Section>
      ) : (
        <Section title="Regels">
          <ul className="px-2 sm:px-3">
            {entry.lines.length === 0 && <li className="text-lg text-ink/70">Deze boeking is leeggemaakt.</li>}
            {entry.lines.map((line, index) => (
              <li key={index} className="flex flex-wrap justify-between gap-x-4 border-t border-sand py-2 first:border-t-0">
                <span className="text-lg">{`${line.accountCode} ${names.get(line.accountCode) ?? ""}`}</span>
                {line.note && <span className="text-ink/70">{line.note}</span>}
                <span className="tabular-nums">{line.amountCents > 0 ? `debet ${formatEuro(line.amountCents)}` : `credit ${formatEuro(-line.amountCents)}`}</span>
              </li>
            ))}
          </ul>
          {entry.editable && (
            <div className="mt-3 flex flex-wrap gap-2 px-2 sm:px-3">
              <Button onClick={() => setEditing(true)} disabled={busy}>
                Wijzigen
              </Button>
              <Button variant="danger" onClick={() => void empty()} disabled={busy}>
                Leegmaken
              </Button>
            </div>
          )}
        </Section>
      )}
      <Section title="Bijlagen">
        <ul className="px-2 sm:px-3">
          {entry.attachments.length === 0 && <li className="text-lg text-ink/70">Nog geen bijlagen.</li>}
          {entry.attachments.map((attachment) => (
            <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-sand py-1 first:border-t-0">
              <a className={`${textLink} inline-flex min-h-11 items-center break-all`} href={ledgerPath.attachment(attachment.id)} target="_blank" rel="noopener noreferrer">
                {attachment.filename}
              </a>
              <Button onClick={() => void hide(attachment.id)} disabled={busy}>
                Verbergen
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3 px-2 sm:px-3">
          <AttachmentButton label="Bijlage toevoegen" onPick={(file) => void attach(file)} disabled={busy} />
        </div>
      </Section>
      {history.length > 0 && (
        <Section title="Geschiedenis">
          <ul className="flex flex-col gap-2 px-2 sm:px-3">
            {history.map((change, index) => (
              <li key={index}>
                <p>{changeText(change, names)}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {problem && (
        <div className="mt-4">
          <Problem>{problem}</Problem>
        </div>
      )}
    </>
  );
}

/** One entry: its lines, changes, history and attachments. */
export function EntryPage() {
  const { id = "" } = useParams();
  const entry = useAdminData<Entry>(ledgerPath.entry(id));
  const history = useAdminData<EntryChange[]>(ledgerPath.history(id));
  const accounts = useAdminData<LedgerAccount[]>(ledgerPath.accounts);
  const reload = () => {
    entry.reload();
    history.reload();
  };
  return (
    <div>
      <Loaded from={entry}>
        {(found) => <Loaded from={accounts}>{(list) => <Loaded from={history}>{(changes) => <EntryView entry={found} accounts={list} history={changes} reload={reload} />}</Loaded>}</Loaded>}
      </Loaded>
    </div>
  );
}
