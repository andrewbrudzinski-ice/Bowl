import type { SeasonData } from "./engine";
import type { Id, Matchup, Side, Team } from "./types";

/**
 * Rotating partners: the weekly draw and the pairs it produces.
 *
 * A pair has no row of its own. Each drawn match gets a fresh id per side (the matchup's sideA / sideB), and the name, colour and
 * mark shown for that side are built from the bowlers in its lineup (see `pairTeamFor`). Renaming a bowler or swapping a
 * substitute into the lineup therefore changes how the pair is shown everywhere, with nothing to keep in sync.
 *
 * When the bowlers make an odd number of pairs, one pair has nobody to play. It bowls an "extra comparison": its scores are
 * compared with another pair's scores from the same night, and only the extra pair can earn points from it (see `guestLinks`).
 *
 * When there is an odd number of bowlers, one is left without a partner. That bowler plays a 1v1 instead of sitting out: their
 * scores are compared with one bowler's scores from a real match that night, and only the odd bowler can earn points from it. It is
 * stored the same way as an extra comparison, except that side B is the compared bowler's id rather than a pair's.
 */

export interface PartnerHistory {
  /** Times two bowlers have been partners, keyed by `pairKey`. */
  partnered: Map<string, number>;
  /** Times two bowlers have been on opposite sides of a match (or an extra comparison). */
  faced: Map<string, number>;
  /** Weeks a bowler was the odd one out: sat out (an old one-bowler bye matchup) or bowled a 1v1. */
  rests: Map<Id, number>;
  /** Weeks a bowler was on the extra pair. */
  floats: Map<Id, number>;
}

export function emptyHistory(): PartnerHistory {
  return { partnered: new Map(), faced: new Map(), rests: new Map(), floats: new Map() };
}

export function pairKey(a: Id, b: Id): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface DrawnMatch {
  /** The first side's bowlers: a pair, or the odd bowler on their own. */
  a: Id[];
  /** The opposing pair, the single bowler an odd bowler is compared with, or null (an old bye: `a` sat out). */
  b: Id[] | null;
  /**
   * An extra comparison: `a` is the extra pair and `b` is the pair whose scores it is compared with. That pair is also the `a` side
   * of a real match in the same draw, and earns nothing from this one. (With `single`, see below.)
   */
  extra?: boolean;
  /**
   * The odd bowler's 1v1 (always with `extra`): `a` is the odd bowler and `b` is the one bowler, from a real match in the same
   * draw, whose scores they are compared with. Only the odd bowler earns points from it.
   */
  single?: boolean;
}

export interface PartnerDraw {
  /** Head-to-head matches first, then the extra pair's comparison, then the odd bowler's 1v1. Everyone bowls. */
  matches: DrawnMatch[];
}

/** Small seedable generator, so a draw can be reproduced from the seed stored in the audit log. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const count = (m: Map<string, number>, a: Id, b: Id) => m.get(pairKey(a, b)) ?? 0;

/** A random perfect matching of `ids` in which no two partners have been together more than `cap` times, or null if none turns up. */
function pairingWithin(ids: Id[], partnered: Map<string, number>, cap: number, rand: () => number, budget: number): [Id, Id][] | null {
  let nodes = 0;
  const order = shuffled(ids, rand);
  const used = new Set<Id>();
  const out: [Id, Id][] = [];
  const go = (): boolean => {
    const x = order.find((id) => !used.has(id));
    if (x === undefined) return true;
    if (++nodes > budget) return false;
    used.add(x);
    const options = order
      .filter((y) => y !== x && !used.has(y) && count(partnered, x, y) <= cap)
      .sort((p, q) => count(partnered, x, p) - count(partnered, x, q));
    for (const y of options) {
      used.add(y);
      out.push([x, y]);
      if (go()) return true;
      out.pop();
      used.delete(y);
    }
    used.delete(x);
    return false;
  };
  return go() ? out : null;
}

