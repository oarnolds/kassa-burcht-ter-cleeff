import { expect, it } from "vitest";
import { secureAddress } from "./secure-address";

it("moves a page opened over plain http to https, keeping where it was going", () => {
  expect(secureAddress("http://kassa.example/")).toBe("https://kassa.example/");
  expect(secureAddress("http://kassa.example/beheer/kluisje?maand=2026-07#top")).toBe("https://kassa.example/beheer/kluisje?maand=2026-07#top");
});

it("leaves a page that is already on https where it is", () => {
  expect(secureAddress("https://kassa.example/beheer")).toBeNull();
});

it("leaves the computer's own addresses alone, where development and the tests run without https", () => {
  for (const address of ["http://localhost:5173/", "http://127.0.0.1:4173/beheer", "http://[::1]:5173/", "http://kassa.localhost:5173/koppelen"]) {
    expect(secureAddress(address), address).toBeNull();
  }
});
