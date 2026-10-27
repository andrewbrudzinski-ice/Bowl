import { TIEBREAKER_LABELS, type RuleConfig, type Tiebreaker } from "./config";
import type { SeasonModel } from "./engine";
import { maxMatchupPoints, type MatchupResult } from "./scoring";
import type { Id, Side } from "./types";
import { isOfficial } from "./types";

export type Outcome = "W" | "L" | "T";

export interface Encounter {
  week: number;
  matchupId: Id;
  a: Id;
  b: Id;
  winner: Side | "tie";
}

export interface StandingRow {
  id: Id;
  name: string;
  played: number;
  wins: number;
  losses: number;
  ties: number;
  points: number;
  winPct: number;
  gameWins: number;
  gameLosses: number;
  /** Pins on the configured standings basis (handicap-adjusted or scratch). */
  totalPins: number;
  scratchPins: number;
  gamesBowled: number;
  average: number | null;
  highGame: number | null;
  highSeries: number | null;
  form: Outcome[];
  streak: { type: Outcome | null; count: number };
  remaining: number;
  rank: number;
  pointsBehind: number;
  /** Why this row sits below the row above it. null for first place. */
  reason: string | null;
  /** True when every configured tie-breaker was equal to the row above. */
  fullyTied: boolean;
}

export type Scope = "team" | "bowler";

interface Acc {
  id: Id;
  name: string;
  played: number;
  wins: number;
  losses: number;
  ties: number;
  points: number;
  gameWins: number;
  gameLosses: number;
  totalPins: number;
  scratchPins: number;
  gamesBowled: number;
  highGame: number | null;
  highSeries: number | null;
  seq: { week: number; o: Outcome }[];
  remaining: number;
}

const max = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));

export interface StandingsOptions {
  scope?: Scope;
  /** Only count matchups in weeks <= throughWeek. */
  throughWeek?: number;
  /** Override the season's current tie-breaker config (used for previews). */
  config?: RuleConfig;
}

function nameOf(model: SeasonModel, scope: Scope, id: Id): string {
  return scope === "team" ? (model.teamById.get(id)?.name ?? "Unknown team") : (model.bowlerById.get(id)?.name ?? "Unknown bowler");
}

