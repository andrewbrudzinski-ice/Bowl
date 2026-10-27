import { playoffConfigFor, type RuleConfig } from "./config";
import {
  averageCutoffWeek,
  calculateHandicap,
  resolveAverage,
  resolveBase,
  type HandicapBreakdown,
  type ResolvedAverage,
} from "./handicap";
import { evaluateMatchup, type BowlerHandicapInfo, type MatchupResult } from "./scoring";
import type { Bowler, Id, Matchup, RosterEntry, RuleVersion, Score, Season, Team, Week } from "./types";
import { isOfficial } from "./types";

export interface SeasonData {
  season: Season;
  teams: Team[];
  bowlers: Bowler[];
  roster: RosterEntry[];
  weeks: Week[];
  matchups: Matchup[];
  scores: Score[];
}

/** One scratch game bowled by a bowler in an official matchup (blind/absent games are excluded). */
export interface BowlerGame {
  bowlerId: Id;
  matchupId: Id;
  week: number;
  game: number;
  scratch: number;
}

export interface WeekHandicap {
  bowlerId: Id;
  week: number;
  average: ResolvedAverage;
  base: { base: number; note: string };
  breakdown: HandicapBreakdown;
  isSub: boolean;
  ruleVersion: number;
  frozen: boolean;
}

export interface SeasonModel {
  data: SeasonData;
  results: MatchupResult[];
  resultById: Map<Id, MatchupResult>;
  officialGames: Map<Id, BowlerGame[]>;
  versionForWeek: (week: number) => RuleVersion;
  configForWeek: (week: number) => RuleConfig;
  /** Handicap a bowler would receive entering `week`, recomputed from source scores. */
  handicapAt: (bowlerId: Id, week: number) => WeekHandicap;
  rosterAt: (bowlerId: Id, week: number) => RosterEntry | null;
  teamOf: (bowlerId: Id, week: number) => Id | null;
  teamById: Map<Id, Team>;
  bowlerById: Map<Id, Bowler>;
  weekByNumber: Map<number, Week>;
  /** Latest week number with at least one official matchup. */
  lastOfficialWeek: number;
}

export function versionForWeek(versions: RuleVersion[], week: number): RuleVersion {
  const sorted = [...versions].sort((a, b) => a.effectiveFromWeek - b.effectiveFromWeek || a.version - b.version);
  let current = sorted[0];
  for (const v of sorted) if (v.effectiveFromWeek <= week) current = v;
  return current;
}

