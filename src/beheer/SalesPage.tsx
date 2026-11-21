import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { formatEuro } from "../../shared/money";
import type { AdminPinAttempt, AdminSale } from "../../shared/types";
import type { ApiResult } from "../lib/api";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { useToast } from "../ui/Toast";
import { Loaded, PageTitle, Problem, Section, field, textLink, today } from "./parts";
import { useAdminData, useAdminWrite } from "./useAdmin";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The server asks for a reason of at least this many characters.
const MIN_REASON = 3;

const badge = "rounded-full px-3 py-0.5 text-sm font-semibold";

function explain(answer: Extract<ApiResult<unknown>, { ok: false }>): string {
  if (answer.status === 0) return "Geen verbinding. Probeer het opnieuw.";
  switch (answer.error) {
    case "closed_by_handover":
      return "Deze verkoop zit al in een afdracht en kan niet meer worden teruggedraaid.";
    case "already_reversed":
      return "Deze verkoop is al teruggedraaid.";
    case "reason_required":
      return "Vul een reden in.";
    case "is_reversal":
      return "Een tegenboeking kan niet worden teruggedraaid.";
    case "not_found":
      return "Deze verkoop bestaat niet meer.";
    case "not_paid":
      return "Deze pinbetaling is niet gelukt en kan niet worden teruggedraaid.";
    default:
      return "Terugdraaien is niet gelukt. Probeer het opnieuw.";
  }
}

const canReverse = (sale: AdminSale) => !sale.reversed && sale.reversesSaleId === null;

function SaleCard({ sale, onReverse }: { sale: AdminSale; onReverse(): void }) {
  return (
    <article className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-lg font-bold tabular-nums">{sale.soldAtLocal}</span>
        <span className="text-lg">{sale.method === "cash" ? "Contant" : "Pin"}</span>
        {sale.reversed && <span className={`${badge} bg-sand text-ink`}>Teruggedraaid</span>}
        {sale.reversesSaleId !== null && <span className={`${badge} bg-redbrown text-white`}>Tegenboeking</span>}
        {sale.possiblyDouble && (
          <span className={`${badge} bg-redbrown text-white`} title="Er is contant afgerekend en de pinbetaling is daarna toch gelukt. Draai één van de twee terug.">
            Mogelijk dubbel betaald
          </span>
        )}
        {sale.late && (
          <span className={`${badge} bg-[#F5E7BF] text-[#5E4500]`} title="Kwam binnen nadat het kluisje al was geteld">
            Nagekomen
          </span>
        )}
        <span className="ml-auto text-xl font-bold tabular-nums">{formatEuro(sale.totalCents)}</span>
      </div>
      <ul className={`mt-2 text-lg ${sale.reversed ? "text-ink/60" : ""}`}>
        {sale.lines.map((line, index) => (
          <li key={index} className="flex justify-between gap-4">
            <span>{`${line.qty} × ${line.name}`}</span>
            <span className="tabular-nums">{formatEuro(line.qty * line.unitPriceCents)}</span>
          </li>
        ))}
      </ul>
      {sale.reversalReason && (
        <p className="mt-2 text-ink/70">
          Reden: <span>{sale.reversalReason}</span>
        </p>
      )}
      {canReverse(sale) && (
        <div className="mt-3 flex justify-end">
          <Button onClick={onReverse}>Terugdraaien</Button>
        </div>
      )}
    </article>
  );
}

/** How a pin payment that is not a sale stands. */
function attemptLabel(outcome: AdminPinAttempt["outcome"]): string {
  switch (outcome) {
    case null:
      return "Wacht op bevestiging";
    case "declined":
      return "Geweigerd";
    case "canceled":
      return "Geannuleerd";
    case "expired":
      return "Verlopen";
    case "start_failed":
      return "Niet gestart";
  }
}

