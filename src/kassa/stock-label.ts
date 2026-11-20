import type { CatalogProduct, OpenOrder } from "../../shared/types";

/**
 * The short note on a tile about what is left. Nothing while there is plenty, or for a product without
 * stock keeping or without a reorder level. The count is the server's stock minus what this kassa sold
 * since; `op?` is a question, because a count can be off.
 */
export function stockLabel(product: CatalogProduct, soldSince: number): string | null {
  if (!product.trackStock || product.stock === null || product.reorderAt === null) return null;
  const left = product.stock - soldSince;
  if (left <= 0) return "op?";
  if (left <= product.reorderAt) return `nog ${left}`;
  return null;
}

/** An order line as the beheerder sees the delivery: `2 dozen + 5 los Aardbeitje (53 stuks)`. */
export function orderLineText(line: OpenOrder["lines"][number]): string {
  const parts: string[] = [];
  if (line.boxes > 0) parts.push(`${line.boxes} ${line.boxes === 1 ? "doos" : "dozen"}`);
  if (line.looseUnits > 0) parts.push(`${line.looseUnits} los`);
  return `${parts.join(" + ")} ${line.name} (${line.units} ${line.units === 1 ? "stuk" : "stuks"})`;
}
