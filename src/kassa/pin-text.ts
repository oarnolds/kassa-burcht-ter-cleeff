// What the kassa says about a pin payment that did not go through.

import type { PinOutcome } from "../../shared/types";

const TITLES: Record<Exclude<PinOutcome, "paid">, string> = {
  declined: "Betaling geweigerd",
  canceled: "Betaling geannuleerd",
  expired: "Betaling verlopen",
  start_failed: "Pin starten lukt niet",
};

const TERMINAL_UNREACHABLE = "De betaalterminal is niet bereikbaar. Staat hij aan en heeft hij internet?";
const MOLLIE_REFUSES = "Mollie weigert de betaling te starten. Meld het aan de penningmeester.";
const NOT_SET_UP = "Pin is nog niet ingesteld. Meld het aan de penningmeester.";

// Mollie's own reason codes, and the kassa's.
const DETAILS = new Map<string, string>([
  ["insufficient_funds", "Onvoldoende saldo."],
  ["invalid_pin", "Onjuiste pincode."],
  ["expired_card", "De pas is verlopen."],
  ["terminal_busy", "De betaalterminal is nog bezig met een andere betaling."],
  ["terminal_unreachable", TERMINAL_UNREACHABLE],
  ["terminal_closed", TERMINAL_UNREACHABLE],
  ["unauthorized", "Mollie accepteert de sleutel niet. Meld het aan de penningmeester."],
  ["refused", MOLLIE_REFUSES],
  ["not_found", MOLLIE_REFUSES],
  ["terminal_id_not_found", MOLLIE_REFUSES],
  ["no_terminal", NOT_SET_UP],
  ["pin_not_configured", NOT_SET_UP],
  ["no_answer", "Mollie gaf geen antwoord."],
]);

/** The heading for a payment that did not go through. */
export function pinTitle(outcome: Exclude<PinOutcome, "paid">): string {
  return TITLES[outcome];
}

/** One more sentence when the reason says something the beheerder can act on; otherwise null. */
export function pinDetail(reason: string | null): string | null {
  return reason === null ? null : (DETAILS.get(reason) ?? null);
}
