const NOTES = [500, 1000, 2000, 5000];

/** The banknotes a customer could pay this amount with: those worth more than the amount. */
export function cashOptions(totalCents: number): number[] {
  return NOTES.filter((note) => note > totalCents);
}

export function changeFor(totalCents: number, givenCents: number): number {
  return givenCents - totalCents;
}
