// Query parameters that name a day or a month.

/** A real calendar day as `YYYY-MM-DD`, or null. */
export function parseDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const moment = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(moment.getTime()) && moment.toISOString().slice(0, 10) === value ? value : null;
}

/** A month as `YYYY-MM`, or null. */
export function parseMonth(value: string | undefined): string | null {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}
