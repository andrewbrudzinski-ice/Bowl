import type { SeasonModel } from "./engine";
import { mean, stdDev, sum } from "./math";
import type { BowlerLine, MatchupResult } from "./scoring";
import type { Id, Side } from "./types";

/** One bowler's night in an official matchup, with the context needed for stats. */
export interface NightLine {
  bowlerId: Id;
  week: number;
  matchupId: Id;
  side: Side;
  teamId: Id | null;
  opponentId: Id | null;
  line: BowlerLine;
  /** Only genuinely bowled games (blind scores excluded). */
  games: { game: number; scratch: number; handicap: number; adjusted: number }[];
  scratchSeries: number;
  adjustedSeries: number;
  handicap: number;
  average: number | null;
}

export function collectNights(model: SeasonModel): NightLine[] {
  const out: NightLine[] = [];
  for (const r of model.results) {
    if (!r.official || r.isBye || r.forfeitBy) continue;
    for (const side of [r.a, r.b!]) {
      const opp = side.side === "A" ? r.b! : r.a;
      for (const line of side.lineup) {
        const games = line.games
          .filter((g) => g.kind === "bowled" && g.scratch != null)
          .map((g) => ({ game: g.game, scratch: g.scratch!, handicap: g.handicap, adjusted: g.adjusted! }));
        if (!games.length) continue;
        out.push({
          bowlerId: line.bowlerId,
          week: r.weekNumber,
          matchupId: r.matchup.id,
          side: side.side,
          teamId: r.matchup.kind === "team" ? side.participantId : model.teamOf(line.bowlerId, r.weekNumber),
          opponentId: opp.participantId,
          line,
          games,
          scratchSeries: sum(games.map((g) => g.scratch)),
          adjustedSeries: sum(games.map((g) => g.adjusted)),
          handicap: line.handicap,
          average: line.average,
        });
      }
    }
  }
  return out.sort((a, b) => a.week - b.week);
}

export interface BowlerSeasonStats {
  bowlerId: Id;
  name: string;
  teamId: Id | null;
  isSub: boolean;
  enteringAverage: number | null;
  games: number;
  nights: number;
  pins: number;
  adjustedPins: number;
  average: number | null;
  highGame: { scratch: number; week: number; matchupId: Id } | null;
  highSeries: { scratch: number; week: number; matchupId: Id } | null;
  highGameAdj: { adjusted: number; week: number; matchupId: Id } | null;
  highSeriesAdj: { adjusted: number; week: number; matchupId: Id } | null;
  stdDev: number | null;
  currentHandicap: number | null;
  /** Cumulative average after each week the bowler bowled. */
  progression: { week: number; average: number; games: number }[];
  /** Win/loss/tie of the bowler's own head-to-head pairings (individual formats only). */
  record: { wins: number; losses: number; ties: number } | null;
  nightsLog: NightLine[];
}

