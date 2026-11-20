import { useState } from "react";
import { formatEuro } from "../../shared/money";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

type Product = { id: string; name: string; priceCents: number };

type Props = {
  /** The product to enter a quantity for; null while the pad is closed. */
  product: Product | null;
  onAdd(qty: number): void;
  onClose(): void;
};

const MAX_DIGITS = 3;
const key = "h-16 rounded-2xl border-2 border-ink/20 bg-cream text-2xl font-bold select-none active:bg-sand";

function Pad({ product, onAdd, onClose }: { product: Product; onAdd(qty: number): void; onClose(): void }) {
  const [digits, setDigits] = useState("");
  const qty = Number(digits || "0");

  const press = (digit: string) =>
    setDigits((current) => (current.length >= MAX_DIGITS || (current === "" && digit === "0") ? current : current + digit));

  return (
    <div className="text-center">
      <p className="text-3xl font-extrabold tabular-nums">{`${qty} × ${formatEuro(product.priceCents)} = ${formatEuro(qty * product.priceCents)}`}</p>
      <div className="mx-auto mt-5 grid w-72 grid-cols-3 gap-2.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button key={digit} type="button" className={key} onClick={() => press(digit)}>
            {digit}
          </button>
        ))}
        <button type="button" aria-label="Wis cijfer" className={key} onClick={() => setDigits((current) => current.slice(0, -1))}>
          ⌫
        </button>
        <button type="button" className={key} onClick={() => press("0")}>
          0
        </button>
      </div>
      <div className="mt-5 flex justify-center gap-3">
        <Button size="lg" onClick={onClose}>
          Annuleren
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => {
            if (qty > 0) onAdd(qty);
            else onClose();
          }}
        >
          Toevoegen
        </Button>
      </div>
    </div>
  );
}

/** A number pad for products that come by the dozen, like statiegeld. At most three digits. */
export function QuantityPad({ product, onAdd, onClose }: Props) {
  return (
    <Dialog open={product !== null} onClose={onClose} dismissable={false} centered title={product ? `${product.name}, hoeveel stuks?` : ""}>
      {product && <Pad product={product} onAdd={onAdd} onClose={onClose} />}
    </Dialog>
  );
}
