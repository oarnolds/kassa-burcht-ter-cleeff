import { expect, it } from "vitest";
import { missingMonthsText } from "./budget-grid";

const fills = "Regels per maand of per kwartaal vullen dat aan;";

it("says nothing when the source covers the whole year", () => {
  expect(missingMonthsText(1, 12, 2026)).toBeNull();
});

it("says which months after the source's end are missing", () => {
  expect(missingMonthsText(1, 11, 2026)).toBe(`December zit er nog niet in. ${fills} bij 'zoals 2026' blijft december leeg.`);
  expect(missingMonthsText(1, 10, 2026)).toBe(`November en december zitten er nog niet in. ${fills} bij 'zoals 2026' blijven die maanden leeg.`);
  expect(missingMonthsText(1, 6, 2027)).toBe(`Juli tot en met december zitten er nog niet in. ${fills} bij 'zoals 2027' blijven die maanden leeg.`);
});

it("says which months before the source's start are missing too", () => {
  expect(missingMonthsText(3, 11, 2026)).toBe(`Januari, februari en december zitten er nog niet in. ${fills} bij 'zoals 2026' blijven die maanden leeg.`);
  expect(missingMonthsText(2, 12, 2026)).toBe(`Januari zit er nog niet in. ${fills} bij 'zoals 2026' blijft januari leeg.`);
  expect(missingMonthsText(5, 12, 2026)).toBe(`Januari tot en met april zitten er nog niet in. ${fills} bij 'zoals 2026' blijven die maanden leeg.`);
  expect(missingMonthsText(5, 8, 2026)).toBe(
    `Januari tot en met april en september tot en met december zitten er nog niet in. ${fills} bij 'zoals 2026' blijven die maanden leeg.`,
  );
});
