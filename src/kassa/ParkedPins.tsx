import { useEffect, useState } from "react";
import { formatEuro } from "../../shared/money";
import { localTime } from "../../shared/time";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { CashDialog } from "./CashDialog";
import type { Parked } from "./store/pin";

type Props = {
  /** The receipts that are parked or failed, oldest first. */
  receipts: Parked[];
  onCash(receipt: Parked, cashGivenCents: number): void;
  /** The beheerder has seen that this payment did not go through. */
  onSeen(id: string): void;
};

const plural = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;
const footerButton = "min-h-11 rounded-full border-2 bg-white px-4 font-bold active:bg-sand";

/**
 * The pin payments the kassa is not done with: those whose outcome is not known yet, and those that did not
 * go through and have not been seen. A button in the footer per kind, and one list behind both. Nothing here
 * opens by itself: the receipt on the screen is never covered.
 */
export function ParkedPins({ receipts, onCash, onSeen }: Props) {
  // The receipts as they were when the list was opened; null while it is closed. A receipt that is dealt
  // with keeps its place, greyed, so that the list does not jump up under a finger: the second tap of a
  // double tap must not land on the next one.
  const [listed, setListed] = useState<Parked[] | null>(null);
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const [cashFor, setCashFor] = useState<Parked | null>(null);

  const waiting = receipts.filter((receipt) => receipt.parked);
  const failed = receipts.filter((receipt) => receipt.failed);
  const now = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const blocks = listed ?? [];
  const unsettled = (id: string) => !seen.has(id) && now.has(id);
  const allDone = listed !== null && blocks.every((block) => !unsettled(block.id));

  useEffect(() => {
    if (allDone) setListed(null);
  }, [allDone]);

  const show = () => {
    setSeen(new Set());
    setListed([...failed, ...waiting]);
  };

  return (
    <>
      {waiting.length > 0 && (
        <button type="button" className={`${footerButton} border-green text-green-dark`} onClick={show}>
          {plural(waiting.length, "pinbetaling wacht op bevestiging", "pinbetalingen wachten op bevestiging")}
        </button>
      )}
      {failed.length > 0 && (
        <button type="button" className={`${footerButton} border-redbrown text-redbrown`} onClick={show}>
          {failed.length === 1 ? `Pinbetaling van ${formatEuro(failed[0]!.totalCents)} niet gelukt` : `${failed.length} pinbetalingen niet gelukt`}
        </button>
      )}
      <CashDialog
        open={cashFor !== null}
        totalCents={cashFor?.totalCents ?? 0}
        onPaid={(cashGivenCents) => {
          if (cashFor) onCash(cashFor, cashGivenCents);
          setCashFor(null);
        }}
        onClose={() => setCashFor(null)}
      />
      {/* After the cash dialog: the shield this list leaves behind for a moment lies over the cash dialog that
          "Toch contant" opens, so the second tap of a double tap cannot land on "Gepast". */}
      <Dialog open={listed !== null} onClose={() => setListed(null)} title="Pinbetalingen" wide>
        <ul className="flex flex-col gap-3">
          {blocks.map((block) => {
            // What the kassa knows of it now. A receipt that is gone has its outcome, or was rung up as cash.
            const receipt = now.get(block.id);
            const state = seen.has(block.id) ? "seen" : !receipt ? "settled" : receipt.failed ? "failed" : "waiting";
            const label = state === "waiting" ? "Wacht op bevestiging" : state === "settled" ? "Afgehandeld" : "Niet gelukt";
            return (
              <li key={block.id} className={`flex items-start justify-between gap-4 rounded-2xl border-2 border-sand p-4 ${unsettled(block.id) ? "" : "opacity-50"}`}>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold tabular-nums">{`${label} · Pin van ${localTime(block.soldAt)} · ${formatEuro(block.totalCents)}`}</h3>
                  <p>{block.lines.map((line) => `${line.qty}× ${line.name}`).join(", ")}</p>
                  {(state === "failed" || state === "seen") && (
                    <p className="text-redbrown">Deze pinbetaling is niet gelukt en is niet geboekt. Staat de klant er nog? Reken dan opnieuw af.</p>
                  )}
                  {state === "waiting" && (
                    <p className="text-ink/70">Kijk op de betaalterminal of de betaling is gelukt. Zodra er verbinding is, haalt de kassa de uitkomst op.</p>
                  )}
                </div>
                {state === "failed" ? (
                  <Button
                    className="shrink-0"
                    onClick={() => {
                      setSeen(new Set(seen).add(block.id));
                      onSeen(block.id);
                    }}
                  >
                    Gezien
                  </Button>
                ) : state === "waiting" && !receipt?.cashTaken ? (
                  <Button
                    className="shrink-0"
                    onClick={() => {
                      setCashFor(block);
                      setListed(null);
                    }}
                  >
                    Toch contant
                  </Button>
                ) : (
                  <span className="flex min-h-11 shrink-0 items-center px-4 font-semibold">{state === "waiting" ? "Contant afgerekend" : state === "seen" ? "Gezien" : ""}</span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-6 flex justify-end">
          <Button size="lg" onClick={() => setListed(null)}>
            Sluiten
          </Button>
        </div>
      </Dialog>
    </>
  );
}