export function computeStandings(model: SeasonModel, opts: StandingsOptions = {}): { rows: StandingRow[]; encounters: Encounter[] } {
  const scope: Scope = opts.scope ?? "team";
  const through = opts.throughWeek ?? Infinity;
  const refWeek = Math.min(through, model.data.weeks.length ? Math.max(...model.data.weeks.map((w) => w.number)) : 1);
  const cfg = opts.config ?? model.configForWeek(Math.max(1, Math.min(refWeek, model.data.season.regularWeeks)));
  const acc = new Map<Id, Acc>();
  const encounters: Encounter[] = [];
  const get = (id: Id): Acc => {
    let a = acc.get(id);
    if (!a) {
      a = {
        id,
        name: nameOf(model, scope, id),
        played: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        points: 0,
        gameWins: 0,
        gameLosses: 0,
        totalPins: 0,
        scratchPins: 0,
        gamesBowled: 0,
        highGame: null,
        highSeries: null,
        seq: [],
        remaining: 0,
      };
      acc.set(id, a);
    }
    return a;
  };

  // Seed participants so teams with no results still appear.
  if (scope === "team") {
    for (const t of model.data.teams) if (t.active || model.data.matchups.some((m) => m.sideA === t.id || m.sideB === t.id)) get(t.id);
  } else {
    for (const r of model.data.roster) get(r.bowlerId);
  }

  const regularWeek = (n: number) => (model.weekByNumber.get(n)?.phase ?? "regular") === "regular";

  for (const r of model.results) {
    if (!regularWeek(r.weekNumber)) continue;
    const kindMatches = scope === "team" ? r.matchup.kind === "team" : r.matchup.kind === "individual";
    const hasPairs = scope === "bowler" && r.matchup.kind === "team" && r.pairs.length > 0;
    if (!kindMatches && !hasPairs) continue;

    // remaining matchups (not official, within the regular season, and not yet played)
    if (!r.counts && !r.official) {
      if (kindMatches && !r.isBye) {
        get(r.a.participantId).remaining++;
        if (r.b) get(r.b.participantId).remaining++;
      }
      if (hasPairs) for (const p of r.pairs) { get(p.a).remaining++; get(p.b).remaining++; }
      continue;
    }
    if (r.weekNumber > through || !r.counts) continue;

    if (kindMatches) {
      if (r.isBye) {
        const a = get(r.a.participantId);
        a.points += r.a.points;
        continue;
      }
      const b = r.b!;
      const A = get(r.a.participantId);
      const B = get(b.participantId);
      for (const [x, side, opp] of [[A, r.a, b], [B, b, r.a]] as const) {
        x.played++;
        x.points += side.points;
        x.gameWins += side.gameWins;
        x.gameLosses += opp.gameWins;
        const scored = r.games.map((g, i) => ({ g, i })).filter(({ g }) => g.status === "scored");
        for (const { i } of scored) {
          const sg = side.games[i];
          x.totalPins += cfg.standings.pinsBasis === "handicap" ? (sg.adjusted ?? 0) : (sg.scratch ?? 0);
          x.scratchPins += sg.scratch ?? 0;
          x.gamesBowled++;
          const bv = cfg.standings.pinsBasis === "handicap" ? sg.adjusted : sg.scratch;
          x.highGame = max(x.highGame, bv);
        }
        if (scored.length) {
          const ser = cfg.standings.pinsBasis === "handicap" ? side.adjustedSeries : side.scratchSeries;
          x.highSeries = max(x.highSeries, ser);
        }
      }
      const w = r.winner;
      if (w) {
        if (w === "tie") {
          A.ties++; B.ties++;
          A.seq.push({ week: r.weekNumber, o: "T" }); B.seq.push({ week: r.weekNumber, o: "T" });
        } else {
          const win = w === "A" ? A : B;
          const lose = w === "A" ? B : A;
          win.wins++; lose.losses++;
          win.seq.push({ week: r.weekNumber, o: "W" }); lose.seq.push({ week: r.weekNumber, o: "L" });
        }
        encounters.push({ week: r.weekNumber, matchupId: r.matchup.id, a: r.a.participantId, b: b.participantId, winner: w });
      }
    } else if (hasPairs) {
      for (const p of r.pairs) {
        if (!p.complete) continue;
        const A = get(p.a);
        const B = get(p.b);
        A.played++; B.played++;
        A.points += p.pointsA; B.points += p.pointsB;
        A.gameWins += p.winsA; A.gameLosses += p.winsB;
        B.gameWins += p.winsB; B.gameLosses += p.winsA;
        const sumA = p.gamesA.reduce((x, y) => x + y, 0);
        const sumB = p.gamesB.reduce((x, y) => x + y, 0);
        A.totalPins += sumA; B.totalPins += sumB;
        A.gamesBowled += p.gamesA.length; B.gamesBowled += p.gamesB.length;
        A.scratchPins += sumA; B.scratchPins += sumB; // pair games are on the scoring basis
        A.highSeries = max(A.highSeries, sumA); B.highSeries = max(B.highSeries, sumB);
        A.highGame = max(A.highGame, Math.max(...p.gamesA)); B.highGame = max(B.highGame, Math.max(...p.gamesB));
        const w: Side | "tie" = p.pointsA > p.pointsB ? "A" : p.pointsA < p.pointsB ? "B" : "tie";
        if (w === "tie") { A.ties++; B.ties++; A.seq.push({ week: r.weekNumber, o: "T" }); B.seq.push({ week: r.weekNumber, o: "T" }); }
        else {
          const win = w === "A" ? A : B; const lose = w === "A" ? B : A;
          win.wins++; lose.losses++;
          win.seq.push({ week: r.weekNumber, o: "W" }); lose.seq.push({ week: r.weekNumber, o: "L" });
        }
        encounters.push({ week: r.weekNumber, matchupId: r.matchup.id, a: p.a, b: p.b, winner: w });
      }
    }
  }

  const accs = [...acc.values()].filter((a) => scope === "team" || a.played > 0 || a.remaining > 0);
  const valueOf = (a: Acc, c: Exclude<Tiebreaker, "headToHead">): number => {
    switch (c) {
      case "points": return a.points;
      case "wins": return a.wins;
      case "winPct": return a.played ? (a.wins + a.ties / 2) / a.played : 0;
      case "totalPins": return cfg.standings.pinsBasis === "handicap" ? a.totalPins : a.totalPins;
      case "scratchPins": return a.scratchPins;
      case "average": return a.gamesBowled ? a.totalPins / a.gamesBowled : 0;
      case "gameWins": return a.gameWins;
      case "highSeries": return a.highSeries ?? 0;
      case "highGame": return a.highGame ?? 0;
    }
  };

  const reasons = new Map<Id, string>();
  const fullyTied = new Set<Id>();

  const rank = (group: Acc[], criteria: Tiebreaker[]): Acc[] => {
    if (group.length <= 1) return group;
    if (!criteria.length) {
      const sorted = [...group].sort((x, y) => x.name.localeCompare(y.name) || x.id.localeCompare(y.id));
      sorted.forEach((s, i) => {
        if (i > 0) { reasons.set(s.id, "Still level on every tie-breaker — listed alphabetically"); fullyTied.add(s.id); }
      });
      return sorted;
    }
    const [c, ...rest] = criteria;
    let scored: { a: Acc; v: number }[];
    if (c === "headToHead") {
      const ids = new Set(group.map((g) => g.id));
      const score = new Map<Id, { w: number; g: number }>();
      for (const g of group) score.set(g.id, { w: 0, g: 0 });
      for (const e of encounters) {
        if (!ids.has(e.a) || !ids.has(e.b)) continue;
        const sa = score.get(e.a)!; const sb = score.get(e.b)!;
        sa.g++; sb.g++;
        if (e.winner === "A") sa.w++;
        else if (e.winner === "B") sb.w++;
        else { sa.w += 0.5; sb.w += 0.5; }
      }
      scored = group.map((a) => { const s = score.get(a.id)!; return { a, v: s.g ? s.w / s.g : 0 }; });
    } else {
      scored = group.map((a) => ({ a, v: valueOf(a, c) }));
    }
    scored.sort((x, y) => y.v - x.v);
    // partition into equal-value runs
    const out: Acc[] = [];
    let i = 0;
    let first = true;
    while (i < scored.length) {
      let j = i;
      while (j + 1 < scored.length && Math.abs(scored[j + 1].v - scored[i].v) < 1e-9) j++;
      const run = scored.slice(i, j + 1).map((s) => s.a);
      const ranked = rank(run, rest);
      if (!first) {
        const head = ranked[0];
        if (!reasons.has(head.id)) reasons.set(head.id, `Separated by ${TIEBREAKER_LABELS[c].toLowerCase()}`);
      }
      out.push(...ranked);
      first = false;
      i = j + 1;
    }
    return out;
  };

  const ordered = rank(accs, cfg.standings.tiebreakers);
  const leader = ordered[0];
  const rows: StandingRow[] = ordered.map((a, i) => {
    const seq = [...a.seq].sort((x, y) => x.week - y.week).map((s) => s.o);
    let streakType: Outcome | null = null;
    let count = 0;
    for (let k = seq.length - 1; k >= 0; k--) {
      if (streakType == null) { streakType = seq[k]; count = 1; }
      else if (seq[k] === streakType) count++;
      else break;
    }
    let reason: string | null = null;
    if (i > 0) {
      reason = reasons.get(a.id) ?? null;
      const prev = ordered[i - 1];
      // Rank differs by a primary criterion not recorded as a tie-break
      if (!reason) {
        const c0 = cfg.standings.tiebreakers[0];
        reason = c0 === "headToHead" ? "Separated by head-to-head record" : `Fewer ${TIEBREAKER_LABELS[c0 as Tiebreaker].toLowerCase()} than ${prev.name}`;
      }
    }
    return {
      id: a.id,
      name: a.name,
      played: a.played,
      wins: a.wins,
      losses: a.losses,
      ties: a.ties,
      points: a.points,
      winPct: a.played ? (a.wins + a.ties / 2) / a.played : 0,
      gameWins: a.gameWins,
      gameLosses: a.gameLosses,
      totalPins: a.totalPins,
      scratchPins: a.scratchPins,
      gamesBowled: a.gamesBowled,
      average: a.gamesBowled ? a.totalPins / a.gamesBowled : null,
      highGame: a.highGame,
      highSeries: a.highSeries,
      form: seq.slice(-5),
      streak: { type: streakType, count },
      remaining: a.remaining,
      rank: i + 1,
      pointsBehind: leader ? leader.points - a.points : 0,
      reason,
      fullyTied: fullyTied.has(a.id),
    };
  });
  // Rank numbers: tied rows (identical on every criterion) share a rank number.
  for (let i = 1; i < rows.length; i++) if (rows[i].fullyTied) rows[i].rank = rows[i - 1].rank;
  return { rows, encounters };
}

