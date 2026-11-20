import { describe, expect, it } from "vitest";
import { outboxItem } from "./schemas";

const ok = {
  id: crypto.randomUUID(),
  kind: "sale",
  soldAt: "2026-07-30T10:00:00.000Z",
  totalCents: 110,
  cashGivenCents: 110,
  lines: [{ productId: "aardbeitje", name: "Aardbeitje", unitPriceCents: 110, qty: 1 }],
};

describe("outboxItem", () => {
  it("accepts a cash sale", () => {
    expect(outboxItem.safeParse(ok).success).toBe(true);
  });
  it("rejects a line with quantity zero", () => {
    expect(outboxItem.safeParse({ ...ok, lines: [{ ...ok.lines[0], qty: 0 }] }).success).toBe(false);
  });
  it("rejects a sale without lines", () => {
    expect(outboxItem.safeParse({ ...ok, lines: [] }).success).toBe(false);
  });
  it("rejects a total of zero", () => {
    expect(outboxItem.safeParse({ ...ok, totalCents: 0 }).success).toBe(false);
  });
  it("rejects an id that is not a uuid", () => {
    expect(outboxItem.safeParse({ ...ok, id: "not-a-uuid" }).success).toBe(false);
  });
  it("accepts a reversal", () => {
    const reversal = { id: crypto.randomUUID(), kind: "reversal", soldAt: ok.soldAt, reversesSaleId: ok.id };
    expect(outboxItem.safeParse(reversal).success).toBe(true);
  });
});