/**
 * Random perfect matching of `ids` into pairs. Finds the matching whose most-repeated partnership is repeated as little as
 * possible: first one where nobody has been partners before, then one where nobody has been partners more than once, and so on.
 * Among matchings with no repeats it prefers one that leaves a clean matching for the following week, because a careless choice
 * can strand the last few weeks with nobody new to pair. Depth-first with a budget, so it stays fast however many bowlers there are.
 */
function bestPairing(ids: Id[], h: PartnerHistory, rand: () => number): [Id, Id][] {
  const budget = 30000;
  let highest = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) highest = Math.max(highest, count(h.partnered, ids[i], ids[j]));

  let first: [Id, Id][] | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = pairingWithin(ids, h.partnered, 0, rand, budget);
    if (!candidate) break;
    first ??= candidate;
    const after = new Map(h.partnered);
    for (const [x, y] of candidate) after.set(pairKey(x, y), count(after, x, y) + 1);
    let anyNew = false;
    for (let i = 0; i < ids.length && !anyNew; i++) for (let j = i + 1; j < ids.length; j++) if (count(after, ids[i], ids[j]) === 0) { anyNew = true; break; }
    if (!anyNew || pairingWithin(ids, after, 0, rand, budget)) return candidate;
  }
  if (first) return first;
  for (let cap = 1; cap <= highest; cap++) {
    const found = pairingWithin(ids, h.partnered, cap, rand, budget);
    if (found) return found;
  }
  // Unreachable for an even count (the last cap always works); keep a valid answer regardless.
  const order = shuffled(ids, rand);
  return Array.from({ length: order.length / 2 }, (_, i) => [order[2 * i], order[2 * i + 1]] as [Id, Id]);
}