export function buildSeasonModel(data: SeasonData, opts: { versionsOverride?: RuleVersion[] } = {}): SeasonModel {
  const versions = opts.versionsOverride ?? data.season.ruleVersions;
  const teamById = new Map(data.teams.map((t) => [t.id, t]));
  const bowlerById = new Map(data.bowlers.map((b) => [b.id, b]));
  const weekByNumber = new Map(data.weeks.map((w) => [w.number, w]));
  const matchById = new Map(data.matchups.map((m) => [m.id, m]));

  const phaseOf = (week: number) => weekByNumber.get(week)?.phase ?? "regular";
  const verFor = (week: number) => versionForWeek(versions, week);
  const verByNumber = (n: number) => versions.find((v) => v.version === n);
  const cfgFor = (week: number) => playoffConfigFor(verFor(week).config, phaseOf(week));

  const rosterAt = (bowlerId: Id, week: number): RosterEntry | null => {
    const entries = data.roster.filter((r) => r.bowlerId === bowlerId);
    const active = entries
      .filter((r) => r.fromWeek <= week && (r.toWeek == null || r.toWeek >= week))
      .sort((a, b) => b.fromWeek - a.fromWeek);
    if (active.length) return active[0];
    return null;
  };
  const teamOf = (bowlerId: Id, week: number) => rosterAt(bowlerId, week)?.teamId ?? null;

  // Official scratch games per bowler, from raw scores only (never from derived values).
  const officialGames = new Map<Id, BowlerGame[]>();
  for (const s of data.scores) {
    const m = matchById.get(s.matchupId);
    if (!m || !isOfficial(m.state) || m.forfeitBy) continue;
    if (s.kind !== "bowled" || s.scratch == null) continue;
    const arr = officialGames.get(s.bowlerId) ?? [];
    arr.push({ bowlerId: s.bowlerId, matchupId: m.id, week: m.weekNumber, game: s.game, scratch: s.scratch });
    officialGames.set(s.bowlerId, arr);
  }
  for (const arr of officialGames.values()) arr.sort((a, b) => a.week - b.week || a.game - b.game);

  const hcCache = new Map<string, WeekHandicap>();
  const averageFor = (bowlerId: Id, week: number): ResolvedAverage => {
    const cfg = cfgFor(week);
    const cutoff = averageCutoffWeek(week, cfg.handicap.recalcEveryWeeks);
    const games = (officialGames.get(bowlerId) ?? []).filter((g) => g.week <= cutoff).map((g) => g.scratch);
    const entry = rosterAt(bowlerId, week) ?? data.roster.find((r) => r.bowlerId === bowlerId) ?? null;
    return resolveAverage(
      { enteringAverage: entry?.enteringAverage ?? null, games, isSub: entry?.isSub ?? false },
      cfg.handicap
    );
  };

  const handicapAt = (bowlerId: Id, week: number): WeekHandicap => {
    const key = `${bowlerId}|${week}`;
    const hit = hcCache.get(key);
    if (hit) return hit;
    const ver = verFor(week);
    const cfg = cfgFor(week);
    const average = averageFor(bowlerId, week);
    // Base may depend on the whole league's averages entering the week.
    let baseCtx: number[] = [];
    if (cfg.handicap.baseMode !== "fixed") {
      const ids = new Set(data.roster.filter((r) => r.fromWeek <= week && (r.toWeek == null || r.toWeek >= week) && !r.isSub).map((r) => r.bowlerId));
      baseCtx = [...ids].map((id) => averageFor(id, week).average).filter((a): a is number => a != null);
    }
    const base = resolveBase(cfg.handicap, { averages: baseCtx });
    const breakdown = calculateHandicap({ average: average.average, base: base.base }, cfg.handicap);
    const entry = rosterAt(bowlerId, week);
    const out: WeekHandicap = {
      bowlerId,
      week,
      average,
      base,
      breakdown,
      isSub: entry?.isSub ?? false,
      ruleVersion: ver.version,
      frozen: false,
    };
    hcCache.set(key, out);
    return out;
  };

  const results: MatchupResult[] = [];
  const ordered = [...data.matchups].sort((a, b) => a.weekNumber - b.weekNumber || a.id.localeCompare(b.id));
  for (const m of ordered) {
    const official = isOfficial(m.state);
    const ver = official && m.ruleVersion != null ? (verByNumber(m.ruleVersion) ?? verFor(m.weekNumber)) : verFor(m.weekNumber);
    const cfg = playoffConfigFor(ver.config, phaseOf(m.weekNumber));
    const lineupIds = new Set<Id>([...m.lineupA, ...m.lineupB]);
    if (!lineupIds.size) for (const s of data.scores) if (s.matchupId === m.id) lineupIds.add(s.bowlerId);
    if (m.kind === "individual") {
      lineupIds.add(m.sideA);
      if (m.sideB) lineupIds.add(m.sideB);
    }
    const handicaps: Record<Id, BowlerHandicapInfo> = {};
    for (const id of lineupIds) {
      const snap = m.handicapSnapshot?.[id];
      if (official && cfg.handicap.lockMode === "locked" && snap) {
        handicaps[id] = { average: snap.average, handicap: snap.handicap, note: snap.note, isSub: rosterAt(id, m.weekNumber)?.isSub ?? false };
      } else {
        const wh = handicapAt(id, m.weekNumber);
        handicaps[id] = {
          average: wh.average.average,
          handicap: wh.breakdown.handicap,
          note: wh.average.note,
          isSub: wh.isSub,
        };
      }
    }
    results.push(
      evaluateMatchup({
        matchup: m,
        scores: data.scores.filter((s) => s.matchupId === m.id),
        cfg,
        handicaps,
        includeProvisional: cfg.standings.includeProvisional,
      })
    );
  }

  const lastOfficialWeek = results.reduce((mx, r) => (r.official && !r.isBye ? Math.max(mx, r.weekNumber) : mx), 0);

  return {
    data,
    results,
    resultById: new Map(results.map((r) => [r.matchup.id, r])),
    officialGames,
    versionForWeek: verFor,
    configForWeek: cfgFor,
    handicapAt,
    rosterAt,
    teamOf,
    teamById,
    bowlerById,
    weekByNumber,
    lastOfficialWeek,
  };
}

/** Handicap snapshot to store when a matchup is finalized, so later rule or average changes cannot rewrite it. */
export function snapshotForMatchup(model: SeasonModel, matchup: Matchup): Record<Id, { average: number | null; handicap: number; note: string }> {
  const ids = new Set<Id>([...matchup.lineupA, ...matchup.lineupB]);
  if (matchup.kind === "individual") {
    ids.add(matchup.sideA);
    if (matchup.sideB) ids.add(matchup.sideB);
  }
  const out: Record<Id, { average: number | null; handicap: number; note: string }> = {};
  for (const id of ids) {
    const h = model.handicapAt(id, matchup.weekNumber);
    out[id] = { average: h.average.average, handicap: h.breakdown.handicap, note: h.average.note };
  }
  return out;
}

/** Default lineup for a team in a given week: its current non-sub roster. */
export function defaultLineup(data: SeasonData, teamId: Id, week: number, size: number): Id[] {
  return data.roster
    .filter((r) => r.teamId === teamId && !r.isSub && r.fromWeek <= week && (r.toWeek == null || r.toWeek >= week))
    .map((r) => r.bowlerId)
    .filter((id) => data.bowlers.find((b) => b.id === id)?.active !== false)
    .slice(0, size);
}