export interface ProgressionPoint {
  week: number;
  ranks: Record<Id, number>;
  points: Record<Id, number>;
}

export function standingsProgression(model: SeasonModel, scope: Scope = "team"): { weeks: ProgressionPoint[]; ids: Id[] } {
  const weeks = [...new Set(model.results.filter((r) => r.counts && !r.isBye).map((r) => r.weekNumber))]
    .filter((w) => (model.weekByNumber.get(w)?.phase ?? "regular") === "regular")
    .sort((a, b) => a - b);
  const out: ProgressionPoint[] = [];
  let ids: Id[] = [];
  for (const w of weeks) {
    const { rows } = computeStandings(model, { scope, throughWeek: w });
    ids = rows.map((r) => r.id);
    out.push({
      week: w,
      ranks: Object.fromEntries(rows.map((r) => [r.id, r.rank])),
      points: Object.fromEntries(rows.map((r) => [r.id, r.points])),
    });
  }
  return { weeks: out, ids };
}

export type PlayoffStatus = "clinched" | "eliminated" | "in" | "out" | "unknown";

export interface PlayoffRow {
  id: Id;
  status: PlayoffStatus;
  /** Best/worst reachable points, when the primary criterion is points. */
  maxPoints: number | null;
  detail: string;
}

/**
 * Playoff race using only guarantees that hold regardless of how remaining matchups finish.
 * Clinch/elimination is only asserted when the first tie-breaker is points or wins, since other
 * primary criteria (pins, averages) can't be bounded from the schedule alone.
 */
