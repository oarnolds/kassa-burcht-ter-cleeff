import type { CashSaleInput, SaleLineInput } from "../../shared/schemas";

const NOTES = [500, 1000, 2000, 5000];

/** The banknotes a customer could pay this amount with: those worth more than the amount. */
export function cashOptions(totalCents: number): number[] {
  return NOTES.filter((note) => note > totalCents);
}

export function changeFor(totalCents: number, givenCents: number): number {
  return givenCents - totalCents;
}

/**
 * The cash sale for a receipt, as it goes to the server. `insteadOfSaleId`: the pin attempt for the same
 * receipt that had not gone through when the beheerder took cash, so that beheer can tell if it did after all.
 */
export function cashSaleFor(receipt: { totalCents: number; lines: SaleLineInput[] }, cashGivenCents: number, insteadOfSaleId: string | null): CashSaleInput {
  return {
    id: crypto.randomUUID(),
    kind: "sale",
    soldAt: new Date().toISOString(),
    totalCents: receipt.totalCents,
    cashGivenCents,
    lines: receipt.lines.map((line) => ({ ...line })),
    ...(insteadOfSaleId === null ? {} : { insteadOfSaleId }),
  };
}
