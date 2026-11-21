import { z } from "zod";

// What the kassa sends to the server. A sale is priced on the iPad, at the price the customer saw.

export const saleLineInput = z.object({
  productId: z.string().min(1).max(100),
  name: z.string().min(1).max(80),
  unitPriceCents: z.number().int().min(0).max(100000),
  qty: z.number().int().min(1).max(999),
});

export const cashSaleInput = z.object({
  id: z.uuid(),
  kind: z.literal("sale"),
  soldAt: z.iso.datetime(),
  totalCents: z.number().int().min(1).max(100000000),
  cashGivenCents: z.number().int().min(0).nullable(),
  lines: z.array(saleLineInput).min(1).max(100),
});

// What the kassa sends to start a pin payment. Mollie takes at most € 10.000 on a terminal.
export const pinSaleInput = z.object({
  id: z.uuid(),
  soldAt: z.iso.datetime(),
  totalCents: z.number().int().min(1).max(1_000_000),
  lines: z.array(saleLineInput).min(1).max(100),
});

export const reversalInput = z.object({
  id: z.uuid(),
  kind: z.literal("reversal"),
  soldAt: z.iso.datetime(),
  reversesSaleId: z.uuid(),
});

export const outboxItem = z.discriminatedUnion("kind", [cashSaleInput, reversalInput]);

export type SaleLineInput = z.infer<typeof saleLineInput>;
export type CashSaleInput = z.infer<typeof cashSaleInput>;
export type PinSaleInput = z.infer<typeof pinSaleInput>;
export type ReversalInput = z.infer<typeof reversalInput>;
export type OutboxItem = z.infer<typeof outboxItem>;
