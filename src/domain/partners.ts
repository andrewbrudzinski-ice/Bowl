import type { SeasonData } from "./engine";
import type { Id, Team } from "./types";

/**
 * Rotating partners: the weekly draw and the pair "teams" it produces.
 *
 * A pair has no row of its own. Each drawn match gets a fresh id per side (the matchup's sideA / sideB), and the name, colour and
 * mark shown for that side are built from the bowlers in its lineup (see `pairTeamFor`). Renaming a bowler or swapping a
 * substitute into the lineup therefore changes how the pair is shown everywhere, with nothing to keep in sync.
 */

export interface PartnerHistory {
  /** Times two bowlers have been partners, keyed by `pairKey`. */
  partnered: Map<string, number>;
  /** Times two bowlers have been on opposite sides of a match. */
  faced: Map<string, number>;
  /** Weeks a bowler was drawn but sat out (a bye matchup with only them in it). */
  rests: Map<Id, number>;
}

export function pairKey(a: Id, b: Id): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export interface DrawnMatch {
  /** The first side's bowlers: a pair, or a single bowler who sits the week out (then `b` is null). */
  a: Id[];
  /** The opposing pair, or null when a lone bowler sits out. */
  b: Id[] | null;
}

export interface PartnerDraw {
  /** Head-to-head matches first, then one entry per bowler sitting out. */
  matches: DrawnMatch[];
  /** The bowlers who don't bowl this week. */
  resting: Id[];
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

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const count = (m: Map<string, number>, a: Id, b: Id) => m.get(pairKey(a, b)) ?? 0;

/** What a set of pairs costs: repeated partnerships hurt, and the second repeat hurts far more than the first. */
function partnerCost(pairs: [Id, Id][], h: PartnerHistory): number {
  let c = 0;
  for (const [x, y] of pairs) c += count(h.partnered, x, y) ** 2;
  return c;
}

/** Random perfect matching of `ids` into pairs with as few repeat partners as possible. */
function bestPairing(ids: Id[], h: PartnerHistory, rand: () => number): [Id, Id][] {
  let best: [Id, Id][] = [];
  let bestCost = Infinity;
  const tries = Math.min(300, 40 + ids.length * 10);
  for (let t = 0; t < tries && bestCost > 0; t++) {
    const order = shuffled(ids, rand);
    const pairs: [Id, Id][] = [];
    for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
    // Hill-climb: re-split two pairs whenever that lowers the cost.
    for (let improved = true; improved; ) {
      improved = false;
      for (let i = 0; i < pairs.length; i++) {
        for (let j = i + 1; j < pairs.length; j++) {
          const [a, b] = pairs[i];
          const [c, d] = pairs[j];
          const now = count(h.partnered, a, b) ** 2 + count(h.partnered, c, d) ** 2;
          const opts: [[Id, Id], [Id, Id]][] = [[[a, c], [b, d]], [[a, d], [b, c]]];
          for (const [p, q] of opts) {
            const alt = count(h.partnered, p[0], p[1]) ** 2 + count(h.partnered, q[0], q[1]) ** 2;
            if (alt < now) {
              pairs[i] = p;
              pairs[j] = q;
              improved = true;
              break;
            }
          }
        }
      }
    }
    const cost = partnerCost(pairs, h);
    if (cost < bestCost) {
      best = pairs;
      bestCost = cost;
    }
  }
  return best;
}

/** Random matching of pairs into head-to-head matches, avoiding opponents the bowlers have already faced. */
function bestMatching(pairs: [Id, Id][], h: PartnerHistory, rand: () => number): [[Id, Id], [Id, Id]][] {
  const faced = (p: [Id, Id], q: [Id, Id]) => count(h.faced, p[0], q[0]) + count(h.faced, p[0], q[1]) + count(h.faced, p[1], q[0]) + count(h.faced, p[1], q[1]);
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
 *  - Matches are two pairs against each other, so the number of bowlers who bowl is a multiple of four; whoever is left over
 *    (up to three bowlers) sits out. They are the bowlers who have rested least so far, so sitting out is shared evenly.
 *  - Partners are random but avoid repeating a partnership until the bowlers have run out of new partners.
 *  - Opponents are random but avoid bowlers a pair has already faced.
 * Needs at least four bowlers. The result depends only on the inputs and `rand`.
 */
export function drawPartners(bowlerIds: Id[], history: PartnerHistory, rand: () => number): PartnerDraw {
  const ids = [...new Set(bowlerIds)];
  if (ids.length < 4) throw new Error("A partner draw needs at least four bowlers.");
  const resting = shuffled(ids, rand)
    .sort((x, y) => (history.rests.get(x) ?? 0) - (history.rests.get(y) ?? 0))
    .slice(0, ids.length % 4);
  const bowling = ids.filter((id) => !resting.includes(id));
  const matches: DrawnMatch[] = bestMatching(bestPairing(bowling, history, rand), history, rand).map(([p, q]) => ({ a: [...p], b: [...q] }));
  for (const id of resting) matches.push({ a: [id], b: null });
  return { matches, resting };
}

/** What the season so far says about partners, opponents and rests, ignoring `exceptWeek` (the week being drawn). */
export function partnerHistory(data: Pick<SeasonData, "matchups">, exceptWeek?: number): PartnerHistory {
  const h: PartnerHistory = { partnered: new Map(), faced: new Map(), rests: new Map() };
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const m of data.matchups) {
    if (m.kind !== "team" || m.weekNumber === exceptWeek) continue;
    for (const lineup of [m.lineupA, m.lineupB]) if (lineup.length === 2) bump(h.partnered, pairKey(lineup[0], lineup[1]));
    if (m.sideB == null) for (const id of m.lineupA) h.rests.set(id, (h.rests.get(id) ?? 0) + 1); // sat the week out
    else for (const x of m.lineupA) for (const y of m.lineupB) bump(h.faced, pairKey(x, y));
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