export function computePlayoffRace(rows: StandingRow[], cfg: RuleConfig, potential: (id: Id) => number): PlayoffRow[] | null {
  if (!cfg.playoffs.enabled) return null;
  const q = Math.min(cfg.playoffs.qualifiers, rows.length);
  const primary = cfg.standings.tiebreakers[0];
  const boundable = primary === "points" || primary === "wins";
  const cur = (r: StandingRow) => (primary === "points" ? r.points : r.wins);
  const maxOf = (r: StandingRow) => cur(r) + potential(r.id);
  return rows.map((r, i) => {
    const inPosition = i < q;
    if (!boundable) {
      return { id: r.id, status: inPosition ? "in" : "out", maxPoints: null, detail: inPosition ? "Currently in a playoff position" : "Currently outside the playoff line" };
    }
    const threats = rows.filter((o) => o.id !== r.id && maxOf(o) >= cur(r)).length;
    const above = rows.filter((o) => o.id !== r.id && cur(o) > maxOf(r)).length;
    if (threats <= q - 1) {
      return { id: r.id, status: "clinched", maxPoints: maxOf(r), detail: "Clinched: no combination of remaining results can drop them out of the playoff places" };
    }
    if (above >= q) {
      return { id: r.id, status: "eliminated", maxPoints: maxOf(r), detail: `Eliminated: ${above} teams already have more than the most they can reach (${maxOf(r)})` };
    }
    return { id: r.id, status: inPosition ? "in" : "out", maxPoints: maxOf(r), detail: inPosition ? "In a playoff position — not yet clinched" : "Outside the line — still mathematically alive" };
  });
}

/** The most the primary criterion (points or wins) could still grow from unplayed regular-season matchups. */
export function remainingPotential(model: SeasonModel, teamId: Id, cfg: RuleConfig): number {
  const pointsBased = cfg.standings.tiebreakers[0] === "points";
  let total = 0;
  for (const r of model.results) {
    if ((model.weekByNumber.get(r.weekNumber)?.phase ?? "regular") !== "regular") continue;
    if (isOfficial(r.matchup.state)) continue;
    if (r.a.participantId !== teamId && r.b?.participantId !== teamId) continue;
    if (r.isBye) total += pointsBased ? cfg.scoring.byePoints : 0;
    else total += pointsBased ? maxMatchupPoints(cfg) : 1;
  }
  return total;
}

/**
 * Which side advances from a playoff matchup. Level matchups are settled by the configured tiebreak
 * (series winner, then the higher seed — side A is always the higher seed in generated brackets).
 */
export function playoffAdvancer(r: MatchupResult, cfg: RuleConfig): Side | null {
  if (r.isBye) return "A";
  if (!r.official || !r.winner) return null;
  if (r.winner !== "tie") return r.winner;
  if (cfg.playoffs.tiebreak === "series_then_seed" && r.seriesWinner && r.seriesWinner !== "tie") return r.seriesWinner;
  return "A";
}
