import { useState, type FormEvent } from "react";
import { formatEuro } from "../../shared/money";
import { businessDate, formatDateNl, localTime } from "../../shared/time";
import type { CashState, Handover } from "../../shared/types";
import { EuroInput } from "../ui/EuroInput";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Card, Loaded, PageTitle, Problem, Section, amount, amountHead, cell, field, head, table, tableScroll } from "./parts";
import { useAdminData, useAdminWrite } from "./useAdmin";

const label = "flex flex-col gap-1 text-lg font-semibold";

function explain(status: number, error: string): string {
  if (status === 0) return "Geen verbinding. Probeer het opnieuw.";
  if (error === "counted_before_last") return "Dit moment ligt voor de vorige afdracht.";
  if (error === "counted_in_future") return "Dit moment ligt in de toekomst.";
  if (error === "already_opened") return "Het beginbedrag is al vastgelegd.";
  return "Vastleggen is niet gelukt. Probeer het opnieuw.";
}

/** This minute on the clock of whoever is looking, in the shape a `datetime-local` field wants. */
function thisMinute(): string {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${two(now.getHours())}:${two(now.getMinutes())}`;
}

/**
 * The moment a `datetime-local` text stands for. A minute on the clock counts up to its end, so a sale made
 * in that minute belongs to the handover, but never later than now.
 */
function momentOf(text: string): string | null {
  const start = new Date(text).getTime();
  if (Number.isNaN(start)) return null;
  const now = Date.now();
  return new Date(start > now ? start : Math.min(start + 59_999, now)).toISOString();
}

const when = (iso: string) => `${formatDateNl(businessDate(iso))} ${localTime(iso)}`;

function meaning(differenceCents: number): string {
  if (differenceCents > 0) return "Er zit minder in dan verwacht.";
  if (differenceCents < 0) return "Er zit meer in dan verwacht.";
  return "Het klopt precies.";
}

type FormProps = { onRecorded(handover: Handover): void; onStale(): void };

type ConfirmProps = { open: boolean; title: string; rows: [string, string][]; busy: boolean; onYes(): void; onClose(): void };

/** What is about to be recorded, read back once: a handover stays as it is. */
function Confirm({ open, title, rows, busy, onYes, onClose }: ConfirmProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-lg">
        {rows.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-ink/70">{name}</dt>
            <dd className="text-right font-bold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-ink/70">Een vastgelegde afdracht kan niet meer worden gewijzigd.</p>
      <div className="mt-6 flex justify-end gap-3">
        <Button onClick={onClose}>Terug</Button>
        <Button variant="primary" disabled={busy} onClick={onYes}>
          Ja, vastleggen
        </Button>
      </div>
    </Dialog>
  );
}

/** The very first record: what is in the cash box when the kassa starts. */
function OpeningForm({ onRecorded, onStale }: FormProps) {
  const [left, setLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const write = useAdminWrite();

  const ask = (event: FormEvent) => {
    event.preventDefault();
    if (left !== null) setAsking(true);
  };

  const record = async () => {
    if (left === null) return;
    setBusy(true);
    setError(null);
    const answer = await write<Handover>("/api/admin/cash/handovers", "POST", {
      kind: "opening",
      countedAt: new Date().toISOString(),
      receivedCents: 0,
      leftCents: left,
      note: null,
    });
    setBusy(false);
    setAsking(false);
    if (answer.ok) return onRecorded(answer.data);
    setError(explain(answer.status, answer.error));
    if (answer.error === "already_opened") onStale();
  };

  return (
    <Section title="Beginbedrag vastleggen" note="Tel wat er nu in het kluisje zit. Vanaf dit bedrag rekent de kassa verder.">
      <form onSubmit={ask} className="flex max-w-md flex-col gap-4 px-2 sm:px-3">
        <label className={label}>
          Bedrag in het kluisje
          <EuroInput valueCents={left} onChange={setLeft} />
        </label>
        {error && <Problem>{error}</Problem>}
        <Button type="submit" variant="primary" disabled={busy || left === null}>
          Vastleggen
        </Button>
      </form>
      <Confirm
        open={asking}
        title="Beginbedrag vastleggen?"
        rows={[["In het kluisje", left === null ? "" : formatEuro(left)]]}
        busy={busy}
        onYes={() => void record()}
        onClose={() => setAsking(false)}
      />
    </Section>
  );
}

/** The monthly handover: when the box was emptied, what came out, what stayed behind as change. */
function HandoverForm({ expectedCents, onRecorded }: FormProps & { expectedCents: number }) {
  const [counted, setCounted] = useState(thisMinute);
  const [received, setReceived] = useState<number | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const write = useAdminWrite();

  // What the page knows now; the server works it out again for the chosen moment.
  const difference = received !== null && left !== null ? expectedCents - received - left : null;
  const complete = difference !== null && momentOf(counted) !== null;

  const ask = (event: FormEvent) => {
    event.preventDefault();
    if (complete) setAsking(true);
  };

  const record = async () => {
    const countedAt = momentOf(counted);
    if (received === null || left === null || countedAt === null) return;
    setBusy(true);
    setError(null);
    const answer = await write<Handover>("/api/admin/cash/handovers", "POST", {
      kind: "handover",
      countedAt,
      receivedCents: received,
      leftCents: left,
      note: note.trim() || null,
    });
    setBusy(false);
    setAsking(false);
    if (answer.ok) return onRecorded(answer.data);
    setError(explain(answer.status, answer.error));
  };

  const emptiedAt = momentOf(counted);

  return (
    <Section title="Afdracht vastleggen">
      <form onSubmit={ask} className="flex max-w-md flex-col gap-4 px-2 sm:px-3">
        <label className={label}>
          Kluisje geleegd op
          <input className={field} type="datetime-local" value={counted} onChange={(event) => setCounted(event.target.value)} />
        </label>
        <label className={label}>
          Ontvangen
          <EuroInput valueCents={received} onChange={setReceived} />
        </label>
        <label className={label}>
          Achtergebleven als wisselgeld
          <EuroInput valueCents={left} onChange={setLeft} />
        </label>
        <label className={label}>
          Toelichting
          <input className={field} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {difference !== null && (
          <p className="text-lg">
            <strong className="tabular-nums">{`Verschil: ${formatEuro(difference)}`}</strong> <span className="text-ink/70">{meaning(difference)}</span>
          </p>
        )}
        {error && <Problem>{error}</Problem>}
        <Button type="submit" variant="primary" disabled={busy || !complete}>
          Afdracht vastleggen
        </Button>
      </form>
      <Confirm
        open={asking}
        title="Afdracht vastleggen?"
        rows={[
          ["Kluisje geleegd op", emptiedAt === null ? "" : when(emptiedAt)],
          ["Ontvangen", received === null ? "" : formatEuro(received)],
          ["Achtergebleven", left === null ? "" : formatEuro(left)],
        ]}
        busy={busy}
        onYes={() => void record()}
        onClose={() => setAsking(false)}
      />
    </Section>
  );
}

function History({ handovers }: { handovers: Handover[] }) {
  return (
    <Section title="Eerdere afdrachten">
      <div className={tableScroll}>
        <table className={table}>
          <thead>
            <tr className="border-b-2 border-sand">
              <th className={head}>Geleegd op</th>
              <th className={amountHead}>Verwacht</th>
              <th className={amountHead}>Ontvangen</th>
              <th className={amountHead}>Achtergebleven</th>
              <th className={amountHead}>Verschil</th>
              <th className={head}>Toelichting</th>
            </tr>
          </thead>
          <tbody>
            {handovers.map((handover) => {
              const opening = handover.kind === "opening";
              return (
                <tr key={handover.id} className="border-b border-sand align-top">
                  <td className={`${cell} whitespace-nowrap`}>{when(handover.countedAt)}</td>
                  <td className={amount}>{opening ? "–" : formatEuro(handover.expectedCents)}</td>
                  <td className={amount}>{opening ? "–" : formatEuro(handover.receivedCents)}</td>
                  <td className={amount}>{formatEuro(handover.leftCents)}</td>
                  <td className={`${amount} ${handover.differenceCents !== 0 ? "font-bold" : ""}`}>{opening ? "–" : formatEuro(handover.differenceCents)}</td>
                  <td className={cell}>{[opening ? "Beginbedrag" : null, handover.note].filter(Boolean).join(": ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function CashBox({ state, reload }: { state: CashState; reload(): void }) {
  const [recorded, setRecorded] = useState<Handover | null>(null);
  // A recorded handover starts the form afresh.
  const [round, setRound] = useState(0);

  const onRecorded = (handover: Handover) => {
    setRecorded(handover);
    setRound((n) => n + 1);
    reload();
  };

  return (
    <>
      <Card className="mt-6">
        <p className="text-lg font-bold">In het kluisje hoort nu</p>
        <p className="text-4xl font-bold tabular-nums">{formatEuro(state.expectedCents)}</p>
      </Card>
      {state.handovers.length === 0 ? (
        <OpeningForm key={round} onRecorded={onRecorded} onStale={reload} />
      ) : (
        <HandoverForm key={round} expectedCents={state.expectedCents} onRecorded={onRecorded} onStale={reload} />
      )}
      {/* Right under the button that was pressed, where the eyes are. */}
      {recorded && (
        <p role="status" className="mt-4 rounded-2xl bg-green-dark p-4 text-lg font-semibold text-white">
          {recorded.kind === "opening" ? "Beginbedrag vastgelegd." : `Vastgelegd. Verschil: ${formatEuro(recorded.differenceCents)}`}
        </p>
      )}
      {state.handovers.length > 0 && <History handovers={state.handovers} />}
    </>
  );
}

/** The cash box: what should be in it, recording a handover, and every handover so far. */
export function CashPage() {
  const cash = useAdminData<CashState>("/api/admin/cash");
  return (
    <>
      <PageTitle>Kluisje</PageTitle>
      <Loaded from={cash}>{(state) => <CashBox state={state} reload={cash.reload} />}</Loaded>
    </>
  );
}
