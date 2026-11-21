import { expect, it } from "vitest";
import { pinDetail, pinTitle } from "./pin-text";

it.each([
  ["declined", "Betaling geweigerd"],
  ["canceled", "Betaling geannuleerd"],
  ["expired", "Betaling verlopen"],
  ["start_failed", "Pin starten lukt niet"],
] as const)("names a payment that ended as %s", (outcome, title) => {
  expect(pinTitle(outcome)).toBe(title);
});

it.each([
  ["insufficient_funds", "Onvoldoende saldo."],
  ["invalid_pin", "Onjuiste pincode."],
  ["expired_card", "De pas is verlopen."],
  ["terminal_busy", "De betaalterminal is nog bezig met een andere betaling."],
  ["terminal_unreachable", "De betaalterminal is niet bereikbaar. Staat hij aan en heeft hij internet?"],
  ["terminal_closed", "De betaalterminal is niet bereikbaar. Staat hij aan en heeft hij internet?"],
  ["unauthorized", "Mollie accepteert de sleutel niet. Meld het aan de penningmeester."],
  ["refused", "Mollie weigert de betaling te starten. Meld het aan de penningmeester."],
  ["not_found", "Mollie weigert de betaling te starten. Meld het aan de penningmeester."],
  ["terminal_id_not_found", "Mollie weigert de betaling te starten. Meld het aan de penningmeester."],
  ["no_terminal", "Pin is nog niet ingesteld. Meld het aan de penningmeester."],
  ["pin_not_configured", "Pin is nog niet ingesteld. Meld het aan de penningmeester."],
  ["no_answer", "Mollie gaf geen antwoord."],
])("explains the reason %s", (reason, detail) => {
  expect(pinDetail(reason)).toBe(detail);
});

it("says nothing more about a reason it does not know, or about none", () => {
  expect(pinDetail("iets_nieuws")).toBeNull();
  expect(pinDetail("before_start")).toBeNull();
  expect(pinDetail(null)).toBeNull();
  // A reason is looked up, never run: a name every object has is not a reason.
  expect(pinDetail("constructor")).toBeNull();
  expect(pinDetail("toString")).toBeNull();
});
