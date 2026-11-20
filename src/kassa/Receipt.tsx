import { useEffect, useRef, type ReactNode } from "react";
import { formatEuro } from "../../shared/money";
import { cartTotal, type Cart } from "./cart";

type Props = {
  cart: Cart;
  onInc(productId: string): void;
  onDec(productId: string): void;
  onRemove(productId: string): void;
  onClear(): void;
  /** The pay buttons. */
  children: ReactNode;
};

const stepButton = "h-11 w-12 rounded-xl border-2 border-ink/20 bg-cream text-2xl leading-none font-extrabold active:bg-sand";

/** The receipt: what has been tapped, with a way to correct every line, and the total. */
export function Receipt({ cart, onInc, onDec, onRemove, onClear, children }: Props) {
  const list = useRef<HTMLUListElement>(null);
  const count = cart.lines.length;

  // A newly tapped product lands at the bottom: keep it in view.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [count]);

  return (
    <aside aria-label="Bon" className="flex w-[35%] shrink-0 flex-col border-l-2 border-sand bg-white">
      <div className="flex items-center justify-between border-b-2 border-sand px-4 py-2.5">
        <h2 className="text-xl font-bold">Bon</h2>
        <button
          type="button"
          onClick={onClear}
          disabled={count === 0}
          className="min-h-11 rounded-full border-2 border-redbrown bg-white px-4 font-bold text-redbrown active:bg-sand disabled:opacity-30"
        >
          Wis alles
        </button>
      </div>

      {count === 0 ? (
        <p className="flex-1 px-4 pt-12 text-center text-lg text-ink/60">Tik op een product om te beginnen.</p>
      ) : (
        <ul ref={list} className="min-h-0 flex-1 overflow-y-auto px-4">
          {cart.lines.map((line) => (
            <li key={line.productId} aria-label={line.name} className="border-b border-sand py-2.5">
              <div className="flex justify-between gap-3 text-lg font-bold">
                <span>{line.name}</span>
                <span className="whitespace-nowrap tabular-nums">{formatEuro(line.unitPriceCents * line.qty)}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <button type="button" aria-label="Eén minder" className={stepButton} onClick={() => onDec(line.productId)}>
                    −
                  </button>
                  <b className="min-w-10 text-center text-xl tabular-nums">{line.qty}</b>
                  <button type="button" aria-label="Eén meer" className={stepButton} onClick={() => onInc(line.productId)}>
                    +
                  </button>
                </span>
                <button
                  type="button"
                  className="min-h-11 px-2 font-semibold text-redbrown underline"
                  onClick={() => onRemove(line.productId)}
                >
                  Verwijder
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t-2 border-sand px-4 pt-3 pb-4">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-lg text-ink/70">Totaal</span>
          <b data-testid="total" className="text-4xl tabular-nums">
            {formatEuro(cartTotal(cart))}
          </b>
        </div>
        {children}
      </div>
    </aside>
  );
}
