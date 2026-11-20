import { useState } from "react";
import { formatEuro, formatEuroShort } from "../../shared/money";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { cashOptions, changeFor } from "./cash";

type Props = {
  open: boolean;
  totalCents: number;
  /** The customer has paid; `cashGivenCents` is what was handed over. */
  onPaid(cashGivenCents: number): void;
  onClose(): void;
};

const noteButton =
  "h-16 rounded-2xl border-2 border-green bg-white text-xl font-extrabold text-green-dark select-none active:bg-sand";

/**
 * Paying with cash. First: what does the customer hand over? `Gepast` finishes at once; a banknote shows
 * the change first. Both steps have the same height and keep their one bottom button in the same place,
 * so a double tap on a banknote cannot land on `Klaar`.
 */
export function CashDialog({ open, totalCents, onPaid, onClose }: Props) {
  const [given, setGiven] = useState<number | null>(null);

  const paid = (cashGivenCents: number) => {
    setGiven(null);
    onPaid(cashGivenCents);
  };
  const back = () => {
    setGiven(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={back} dismissable={false} centered title={given === null ? "Contant, te betalen" : "Wisselgeld"}>
      {given === null ? (
        <div className="flex h-72 flex-col text-center">
          <p className="text-6xl font-extrabold tabular-nums">{formatEuro(totalCents)}</p>
          <p className="mt-3 text-lg text-ink/70">Wat geeft de klant?</p>
          <div className="mt-auto grid grid-cols-3 gap-3">
            <button
              type="button"
              className="h-16 rounded-2xl border-2 border-green bg-green text-xl font-extrabold text-white select-none active:bg-green-dark"
              onClick={() => paid(totalCents)}
            >
              Gepast
            </button>
            {cashOptions(totalCents).map((note) => (
              <button key={note} type="button" className={noteButton} onClick={() => setGiven(note)}>
                {formatEuroShort(note)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex h-72 flex-col items-center justify-center text-center">
          <p className="text-7xl font-extrabold tabular-nums">{formatEuro(changeFor(totalCents, given))}</p>
          <p className="mt-4 text-lg text-ink/70">{`Gekregen ${formatEuro(given)}, te betalen ${formatEuro(totalCents)}`}</p>
        </div>
      )}
      <div className="mt-5 flex justify-center">
        {given === null ? (
          <Button size="lg" className="min-w-48" onClick={back}>
            Terug
          </Button>
        ) : (
          <Button variant="primary" size="lg" className="min-w-48" onClick={() => paid(given)}>
            Klaar
          </Button>
        )}
      </div>
    </Dialog>
  );
}
