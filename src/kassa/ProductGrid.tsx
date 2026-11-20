import type { Catalog, CatalogProduct } from "../../shared/types";
import { formatEuro } from "../../shared/money";
import { tileColors } from "../ui/palette";
import { qtyOf, type Cart } from "./cart";

type Props = {
  catalog: Catalog;
  cart: Cart;
  onTap(product: CatalogProduct): void;
  tileNote?(productId: string): string | null;
};

const INK = "#252628";

/** Every product as a tile, five in a row, coloured by its category. A tile shows how many are on the receipt. */
export function ProductGrid({ catalog, cart, onTap, tileNote }: Props) {
  const colorOf = new Map(catalog.categories.map((category) => [category.id, category.color]));
  return (
    <div className="grid min-h-0 flex-1 auto-rows-[minmax(4.5rem,1fr)] grid-cols-5 gap-2.5 overflow-y-auto p-1.5">
      {catalog.products.map((product) => {
        const colors = tileColors[colorOf.get(product.categoryId) ?? "grey"];
        const qty = qtyOf(cart, product.id);
        const note = tileNote?.(product.id) ?? null;
        return (
          <button
            key={product.id}
            type="button"
            data-product-tile
            onClick={() => onTap(product)}
            style={{ backgroundColor: colors.bg, color: colors.text, borderColor: qty > 0 ? INK : colors.border }}
            className={`relative flex flex-col items-center justify-center gap-0.5 rounded-2xl border-2 px-1.5 py-1 text-center select-none active:scale-95 ${qty > 0 ? "shadow-[inset_0_0_0_2px_#252628]" : ""}`}
          >
            <span className="text-xl leading-tight font-bold">{product.name}</span>
            <span className="text-base opacity-85">{formatEuro(product.priceCents)}</span>
            {note && <span className="text-sm font-semibold">{note}</span>}
            {qty > 0 && (
              <span
                data-testid="tile-qty"
                className="absolute -top-1.5 -right-1.5 flex h-8 min-w-8 items-center justify-center rounded-full bg-ink px-2 text-base font-extrabold text-white"
              >
                {qty}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
