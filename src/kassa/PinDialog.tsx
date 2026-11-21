import { formatEuro } from "../../shared/money";
import type { PinOutcome } from "../../shared/types";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { pinDetail, pinTitle } from "./pin-text";

/** Where a pin payment stands, as the beheerder sees it. */
export type PinView =
  | { step: "waiting"; sent: boolean; testUrl: string | null; cancelFailed: boolean }
  | { step: "failed"; outcome: Exclude<PinOutcome, "paid">; reason: string | null }
  | { step: "unknown"; why: "lost" | "unsent" | "slow" };

type Props = {
  /** null: no pin payment is going on. */
  view: PinView | null;
  totalCents: number;
  onCancel(): void;
  onRetry(): void;
  onCash(): void;
  onBack(): void;
  onNext(): void;
};

function titleOf(view: PinView | null): string {
  if (view?.step === "failed") return pinTitle(view.outcome);
  if (view?.step === "unknown") return "Uitkomst onbekend";
  return "Pin, te betalen";
}

/**
 * Paying by pin. The window stays until the payment has an outcome: the customer pays at the terminal,
 * the kassa only waits. Every step has the same height with its buttons at the bottom, so that a tap meant
 * for `Annuleren` cannot start anything when the step changes under the finger.
 */
export function PinDialog({ view, totalCents, onCancel, onRetry, onCash, onBack, onNext }: Props) {
  const amount = <p className="text-6xl font-extrabold tabular-nums">{formatEuro(totalCents)}</p>;
  const detail = view?.step === "failed" ? pinDetail(view.reason) : null;
  return (
    <Dialog open={view !== null} onClose={() => {}} dismissable={false} centered title={titleOf(view)}>
      <div className="flex min-h-[25rem] flex-col text-center">
        {view?.step === "waiting" && (
          <>
            {amount}
            <p className="mt-4 text-xl font-semibold">{view.sent ? "Houd pas of telefoon tegen de betaalterminal" : "Betaling wordt gestart…"}</p>
            {view.cancelFailed && <p className="mt-3 text-lg font-semibold text-redbrown">Annuleren lukte niet. Kijk op de betaalterminal.</p>}
            {view.testUrl && (
              <a className="mt-4 text-lg font-semibold text-green-dark underline" href={view.testUrl} target="_blank" rel="noreferrer">
                Test: kies de uitkomst bij Mollie
              </a>
            )}
            <div className="mt-auto flex flex-col gap-3 pt-5">
              <Button size="lg" disabled={!view.sent} onClick={onCancel}>
                Annuleren
              </Button>
            </div>
          </>
        )}
        {view?.step === "failed" && (
          <>
            {amount}
            {detail && <p className="mt-4 text-lg">{detail}</p>}
            <div className="mt-auto flex flex-col gap-3 pt-5">
              <Button variant="primary" size="lg" onClick={onRetry}>
                Opnieuw proberen
              </Button>
              <Button size="lg" onClick={onCash}>
                Toch contant
              </Button>
              <Button size="lg" onClick={onBack}>
                Terug naar de bon
              </Button>
            </div>
          </>
        )}
        {view?.step === "unknown" && (
          <>
            {view.why === "lost" ? (
              <>
                <p className="text-lg">De verbinding viel weg tijdens het pinnen. Kijk op de betaalterminal of de betaling is gelukt.</p>
                <p className="mt-4 text-lg">{`De bon van ${formatEuro(totalCents)} is geparkeerd. Zodra er weer verbinding is, haalt de kassa de uitkomst op.`}</p>
              </>
            ) : (
              <>
                <p className="text-lg">
                  {view.why === "unsent"
                    ? "Mollie reageert niet. Kijk op de betaalterminal of de betaling is gelukt."
                    : "De betaalterminal heeft na 2 minuten nog geen uitkomst. Kijk op de betaalterminal of de betaling is gelukt."}
                </p>
                <p className="mt-4 text-lg">{`De bon van ${formatEuro(totalCents)} is geparkeerd. De kassa haalt de uitkomst vanzelf op.`}</p>
              </>
            )}
            <div className="mt-auto flex flex-col gap-3 pt-5">
              <Button variant="primary" size="lg" onClick={onNext}>
                Volgende klant
              </Button>
              <Button size="lg" onClick={onCash}>
                Toch contant
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
