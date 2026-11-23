import { expect, it } from "vitest";
import type { CamtStatement } from "../../../shared/camt";
import { chunkStatement } from "./bank-file";

const line = (bookingDate: string) => ({ bookingDate, amountCents: 100, description: "x", counterpartyName: null, counterpartyIban: null, bankRef: null });
const statement = (lines: ReturnType<typeof line>[]): CamtStatement => ({
  account: "NL00INGB0000000000",
  opening: { date: "2027-01-01", cents: 1 },
  closing: { date: "2027-12-31", cents: 2 },
  lines,
});

it("sends a small statement as it is", () => {
  const small = statement([line("2027-01-02")]);
  expect(chunkStatement(small)).toEqual([small]);
});

it("splits a big statement on day boundaries, with the opening first and the closing last", () => {
  const lines = [line("2027-01-01"), line("2027-01-01"), line("2027-01-02"), line("2027-01-02"), line("2027-01-03")];
  const parts = chunkStatement(statement(lines), 3);
  expect(parts.map((part) => part.lines.map((l) => l.bookingDate))).toEqual([["2027-01-01", "2027-01-01"], ["2027-01-02", "2027-01-02", "2027-01-03"]]);
  expect(parts.map((part) => [part.opening !== null, part.closing !== null])).toEqual([[true, false], [false, true]]);
  expect(new Set(parts.map((part) => part.account)).size).toBe(1);
  // no day is in two requests
  const days = parts.map((part) => new Set(part.lines.map((l) => l.bookingDate)));
  expect([...days[0]!].some((day) => days[1]!.has(day))).toBe(false);
});
