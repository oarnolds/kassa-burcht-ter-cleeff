import { expect, it } from "vitest";
import { toCsv } from "../worker/lib/csv";

const BOM = String.fromCharCode(0xfeff);

it("writes semicolon-separated lines that Excel opens as they are", () => {
  expect(toCsv([["a", "b"], [1, "c;d"], ['zeg "hoi"', ""]])).toBe(`${BOM}a;b\r\n1;"c;d"\r\n"zeg ""hoi""";\r\n`);
});

it("quotes a field with a line break", () => {
  expect(toCsv([["een\ntwee", "drie"]])).toBe(`${BOM}"een\ntwee";drie\r\n`);
});
