import { useReducer, useRef, useState, type ReactNode } from "react";
import type { CashSaleInput, SaleLineInput } from "../../shared/schemas";
import type { Catalog, CatalogProduct } from "../../shared/types";
import { useToast } from "../ui/Toast";
import { cartReducer, cartTotal, emptyCart, type Cart } from "./cart";
import { cashSaleFor } from "./cash";
import { CashDialog } from "./CashDialog";
import { PinDialog, type PinView } from "./PinDialog";
import { ProductGrid } from "./ProductGrid";
import { QuantityPad } from "./QuantityPad";
import { Receipt } from "./Receipt";
import type { PinProgress, PinReceipt, PinRun } from "./store/pin";

type Props = {
  catalog: Catalog;
  /** A finished cash sale. The screen is already empty again when this is called. */
  onSale(sale: CashSaleInput): void;
  /** A short note under a product's price, such as how many are left. */
  tileNote?(productId: string): string | null;
  header?: ReactNode;
  footer?: ReactNode;
  /** Pin. Without this prop the Pin button stays off. */
  pin?: {
    /** Why pin cannot be used right now, shown under the pay buttons; null when it can. */
    blocked: string | null;
    start(receipt: PinReceipt, onProgress: (progress: PinProgress) => void): PinRun;
  };
  /** A pin payment went through. The screen is already empty again when this is called. */
  onPinPaid?(receipt: PinReceipt): void;
};

/** What is being paid in cash: the receipt on the screen, or one that was parked a moment ago. */
type CashFor = { totalCents: number; lines: SaleLineInput[]; insteadOfSaleId: string | null; fromCart: boolean };

const payButton = "h-[4.5rem] rounded-2xl border-2 border-green text-2xl font-extrabold select-none disabled:opacity-30";

/** The kassa: every product one tap away on the left, the receipt on the right. */
export function KassaScreen({ catalog, onSale, tileNote, header, footer, pin, onPinPaid }: Props) {
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  const [cashFor, setCashFor] = useState<CashFor | null>(null);
  const [pinning, setPinning] = useState<{ receipt: PinReceipt; view: PinView } | null>(null);
  // The pin payment that is running. A second tap cannot start a second one.
  const running = useRef<PinRun | null>(null);
  // The last pin attempt that did not go through, and the receipt it was for. Cash taken for that same
  // receipt names the attempt, whichever way the beheerder got to the cash dialog.
  const attempt = useRef<{ id: string; cart: Cart } | null>(null);
  const [padFor, setPadFor] = useState<CatalogProduct | null>(null);
  const toast = useToast();
  const total = cartTotal(cart);
  const busy = cashFor !== null || pinning !== null;

  const tapProduct = (product: CatalogProduct) => {
    if (product.quantityPad) setPadFor(product);
    else dispatch({ type: "add", product });
  };

  const finish = (cashGivenCents: number) => {
    if (!cashFor) return;
    const sale = cashSaleFor(cashFor, cashGivenCents, cashFor.insteadOfSaleId);
    if (cashFor.fromCart) dispatch({ type: "clear" });
    setCashFor(null);
    toast.show("Contant ontvangen", { ms: 1000 });
    onSale(sale);
  };

  const cashFromCart = () =>
    setCashFor({
      totalCents: total,
      lines: cart.lines,
      insteadOfSaleId: attempt.current?.cart === cart ? attempt.current.id : null,
      fromCart: true,
    });

  /** Asks the terminal for this receipt and shows the pin window until the payment has an outcome. */
  const startPin = (of: { totalCents: number; lines: SaleLineInput[] }) => {
    if (!pin || running.current) return;
    const receipt: PinReceipt = { id: crypto.randomUUID(), soldAt: new Date().toISOString(), totalCents: of.totalCents, lines: of.lines.map((line) => ({ ...line })) };
    const forCart = cart;
    setPinning({ receipt, view: { step: "waiting", sent: false, testUrl: null, cancelFailed: false } });
    const run = pin.start(receipt, (progress) =>
      // Only the payment on the screen has something to say.
      setPinning((now) => (now?.receipt.id === receipt.id && now.view.step === "waiting" ? { receipt, view: { step: "waiting", ...progress } } : now)),
    );
    running.current = run;
    void run.done.then((end) => {
      running.current = null;
      if (end.kind === "paid") {
        dispatch({ type: "clear" });
        setPinning(null);
        toast.show("Pin betaald", { ms: 1500 });
        onPinPaid?.(receipt);
      } else if (end.kind === "failed") {
        attempt.current = { id: receipt.id, cart: forCart };
        setPinning({ receipt, view: { step: "failed", outcome: end.outcome, reason: end.reason } });
      } else {
        // The receipt is parked: the kassa is free for the next customer at once.
        dispatch({ type: "clear" });
        setPinning({ receipt, view: { step: "unknown" } });
      }
    });
  };

  /** Cash after all, for the receipt the pin window is about. */
  const cashInstead = () => {
    if (!pinning) return;
    const { receipt, view } = pinning;
    setCashFor({ totalCents: receipt.totalCents, lines: receipt.lines, insteadOfSaleId: receipt.id, fromCart: view.step === "failed" });
    setPinning(null);
  };

  return (
    // A wall-mounted touch screen: a double tap must not zoom, a long press must not select text.
    <div className="flex h-full touch-manipulation flex-col select-none">
      {header}
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col p-2">
          <ProductGrid catalog={catalog} cart={cart} onTap={tapProduct} tileNote={tileNote} />
        </main>
        <Receipt
          cart={cart}
          onInc={(productId) => dispatch({ type: "inc", productId })}
          onDec={(productId) => dispatch({ type: "dec", productId })}
          onRemove={(productId) => dispatch({ type: "remove", productId })}
          onClear={() => dispatch({ type: "clear" })}
        >
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className={`${payButton} bg-white text-green-dark active:bg-sand`}
              disabled={total === 0 || busy}
              onClick={cashFromCart}
            >
              Contant
            </button>
            <button
              type="button"
              className={`${payButton} bg-green text-white`}
              disabled={!pin || pin.blocked !== null || total === 0 || busy}
              title={pin?.blocked ?? undefined}
              onClick={() => startPin({ totalCents: total, lines: cart.lines })}
            >
              Pin
            </button>
          </div>
          {pin?.blocked && (
            <p data-testid="pin-blocked" className="mt-2 text-center text-sm font-semibold text-ink/80">
              {pin.blocked}
            </p>
          )}
        </Receipt>
      </div>
      {footer}
      <CashDialog open={cashFor !== null} totalCents={cashFor?.totalCents ?? total} onPaid={finish} onClose={() => setCashFor(null)} />
      {/* After the cash dialog: the shield the pin window leaves behind for a moment lies over the cash dialog
          that "Toch contant" opens, so the second tap of a double tap cannot land on "Gepast". */}
      <PinDialog
        view={pinning?.view ?? null}
        totalCents={pinning?.receipt.totalCents ?? 0}
        onCancel={() => running.current?.cancel()}
        onRetry={() => pinning && startPin(pinning.receipt)}
        onCash={cashInstead}
        onBack={() => setPinning(null)}
        onNext={() => setPinning(null)}
      />
      <QuantityPad
        product={padFor}
        onAdd={(qty) => {
          if (padFor) dispatch({ type: "add", product: padFor, qty });
          setPadFor(null);
        }}
        onClose={() => setPadFor(null)}
      />
    </div>
  );
}
