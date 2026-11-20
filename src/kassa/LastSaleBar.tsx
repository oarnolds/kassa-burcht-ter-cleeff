import { useState } from "react";
import { formatEuro } from "../../shared/money";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

type Props = {
  /** The last cash sale while it can still be taken back, otherwise null. */
  sale: { id: string; totalCents: number } | null;
  onReverse(): void;
};

/**
 * Shows the last sale for a while, with a way to take it back when the wrong thing was rung up.
 * It stays in place when there is nothing to show: the question it asked must be able to swallow
 * the second tap of a double tap after the sale it was about is gone.
 */
export function LastSaleBar({ sale, onReverse }: Props) {
  // The question belongs to one sale: it does not come back for the next one.
  const [askingFor, setAskingFor] = useState<string | null>(null);
  const amount = sale ? formatEuro(sale.totalCents) : "";
  return (
    <div className="flex shrink-0 items-center gap-3 text-base">
      {sale && (
        <>
          <span>{`Laatste verkoop: ${amount} contant`}</span>
          <button
            type="button"
            className="min-h-11 rounded-full border-2 border-redbrown bg-white px-4 font-bold text-redbrown active:bg-sand"
            onClick={() => setAskingFor(sale.id)}
          >
            Terugdraaien
          </button>
        </>
      )}
      <Dialog open={sale !== null && askingFor === sale.id} onClose={() => setAskingFor(null)} title={`Laatste verkoop van ${amount} terugdraaien?`}>
        <p className="text-lg">Het geld gaat terug naar de klant. De verkoop blijft zichtbaar in de rapporten, met de terugboeking erbij.</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="lg" onClick={() => setAskingFor(null)}>
            Nee
          </Button>
          <Button
            variant="danger"
            size="lg"
            onClick={() => {
              setAskingFor(null);
              onReverse();
            }}
          >
            Ja, terugdraaien
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
