import { useReducer, useState, type ReactNode } from "react";
import type { CashSaleInput } from "../../shared/schemas";
import type { Catalog, CatalogProduct } from "../../shared/types";
import { useToast } from "../ui/Toast";
import { cartReducer, cartTotal, emptyCart } from "./cart";
import { CashDialog } from "./CashDialog";
import { ProductGrid } from "./ProductGrid";
import { QuantityPad } from "./QuantityPad";
import { Receipt } from "./Receipt";

type Props = {
  catalog: Catalog;
  /** A finished cash sale. The screen is already empty again when this is called. */
  onSale(sale: CashSaleInput): void;
  /** A short note under a product's price, such as how many are left. */
  tileNote?(productId: string): string | null;
  header?: ReactNode;
  footer?: ReactNode;
};

const payButton = "h-[4.5rem] rounded-2xl border-2 border-green text-2xl font-extrabold select-none disabled:opacity-30";

/** The kassa: every product one tap away on the left, the receipt on the right. */
export function KassaScreen({ catalog, onSale, tileNote, header, footer }: Props) {
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  const [paying, setPaying] = useState(false);
  const [padFor, setPadFor] = useState<CatalogProduct | null>(null);
  const toast = useToast();
  const total = cartTotal(cart);

  const tapProduct = (product: CatalogProduct) => {
    if (product.quantityPad) setPadFor(product);
    else dispatch({ type: "add", product });
  };

  const finish = (cashGivenCents: number) => {
    const sale: CashSaleInput = {
      id: crypto.randomUUID(),
      kind: "sale",
      soldAt: new Date().toISOString(),
      totalCents: total,
      cashGivenCents,
      lines: cart.lines.map((line) => ({ ...line })),
    };
    dispatch({ type: "clear" });
    setPaying(false);
    toast.show("Contant ontvangen", { ms: 1000 });
    onSale(sale);
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
              disabled={total === 0 || paying}
              onClick={() => setPaying(true)}
            >
              Contant
            </button>
            <button type="button" className={`${payButton} bg-green text-white`} disabled title="Pin volgt in fase 2">
              Pin
            </button>
          </div>
        </Receipt>
      </div>
      {footer}
      <CashDialog open={paying} totalCents={total} onPaid={finish} onClose={() => setPaying(false)} />
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