/** The pin payments of the day that are not sales: refused, cancelled, expired, never started, or still waiting for Mollie. */
function PinAttempts({ attempts }: { attempts: AdminPinAttempt[] }) {
  return (
    <Section title="Pin: niet gelukt of nog open" note="Deze pinbetalingen tellen niet mee in de omzet.">
      <ul className="flex flex-col px-2 sm:px-3">
        {attempts.map((attempt) => (
          <li key={attempt.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-sand py-3">
            <span className="text-lg font-bold tabular-nums">{attempt.soldAtLocal}</span>
            <span className={`${badge} ${attempt.outcome === null ? "bg-[#F5E7BF] text-[#5E4500]" : "bg-sand text-ink"}`}>{attemptLabel(attempt.outcome)}</span>
            <span className="ml-auto text-lg font-bold tabular-nums">{formatEuro(attempt.totalCents)}</span>
            {attempt.lines.length > 0 && <span className="basis-full text-ink/70">{attempt.lines.map((line) => `${line.qty} × ${line.name}`).join(", ")}</span>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function ReverseForm({ sale, onDone, onStale, onClose }: { sale: AdminSale; onDone(): void; onStale(): void; onClose(): void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const write = useAdminWrite();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const why = reason.trim();
    if (why.length < MIN_REASON) return setError("Vul een reden in.");
    setBusy(true);
    setError(null);
    const answer = await write<{ id: string }>(`/api/admin/sales/${encodeURIComponent(sale.id)}/reverse`, "POST", { reason: why });
    if (answer.ok) return onDone();
    setBusy(false);
    setError(explain(answer));
    // The list on screen is behind: someone else, or the kassa, got there first.
    if (answer.error === "already_reversed" || answer.error === "not_found") onStale();
  };

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <p className="text-lg">
        {`Verkoop van ${sale.soldAtLocal} uur, ${formatEuro(sale.totalCents)} ${sale.method === "cash" ? "contant" : "pin"}. `}
        Er komt een tegenboeking; een bijgehouden voorraad gaat weer omhoog.
      </p>
      {sale.method === "pin" && (
        <div className="rounded-xl bg-[#F5E7BF] p-3 text-lg font-semibold text-[#5E4500]">
          <p>Betaal het bedrag eerst terug in het Mollie-dashboard. De kassa doet dat niet.</p>
          <p>Terugdraaien kan alleen voor het hele bedrag.</p>
        </div>
      )}
      <label className="flex flex-col gap-1 text-lg font-semibold">
        Reden
        <input className={field} aria-required="true" autoFocus maxLength={200} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {error && <Problem>{error}</Problem>}
      <div className="flex justify-end gap-3">
        <Button onClick={onClose}>Annuleren</Button>
        <Button type="submit" variant="danger" disabled={busy}>
          Terugdraaien
        </Button>
      </div>
    </form>
  );
}

/** Every sale of one day, and the way to take one back after the fact. */
export function SalesPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get("datum");
  const date = asked && DATE.test(asked) ? asked : today();
  const list = useAdminData<{ sales: AdminSale[]; pinAttempts: AdminPinAttempt[] }>(`/api/admin/sales?date=${date}`);
  const [reversing, setReversing] = useState<AdminSale | null>(null);
  const toast = useToast();

  return (
    <>
      <PageTitle>Verkopen</PageTitle>
      <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
        <label className="flex flex-col gap-1 font-semibold">
          Datum
          <input
            className={field}
            type="date"
            value={date}
            max={today()}
            onChange={(event) => {
              if (DATE.test(event.target.value)) setParams({ datum: event.target.value });
            }}
          />
        </label>
        <Link className={`${textLink} pb-2`} to={`/beheer/rapporten?dag=${date}`}>
          Bekijk het rapport van deze dag
        </Link>
      </div>

      <Loaded from={list}>
        {({ sales, pinAttempts }) => (
          <>
            {sales.length === 0 && pinAttempts.length === 0 && <p className="mt-6 text-lg text-ink/70">Geen verkopen op deze dag.</p>}
            {sales.length > 0 && (
              <div className="mt-6 flex flex-col gap-3">
                {sales.map((sale) => (
                  <SaleCard key={sale.id} sale={sale} onReverse={() => setReversing(sale)} />
                ))}
              </div>
            )}
            {pinAttempts.length > 0 && <PinAttempts attempts={pinAttempts} />}
          </>
        )}
      </Loaded>

      <Dialog open={reversing !== null} onClose={() => setReversing(null)} title="Verkoop terugdraaien">
        {reversing && (
          <ReverseForm
            sale={reversing}
            onClose={() => setReversing(null)}
            onStale={list.reload}
            onDone={() => {
              setReversing(null);
              toast.show("Verkoop teruggedraaid");
              list.reload();
            }}
          />
        )}
      </Dialog>
    </>
  );
}
