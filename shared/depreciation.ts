// Straight-line depreciation, the way e-Boekhouden applied it (spec §12). All amounts are integer cents.

export type DepreciableAsset = {
  purchaseDate: string; // YYYY-MM-DD
  costCents: number;
  residualCents: number;
  lifeYears: number;
  disposedOn: string | null; // YYYY-MM-DD
};

function yearAndMonth(date: string): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

/** Whole cents, halves away from zero. */
function roundCents(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Months of `year` that count: the purchase month and the disposal month count in full. */
function monthsIn(asset: DepreciableAsset, year: number): number {
  const bought = yearAndMonth(asset.purchaseDate);
  if (year < bought.year) return 0;
  const first = year === bought.year ? bought.month : 1;
  let last = 12;
  if (asset.disposedOn) {
    const gone = yearAndMonth(asset.disposedOn);
    if (year > gone.year) return 0;
    if (year === gone.year) last = gone.month;
  }
  return Math.max(0, last - first + 1);
}

/** What to write off in `year`, given what was written off before it. Spec §12. */
export function depreciationFor(asset: DepreciableAsset, year: number, writtenOffBeforeCents: number): number {
  const { costCents, residualCents, lifeYears } = asset;
  if (lifeYears < 1 || costCents < 0 || residualCents > costCents) return 0;
  const annual = roundCents((costCents - residualCents) / lifeYears);
  const amount = roundCents((annual * monthsIn(asset, year)) / 12);
  const left = costCents - residualCents - writtenOffBeforeCents;
  return Math.max(0, Math.min(amount, left));
}
