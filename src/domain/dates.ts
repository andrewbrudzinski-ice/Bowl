/** Calendar-day helpers for the plain `YYYY-MM-DD` dates a league uses. Everything is UTC, so daylight saving never shifts a day. */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The earliest and latest years a league date may have. A typo like 0026 or 20260 is far more likely than a real date out there. */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

/** True for a real calendar date (no 2026-02-31) in a sensible year range. */
export function isIsoDate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`: positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
