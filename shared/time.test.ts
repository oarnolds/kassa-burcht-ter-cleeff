import { describe, expect, it } from "vitest";
import { businessDate, formatDateNl, localTime, monthOf, monthRange } from "./time";

describe("businessDate", () => {
  it("follows Amsterdam summer time around midnight", () => {
    expect(businessDate("2026-07-31T21:59:59.000Z")).toBe("2026-07-31"); // 23:59 local
    expect(businessDate("2026-07-31T22:00:00.000Z")).toBe("2026-08-01"); // 00:00 local
  });
  it("follows Amsterdam winter time around midnight", () => {
    expect(businessDate("2026-12-31T22:59:59.000Z")).toBe("2026-12-31"); // 23:59 local
    expect(businessDate("2026-12-31T23:00:00.000Z")).toBe("2027-01-01");
  });
  it("stays on the right day in the nights the clock changes", () => {
    expect(businessDate("2026-03-29T00:30:00.000Z")).toBe("2026-03-29"); // clock goes forward
    expect(businessDate("2026-10-24T22:30:00.000Z")).toBe("2026-10-25"); // clock goes back
  });
});

describe("localTime", () => {
  it("gives the Amsterdam wall-clock time", () => {
    expect(localTime("2026-07-31T21:59:59.000Z")).toBe("23:59");
  });
});

describe("months", () => {
  it("takes the month of a date", () => {
    expect(monthOf("2026-08-01")).toBe("2026-08");
  });
  it("gives the first and last day of a month", () => {
    expect(monthRange("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
  });
  it("knows leap years", () => {
    expect(monthRange("2028-02")).toEqual({ first: "2028-02-01", last: "2028-02-29" });
  });
});

describe("formatDateNl", () => {
  it("writes day-month-year", () => {
    expect(formatDateNl("2026-07-30")).toBe("30-07-2026");
  });
});
