import { useState } from "react";
import { formatEuro } from "../../shared/money";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

type Props = {
  /** The total of the last cash sale. */
  totalCents: number;
  onReverse(): void;
};

/** Shows the last sale for a while, with a way to take it back when the wrong thing was rung up. */
export function LastSaleBar({ totalCents, onReverse }: Props) {
  const [asking, setAsking] = useState(false);
  const amount = formatEuro(totalCents);
  return (
    <div className="flex shrink-0 items-center gap-3 text-base">
      <span>{`Laatste verkoop: ${amount} contant`}</span>
      <button
        type="button"
        className="min-h-11 rounded-full border-2 border-redbrown bg-white px-4 font-bold text-redbrown active:bg-sand"
        onClick={() => setAsking(true)}
      >
        Terugdraaien
      </button>
      <Dialog open={asking} onClose={() => setAsking(false)} title={`Laatste verkoop van ${amount} terugdraaien?`}>
        <p className="text-lg">Het geld gaat terug naar de klant. De verkoop blijft zichtbaar in de rapporten, met de terugboeking erbij.</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button size="lg" onClick={() => setAsking(false)}>
            Nee
          </Button>
          <Button
            variant="danger"
            size="lg"
            onClick={() => {
              setAsking(false);
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
