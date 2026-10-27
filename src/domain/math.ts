/** Deterministic numeric helpers shared by every calculation. */

export type RoundingMode = "nearest" | "floor" | "ceil" | "truncate";

/** Rounds half away from zero for "nearest" so +x.5 and -x.5 behave symmetrically. */
export function roundWith(value: number, mode: RoundingMode): number {
  // Guard against binary floating error like 53.99999999999999 for 54.
  const v = Math.round(value * 1e9) / 1e9;
  let r: number;
  switch (mode) {
    case "floor":
      r = Math.floor(v);
      break;
    case "ceil":
      r = Math.ceil(v);
      break;
    case "truncate":
      r = Math.trunc(v);
      break;
    default:
      r = Math.sign(v) * Math.round(Math.abs(v));
  }
  return r === 0 ? 0 : r; // normalise -0
}

export function sum(xs: number[]): number {
  let t = 0;
  for (const x of xs) t += x;
  return t;
}

export function mean(xs: number[]): number | null {
  return xs.length ? sum(xs) / xs.length : null;
}

export function stdDev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = sum(xs) / xs.length;
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

/** One decimal, used for displayed averages. Never used inside calculations. */
export function fmt1(n: number | null | undefined): string {
  return n == null ? "—" : (Math.round(n * 10) / 10).toFixed(1);
}
export function fmt0(n: number | null | undefined): string {
  return n == null ? "—" : String(Math.round(n));
}
export function fmtPts(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
