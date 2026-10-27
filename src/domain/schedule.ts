import type { Id } from "./types";

export interface ScheduledPair {
  a: Id;
  /** null = bye */
  b: Id | null;
}
export interface ScheduledWeek {
  week: number;
  pairs: ScheduledPair[];
}
export interface GeneratedSchedule {
  weeks: ScheduledWeek[];
  warnings: string[];
  byeCounts: Record<Id, number>;
  /** Number of times each unordered pair meets: min/max across all pairs. */
  meetings: { min: number; max: number };
}

/**
 * Round-robin via the circle method. Odd team counts get a rotating bye. When there are more weeks than
 * one cycle, cycles repeat with home/away (A/B) swapped on alternating cycles.
 * Deterministic: same input → same schedule.
 */
export function generateRoundRobin(teamIds: Id[], weekCount: number, opts: { startWeek?: number } = {}): GeneratedSchedule {
  const warnings: string[] = [];
  const start = opts.startWeek ?? 1;
  if (teamIds.length < 2) {
    return { weeks: [], warnings: ["At least two teams or bowlers are needed to build a schedule."], byeCounts: {}, meetings: { min: 0, max: 0 } };
  }
  if (weekCount < 1) {
    return { weeks: [], warnings: ["The season needs at least one week."], byeCounts: {}, meetings: { min: 0, max: 0 } };
  }
  const ids: (Id | null)[] = [...teamIds];
  if (ids.length % 2 === 1) ids.push(null);
  const n = ids.length;
  const roundsPerCycle = n - 1;
  const cycles: ScheduledPair[][][] = [];
  let ring = [...ids];
  const cycle: ScheduledPair[][] = [];
  for (let r = 0; r < roundsPerCycle; r++) {
    const pairs: ScheduledPair[] = [];
    for (let i = 0; i < n / 2; i++) {
      const x = ring[i];
      const y = ring[n - 1 - i];
      if (x == null && y == null) continue;
      if (x == null) pairs.push({ a: y!, b: null });
      else if (y == null) pairs.push({ a: x, b: null });
      else pairs.push(r % 2 === 0 ? { a: x, b: y } : { a: y, b: x });
    }
    cycle.push(pairs);
    ring = [ring[0], ring[n - 1], ...ring.slice(1, n - 1)];
  }
  cycles.push(cycle);

  const weeks: ScheduledWeek[] = [];
  for (let w = 0; w < weekCount; w++) {
    const c = Math.floor(w / roundsPerCycle);
    const r = w % roundsPerCycle;
    const base = cycle[r];
    const pairs = c % 2 === 1 ? base.map((p) => (p.b == null ? p : { a: p.b, b: p.a })) : base;
    weeks.push({ week: start + w, pairs });
  }

  const byeCounts: Record<Id, number> = {};
  const meet = new Map<string, number>();
  for (const w of weeks)
    for (const p of w.pairs) {
      if (p.b == null) byeCounts[p.a] = (byeCounts[p.a] ?? 0) + 1;
      else {
        const k = [p.a, p.b].sort().join("|");
        meet.set(k, (meet.get(k) ?? 0) + 1);
      }
    }
  const allPairs: string[] = [];
  for (let i = 0; i < teamIds.length; i++) for (let j = i + 1; j < teamIds.length; j++) allPairs.push([teamIds[i], teamIds[j]].sort().join("|"));
  const counts = allPairs.map((k) => meet.get(k) ?? 0);
  const min = Math.min(...counts);
  const maxC = Math.max(...counts);

  if (teamIds.length % 2 === 1) warnings.push(`${teamIds.length} participants is an odd number, so one participant has a bye each week (${weekCount} week(s) → byes are shared as evenly as the calendar allows).`);
  if (weekCount < roundsPerCycle) warnings.push(`A full round robin needs ${roundsPerCycle} weeks; with ${weekCount} week(s) not every participant will meet.`);
  else if (min !== maxC) warnings.push(`The schedule is unbalanced: some pairs meet ${maxC} time(s) and others ${min}. A balanced schedule needs a multiple of ${roundsPerCycle} weeks.`);
  if (teamIds.length % 2 === 1) {
    const byes = teamIds.map((id) => byeCounts[id] ?? 0);
    if (Math.max(...byes) !== Math.min(...byes)) warnings.push("Bye weeks are not shared equally across all participants.");
  }
  return { weeks, warnings, byeCounts, meetings: { min, max: maxC } };
}

export interface BracketPair {
  a: Id;
  b: Id | null; // null = bye (top seeds in non-power-of-two fields)
  seedA: number;
  seedB: number | null;
}

/** Standard single-elimination seeding: 1 vs N, 2 vs N-1 … padded with byes to the next power of two. */
export function firstRoundBracket(seeds: Id[]): BracketPair[] {
  const n = seeds.length;
  if (n < 2) return [];
  let size = 1;
  while (size < n) size *= 2;
  const order = seedOrder(size);
  const pairs: BracketPair[] = [];
  for (let i = 0; i < order.length; i += 2) {
    const s1 = order[i];
    const s2 = order[i + 1];
    const a = seeds[s1 - 1] ?? null;
    const b = seeds[s2 - 1] ?? null;
    if (a == null && b == null) continue;
    if (b == null) pairs.push({ a: a!, b: null, seedA: s1, seedB: null });
    else if (a == null) pairs.push({ a: b, b: null, seedA: s2, seedB: null });
    else pairs.push({ a, b, seedA: s1, seedB: s2 });
  }
  return pairs;
}

function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const next: number[] = [];
    const total = order.length * 2 + 1;
    for (const s of order) next.push(s, total - s);
    order = next;
  }
  return order;
}

/** Pair the surviving participants of a round in bracket order. */
export function nextRoundPairs(survivorsInBracketOrder: Id[]): BracketPair[] {
  const out: BracketPair[] = [];
  for (let i = 0; i < survivorsInBracketOrder.length; i += 2) {
    const a = survivorsInBracketOrder[i];
    const b = survivorsInBracketOrder[i + 1] ?? null;
    out.push({ a, b, seedA: i + 1, seedB: b ? i + 2 : null });
  }
  return out;
}