export function bowlerSeasonStats(model: SeasonModel, nights: NightLine[] = collectNights(model)): BowlerSeasonStats[] {
  const byBowler = new Map<Id, NightLine[]>();
  for (const n of nights) byBowler.set(n.bowlerId, [...(byBowler.get(n.bowlerId) ?? []), n]);
  const ids = new Set<Id>([...model.data.roster.map((r) => r.bowlerId), ...byBowler.keys()]);
  const nextWeek = Math.max(1, model.lastOfficialWeek + 1);
  const out: BowlerSeasonStats[] = [];
  for (const id of ids) {
    const bowler = model.bowlerById.get(id);
    if (!bowler) continue;
    const ns = byBowler.get(id) ?? [];
    const allGames = ns.flatMap((n) => n.games.map((g) => ({ ...g, week: n.week, matchupId: n.matchupId })));
    const entries = model.data.roster.filter((r) => r.bowlerId === id).sort((a, b) => a.fromWeek - b.fromWeek);
    const latest = entries[entries.length - 1] ?? null;
    const hg = allGames.reduce<(typeof allGames)[number] | null>((m, g) => (!m || g.scratch > m.scratch ? g : m), null);
    const hga = allGames.reduce<(typeof allGames)[number] | null>((m, g) => (!m || g.adjusted > m.adjusted ? g : m), null);
    const hs = ns.reduce<NightLine | null>((m, n) => (!m || n.scratchSeries > m.scratchSeries ? n : m), null);
    const hsa = ns.reduce<NightLine | null>((m, n) => (!m || n.adjustedSeries > m.adjustedSeries ? n : m), null);
    let cumPins = 0;
    let cumGames = 0;
    const progression: BowlerSeasonStats["progression"] = [];
    const weeks = [...new Set(ns.map((n) => n.week))].sort((a, b) => a - b);
    for (const w of weeks) {
      for (const n of ns.filter((x) => x.week === w)) {
        cumPins += n.scratchSeries;
        cumGames += n.games.length;
      }
      progression.push({ week: w, average: cumPins / cumGames, games: cumGames });
    }
    // Individual record (individual matchups, or pairings in "both" format)
    let record: BowlerSeasonStats["record"] = null;
    const cfg0 = model.configForWeek(1);
    if (cfg0.format !== "team") {
      record = { wins: 0, losses: 0, ties: 0 };
      for (const r of model.results) {
        if (!r.official || r.isBye) continue;
        if (r.matchup.kind === "individual") {
          const side = r.matchup.sideA === id ? "A" : r.matchup.sideB === id ? "B" : null;
          if (!side || !r.winner) continue;
          if (r.winner === "tie") record.ties++;
          else if (r.winner === side) record.wins++;
          else record.losses++;
        } else {
          for (const p of r.pairs) {
            if (!p.complete || (p.a !== id && p.b !== id)) continue;
            const mine = p.a === id ? p.pointsA : p.pointsB;
            const theirs = p.a === id ? p.pointsB : p.pointsA;
            if (mine > theirs) record.wins++;
            else if (mine < theirs) record.losses++;
            else record.ties++;
          }
        }
      }
    }
    const hcap = (() => {
      try {
        return model.handicapAt(id, nextWeek).breakdown.handicap;
      } catch {
        return null;
      }
    })();
    out.push({
      bowlerId: id,
      name: bowler.name,
      teamId: latest?.teamId ?? null,
      isSub: latest?.isSub ?? false,
      enteringAverage: latest?.enteringAverage ?? null,
      games: allGames.length,
      nights: ns.length,
      pins: sum(allGames.map((g) => g.scratch)),
      adjustedPins: sum(allGames.map((g) => g.adjusted)),
      average: mean(allGames.map((g) => g.scratch)),
      highGame: hg ? { scratch: hg.scratch, week: hg.week, matchupId: hg.matchupId } : null,
      highSeries: hs ? { scratch: hs.scratchSeries, week: hs.week, matchupId: hs.matchupId } : null,
      highGameAdj: hga ? { adjusted: hga.adjusted, week: hga.week, matchupId: hga.matchupId } : null,
      highSeriesAdj: hsa ? { adjusted: hsa.adjustedSeries, week: hsa.week, matchupId: hsa.matchupId } : null,
      stdDev: stdDev(allGames.map((g) => g.scratch)),
      currentHandicap: hcap,
      progression,
      record,
      nightsLog: ns,
    });
  }
  return out;
}

export interface TeamNight {
  teamId: Id;
  week: number;
  matchupId: Id;
  opponentId: Id | null;
  scratchSeries: number;
  adjustedSeries: number;
  gameScratch: number[];
  gameAdjusted: number[];
  won: boolean | null;
  points: number;
}