/** Random matching of pairs into head-to-head matches, avoiding opponents the bowlers have already faced. */
function bestMatching(pairs: [Id, Id][], h: PartnerHistory, rand: () => number): [[Id, Id], [Id, Id]][] {
  if (!pairs.length) return [];
  const faced = (p: readonly Id[], q: readonly Id[]) => p.reduce((t, x) => t + q.reduce((u, y) => u + count(h.faced, x, y), 0), 0);
  let best: [[Id, Id], [Id, Id]][] = [];
  let bestCost = Infinity;
  const tries = Math.min(200, 30 + pairs.length * 10);
  for (let t = 0; t < tries && bestCost > 0; t++) {
    const order = shuffled(pairs, rand);
    const ms: [[Id, Id], [Id, Id]][] = [];
    for (let i = 0; i < order.length; i += 2) ms.push([order[i], order[i + 1]]);
    for (let improved = true; improved; ) {
      improved = false;
      for (let i = 0; i < ms.length; i++) {
        for (let j = i + 1; j < ms.length; j++) {
          const [a, b] = ms[i];
          const [c, d] = ms[j];
          const now = faced(a, b) ** 2 + faced(c, d) ** 2;
          const opts: [[[Id, Id], [Id, Id]], [[Id, Id], [Id, Id]]][] = [[[a, c], [b, d]], [[a, d], [b, c]]];
          for (const [p, q] of opts) {
            if (faced(p[0], p[1]) ** 2 + faced(q[0], q[1]) ** 2 < now) {
              ms[i] = p;
              ms[j] = q;
              improved = true;
              break;
            }
          }
        }
      }
    }
    const cost = ms.reduce((c, [p, q]) => c + faced(p, q) ** 2, 0);
    if (cost < bestCost) {
      best = ms;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * Draws this week's partners and opponents from the bowlers who are bowling.
 *  - Bowlers are paired at random, but nobody repeats a partner until they have run out of new partners.
 *  - Pairs are matched against each other at random, avoiding bowlers a pair has already faced.
 *  - With an odd number of pairs, the pair that has been the extra pair least often is the extra pair: it is compared with a
 *    random pair from a real match, preferring one it hasn't faced.
 *  - With an odd number of bowlers, one bowler is left without a partner: the one who has been the odd bowler least so far. They
 *    bowl a 1v1 against the scores of one bowler picked at random from a real match, preferring someone they haven't faced.
 * Needs at least four bowlers. The result depends only on the inputs and `rand`.
 */
export function drawPartners(bowlerIds: Id[], history: PartnerHistory, rand: () => number): PartnerDraw {
  const ids = [...new Set(bowlerIds)];
  if (ids.length < 4) throw new Error("A partner draw needs at least four bowlers.");
  let lone: Id | null = null;
  let bowling = ids;
  if (ids.length % 2 === 1) {
    const odd = (id: Id) => history.rests.get(id) ?? 0;
    lone = shuffled(ids, rand).sort((x, y) => odd(x) - odd(y))[0];
    bowling = ids.filter((id) => id !== lone);
  }

  let pairs = bestPairing(bowling, history, rand);
  let extra: [Id, Id] | null = null;
  if (pairs.length % 2 === 1) {
    const floats = (p: [Id, Id]) => (history.floats.get(p[0]) ?? 0) + (history.floats.get(p[1]) ?? 0);
    const least = Math.min(...pairs.map(floats));
    const candidates = pairs.filter((p) => floats(p) === least);
    extra = candidates[Math.floor(rand() * candidates.length)];
    pairs = pairs.filter((p) => p !== extra);
  }

  // Each match is two pairs; which one is "A" is a coin toss. The extra pair is compared with some match's A side.
  const matches: DrawnMatch[] = bestMatching(pairs, history, rand).map(([p, q]) => (rand() < 0.5 ? { a: [...p], b: [...q] } : { a: [...q], b: [...p] }));
  if (extra) {
    const faced = (p: readonly Id[], q: readonly Id[]) => p.reduce((t, x) => t + q.reduce((u, y) => u + count(history.faced, x, y), 0), 0);
    const ex = extra;
    const options = shuffled(matches, rand);
    const target = options.reduce((best, m) => (faced(ex, m.a) + faced(ex, m.b!) < faced(ex, best.a) + faced(ex, best.b!) ? m : best), options[0]);
    // Compare against whichever of the two pairs it has faced less, and make that pair the match's A side.
    if (faced(ex, target.b!) < faced(ex, target.a)) [target.a, target.b] = [target.b!, target.a];
    matches.push({ a: [...ex], b: [...target.a], extra: true });
  }
  if (lone) {
    // The odd bowler bowls a 1v1 against one bowler of a real match (never someone on the extra pair, whose scores are in that
    // comparison): somebody they haven't faced if possible.
    const pool = matches.filter((m) => !m.extra).flatMap((m) => [...m.a, ...m.b!]);
    const facedBy = (y: Id) => count(history.faced, lone!, y);
    const fewest = Math.min(...pool.map(facedBy));
    const candidates = pool.filter((y) => facedBy(y) === fewest);
    matches.push({ a: [lone], b: [candidates[Math.floor(rand() * candidates.length)]], extra: true, single: true });
  }
  return { matches };
}

// ---------------------------------------------------------------------------------------------------------------------

export interface GuestLink {
  /** The real matchup whose scores the extra comparison borrows. */
  ref: Matchup;
  /** Which side of `ref` is the compared pair (or holds the compared bowler). */
  refSide: Side;
  /** A 1v1: the one bowler of that side whose scores are used. Undefined when a whole pair is compared. */
  only?: Id;
}

/**
 * Finds the extra comparisons among a set of matchups, by matchup id. There are two kinds, and neither has scores of its own for
 * side B: they are read from another matchup of the same week.
 *  - A pair's comparison: side B is the id of a pair that plays in another matchup.
 *  - The odd bowler's 1v1: side B is the id of a bowler who is in the lineup of a real match; only that bowler's scores are used.
 */
export function guestLinks(matchups: readonly Matchup[]): Map<Id, GuestLink> {
  const out = new Map<Id, GuestLink>();
  const weeks = new Map<string, Matchup[]>();
  for (const m of matchups) if (m.kind === "team") weeks.set(`${m.seasonId}|${m.weekNumber}`, [...(weeks.get(`${m.seasonId}|${m.weekNumber}`) ?? []), m]);
  for (const ms of weeks.values()) {
    for (const m of ms) {
      if (!m.sideB) continue;
      const ref = ms.find((o) => o.id !== m.id && (o.sideA === m.sideB || o.sideB === m.sideB));
      if (ref) out.set(m.id, { ref, refSide: ref.sideA === m.sideB ? "A" : "B" });
    }
    // A 1v1 compares with a bowler of a real match: not one of the pair comparisons found above, and never another 1v1.
    for (const m of ms) {
      if (!m.sideB || out.has(m.id)) continue;
      const target = m.sideB;
      const ref = ms.find((o) => o.id !== m.id && o.sideB != null && !out.has(o.id) && (o.lineupA.includes(target) || o.lineupB.includes(target)));
      if (ref) out.set(m.id, { ref, refSide: ref.lineupA.includes(target) ? "A" : "B", only: target });
    }
  }
  return out;
}

/** The bowlers an extra comparison borrows its scores from: the compared pair, or the one bowler of a 1v1. */
export function guestLineup(link: GuestLink): Id[] {
  return link.only ? [link.only] : link.refSide === "A" ? link.ref.lineupA : link.ref.lineupB;
}

/** What the season so far says about partners, opponents, rests and extra pairs, ignoring `exceptWeek` (the week being drawn). */
export function partnerHistory(data: Pick<SeasonData, "matchups">, exceptWeek?: number): PartnerHistory {
  const h = emptyHistory();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const guests = guestLinks(data.matchups);
  for (const m of data.matchups) {
    if (m.kind !== "team" || m.weekNumber === exceptWeek) continue;
    const link = guests.get(m.id);
    for (const lineup of link ? [m.lineupA] : [m.lineupA, m.lineupB]) if (lineup.length === 2) bump(h.partnered, pairKey(lineup[0], lineup[1]));
    if (m.sideB == null) for (const id of m.lineupA) h.rests.set(id, (h.rests.get(id) ?? 0) + 1); // sat the week out (an old bye)
    else {
      for (const x of m.lineupA) for (const y of link ? guestLineup(link) : m.lineupB) bump(h.faced, pairKey(x, y));
      // The extra pair counts as floating; the odd bowler of a 1v1 counts as the odd one out.
      if (link) for (const id of m.lineupA) (link.only ? h.rests : h.floats).set(id, ((link.only ? h.rests : h.floats).get(id) ?? 0) + 1);
    }
  }
  return h;
}

/** Mark shown for a pair: the partners' initials ("AS"), or "?" before anyone is in the lineup. */
function initials(names: string[]): string {
  return names.map((n) => n.trim().slice(0, 1).toUpperCase()).join("") || "?";
}

/**
 * How a bowler is named inside a pair: their first name ("Alex & Sam"), or first name and last initial ("Sam C. & Sam P.") when
 * another bowler in the league shares the first name. Short names keep a pair readable on a phone.
 */
export function pairName(name: string, everyone: Iterable<{ name: string }>): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? name;
  if (parts.length < 2) return first;
  let shared = 0;
  for (const b of everyone) if ((b.name.trim().split(/\s+/)[0] ?? "").toLowerCase() === first.toLowerCase()) shared++;
  return shared > 1 ? `${first} ${parts[parts.length - 1].slice(0, 1).toUpperCase()}.` : first;
}

/**
 * The team a drawn side stands for, built from its lineup. Returns null when nobody in the lineup can be found.
 * `bowlers` maps bowler id → display fields for the whole league (needed to tell shared first names apart).
 */
export function pairTeamFor(
  id: Id,
  leagueId: Id,
  lineup: Id[],
  bowlers: Map<Id, { name: string; avatarColor: string }>
): Team | null {
  const members = lineup.map((b) => bowlers.get(b)).filter((b): b is { name: string; avatarColor: string } => !!b);
  if (!members.length) return null;
  const everyone = [...bowlers.values()];
  return {
    id,
    leagueId,
    name: members.map((b) => pairName(b.name, everyone)).join(" & "),
    shortName: initials(members.map((b) => b.name)),
    color: members[0].avatarColor,
    logo: initials(members.map((b) => b.name)),
    active: false,
    isDemo: false,
  };
}
