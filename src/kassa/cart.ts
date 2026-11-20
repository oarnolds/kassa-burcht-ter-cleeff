// The receipt being built on the kassa. A line keeps the name and the price of the moment it was first tapped.

export type CartLine = { productId: string; name: string; unitPriceCents: number; qty: number };
export type Cart = { lines: CartLine[] };

export type CartAction =
  | { type: "add"; product: { id: string; name: string; priceCents: number }; qty?: number }
  | { type: "inc" | "dec" | "remove"; productId: string }
  | { type: "clear" }
  | { type: "restore"; cart: Cart };

export const emptyCart: Cart = { lines: [] };

/** The most pieces on one line; the server accepts no more. */
export const MAX_QTY = 999;

function withQty(cart: Cart, productId: string, change: (qty: number) => number): Cart {
  const lines = cart.lines
    .map((line) => (line.productId === productId ? { ...line, qty: Math.min(MAX_QTY, change(line.qty)) } : line))
    .filter((line) => line.qty > 0);
  return { lines };
}

function add(cart: Cart, line: CartLine): Cart {
  if (line.qty <= 0) return cart;
  if (cart.lines.some((existing) => existing.productId === line.productId)) {
    return withQty(cart, line.productId, (qty) => qty + line.qty);
  }
  return { lines: [...cart.lines, { ...line, qty: Math.min(MAX_QTY, line.qty) }] };
}

export function cartReducer(cart: Cart, action: CartAction): Cart {
  switch (action.type) {
    case "add": {
      const { id, name, priceCents } = action.product;
      return add(cart, { productId: id, name, unitPriceCents: priceCents, qty: action.qty ?? 1 });
    }
    case "inc":
      return withQty(cart, action.productId, (qty) => qty + 1);
    case "dec":
      return withQty(cart, action.productId, (qty) => qty - 1);
    case "remove":
      return withQty(cart, action.productId, () => 0);
    case "clear":
      return emptyCart;
    case "restore":
      // Puts a cleared receipt back. What was tapped since the clearing stays, behind it.
      return cart.lines.reduce(add, action.cart);
  }
}

export function cartTotal(cart: Cart): number {
  return cart.lines.reduce((sum, line) => sum + line.unitPriceCents * line.qty, 0);
}

export function qtyOf(cart: Cart, productId: string): number {
  return cart.lines.find((line) => line.productId === productId)?.qty ?? 0;
}