export function collectTeamNights(model: SeasonModel): TeamNight[] {
  const out: TeamNight[] = [];
  for (const r of model.results) {
    if (!r.official || r.isBye || r.forfeitBy || r.matchup.kind !== "team" || !r.complete) continue;
    for (const side of [r.a, r.b!]) {
      out.push({
        teamId: side.participantId,
        week: r.weekNumber,
        matchupId: r.matchup.id,
        opponentId: (side.side === "A" ? r.b! : r.a).participantId,
        scratchSeries: side.scratchSeries,
        adjustedSeries: side.adjustedSeries,
        gameScratch: side.games.map((g) => g.scratch ?? 0),
        gameAdjusted: side.games.map((g) => g.adjusted ?? 0),
        won: r.winner === "tie" ? null : r.winner === side.side,
        points: side.points,
      });
    }
  }
  return out;
}

export interface Holder<T = unknown> {
  value: number;
  holders: T[];
}

/** Max with proper tie handling: every entry sharing the top value is returned. */
export function topWithTies<T>(items: T[], score: (t: T) => number | null, dir: "max" | "min" = "max"): Holder<T> | null {
  let best: number | null = null;
  let holders: T[] = [];
  for (const it of items) {
    const v = score(it);
    if (v == null) continue;
    if (best == null || (dir === "max" ? v > best : v < best)) {
      best = v;
      holders = [it];
    } else if (v === best) holders.push(it);
  }
  return best == null ? null : { value: best, holders };
}

export interface ImprovementParams {
  window: number;
  minGames: number;
}

export interface ImprovementResult {
  bowlerId: Id;
  recentAverage: number;
  baselineAverage: number;
  delta: number;
  window: number;
  baselineSource: "earlier games" | "entering average";
  games: number;
}

/**
 * Average of the latest `window` games minus the baseline: the average of the games bowled before them
 * (if at least `window` earlier games exist) else the entering average. A single big game cannot win this
 * on its own because it is diluted across the whole window.
 */
export function improvement(stats: BowlerSeasonStats, params: ImprovementParams): ImprovementResult | null {
  const scores = stats.nightsLog.flatMap((n) => n.games.map((g) => g.scratch));
  const w = params.window;
  if (scores.length < Math.max(params.minGames, w)) return null;
  const recent = scores.slice(-w);
  const earlier = scores.slice(0, -w);
  let baseline: number | null = null;
  let source: ImprovementResult["baselineSource"] = "earlier games";
  if (earlier.length >= w) baseline = mean(earlier);
  else if (stats.enteringAverage != null) {
    baseline = stats.enteringAverage;
    source = "entering average";
  }
  if (baseline == null) return null;
  const recentAverage = mean(recent)!;
  return { bowlerId: stats.bowlerId, recentAverage, baselineAverage: baseline, delta: recentAverage - baseline, window: w, baselineSource: source, games: scores.length };
}

export interface Streak {
  id: Id;
  length: number;
  fromWeek: number;
  toWeek: number;
}

/** Longest run of consecutive matchup wins per participant (ties and losses end a run). */
export function winStreaks(results: MatchupResult[], scope: "team" | "individual"): Streak[] {
  const seq = new Map<Id, { week: number; o: "W" | "L" | "T" }[]>();
  const push = (id: Id, week: number, o: "W" | "L" | "T") => seq.set(id, [...(seq.get(id) ?? []), { week, o }]);
  for (const r of results) {
    if (!r.official || r.isBye || !r.winner || r.matchup.kind !== scope) continue;
    push(r.a.participantId, r.weekNumber, r.winner === "tie" ? "T" : r.winner === "A" ? "W" : "L");
    push(r.b!.participantId, r.weekNumber, r.winner === "tie" ? "T" : r.winner === "B" ? "W" : "L");
  }
  const out: Streak[] = [];
  for (const [id, s] of seq) {
    s.sort((a, b) => a.week - b.week);
    let best: Streak | null = null;
    let cur: Streak | null = null;
    for (const e of s) {
      if (e.o === "W") {
        const next: Streak = cur ? { ...cur, length: cur.length + 1, toWeek: e.week } : { id, length: 1, fromWeek: e.week, toWeek: e.week };
        cur = next;
        if (!best || next.length > best.length) best = next;
      } else cur = null;
    }
    if (best) out.push(best);
  }
  return out;
}
