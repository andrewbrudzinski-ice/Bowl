import type { RuleConfig } from "./config";
import { roundWith, sum } from "./math";
import type { Id, Matchup, Score, ScoreKind, Side } from "./types";
import { isOfficial } from "./types";

export interface BowlerHandicapInfo {
  average: number | null;
  handicap: number;
  note: string;
  isSub: boolean;
}

export interface GameLine {
  game: number;
  scratch: number | null;
  handicap: number;
  adjusted: number | null;
  kind: ScoreKind | "missing";
  blind: boolean;
}

export interface BowlerLine {
  bowlerId: Id;
  isSub: boolean;
  average: number | null;
  handicap: number;
  note: string;
  games: GameLine[];
  scratchSeries: number;
  handicapSeries: number;
  adjustedSeries: number;
  basisSeries: number;
  gamesScored: number;
  absent: boolean;
}

export interface SideGame {
  game: number;
  scratch: number | null;
  adjusted: number | null;
  basis: number | null;
  complete: boolean;
  forfeited: boolean;
}

export interface SideLine {
  side: Side;
  participantId: Id;
  lineup: BowlerLine[];
  games: SideGame[];
  scratchSeries: number;
  handicapSeries: number;
  adjustedSeries: number;
  basisSeries: number;
  points: number;
  gameWins: number;
  gamePoints: number;
  seriesPoints: number;
  bonusPoints: number;
  /** Best single basis game by one bowler on this side. */
  highGame: number | null;
  /** Best basis series by one bowler on this side. */
  highSeries: number | null;
}

export interface GameResult {
  game: number;
  winner: Side | "tie" | null;
  /** Absolute basis margin; null if not scored. */
  margin: number | null;
  status: "scored" | "incomplete" | "forfeit";
}

export interface PairResult {
  a: Id;
  b: Id;
  gamesA: number[];
  gamesB: number[];
  winsA: number;
  winsB: number;
  seriesA: number;
  seriesB: number;
  seriesWinner: Side | "tie" | null;
  pointsA: number;
  pointsB: number;
  complete: boolean;
}

export interface MatchupResult {
  matchup: Matchup;
  weekNumber: number;
  isBye: boolean;
  forfeitBy: Side | null;
  official: boolean;
  /** Counts toward standings given the configured provisional policy. */
  counts: boolean;
  complete: boolean;
  missing: { side: Side; bowlerId: Id; game: number }[];
  basis: "handicap" | "scratch";
  gamesPerSession: number;
  a: SideLine;
  b: SideLine | null;
  games: GameResult[];
  winner: Side | "tie" | null;
  seriesWinner: Side | "tie" | null;
  /** Absolute series margin on the scoring basis. */
  margin: number | null;
  pairs: PairResult[];
  ruleVersion: number | null;
}

export function usesHandicap(cfg: RuleConfig): boolean {
  return cfg.handicap.enabled && cfg.scoring.basis === "handicap";
}

export function maxMatchupPoints(cfg: RuleConfig): number {
  const s = cfg.scoring;
  return s.gamesPerSession * s.pointsPerGame + s.pointsPerSeries + s.bonus.highGame + s.bonus.highSeries;
}

export function blindScoreFor(average: number | null, cfg: RuleConfig): number {
  const s = cfg.scoring;
  if (s.blindMode === "fixed" || average == null) return s.blindFixed;
  return Math.max(s.minGameScore, roundWith(average - s.blindOffset, "nearest"));
}

function cmp(a: number, b: number): Side | "tie" {
  return a > b ? "A" : a < b ? "B" : "tie";
}

function emptyBowler(id: Id, info: BowlerHandicapInfo | undefined, games: number): BowlerLine {
  return {
    bowlerId: id,
    isSub: info?.isSub ?? false,
    average: info?.average ?? null,
    handicap: info?.handicap ?? 0,
    note: info?.note ?? "",
    games: Array.from({ length: games }, (_, i) => ({
      game: i + 1,
      scratch: null,
      handicap: info?.handicap ?? 0,
      adjusted: null,
      kind: "missing" as const,
      blind: false,
    })),
    scratchSeries: 0,
    handicapSeries: 0,
    adjustedSeries: 0,
    basisSeries: 0,
    gamesScored: 0,
    absent: false,
  };
}

function buildBowlerLine(
  id: Id,
  scores: Map<string, Score>,
  info: BowlerHandicapInfo | undefined,
  cfg: RuleConfig,
  games: number,
  useHdcp: boolean
): BowlerLine {
  const line = emptyBowler(id, info, games);
  let absentCount = 0;
  for (const g of line.games) {
    const s = scores.get(`${id}|${g.game}`);
    if (!s) continue;
    g.kind = s.kind;
    if (s.kind === "bowled") {
      if (s.scratch == null) {
        g.kind = "missing";
        continue;
      }
      g.scratch = s.scratch;
      g.adjusted = s.scratch + (cfg.handicap.enabled ? g.handicap : 0);
    } else if (s.kind === "absent") {
      absentCount++;
      if (cfg.scoring.absentPolicy === "blind") {
        g.scratch = blindScoreFor(info?.average ?? null, cfg);
        g.blind = true;
        g.adjusted = g.scratch + (cfg.handicap.enabled ? g.handicap : 0);
      } else {
        g.scratch = 0;
        g.adjusted = 0;
        g.handicap = 0;
      }
    } else if (s.kind === "forfeit") {
      g.scratch = null;
      g.adjusted = null;
    }
  }
  line.absent = absentCount > 0 && absentCount === games;
  const scored = line.games.filter((g) => g.scratch != null);
  line.gamesScored = scored.length;
  line.scratchSeries = sum(scored.map((g) => g.scratch!));
  line.adjustedSeries = sum(scored.map((g) => g.adjusted!));
  line.handicapSeries = line.adjustedSeries - line.scratchSeries;
  line.basisSeries = useHdcp ? line.adjustedSeries : line.scratchSeries;
  return line;
}

function sideLine(
  side: Side,
  participantId: Id,
  lineupIds: Id[],
  scores: Map<string, Score>,
  hcaps: Record<Id, BowlerHandicapInfo>,
  cfg: RuleConfig,
  games: number,
  useHdcp: boolean
): SideLine {
  const lineup = lineupIds.map((id) => buildBowlerLine(id, scores, hcaps[id], cfg, games, useHdcp));
  const gameRows: SideGame[] = [];
  for (let g = 1; g <= games; g++) {
    const cells = lineup.map((l) => l.games[g - 1]);
    const forfeited = cells.length > 0 && cells.every((c) => c.kind === "forfeit");
    const complete = cells.length > 0 && cells.every((c) => c.scratch != null || c.kind === "forfeit") && !forfeited;
    const scratchVals = cells.filter((c) => c.scratch != null);
    const scratch = scratchVals.length ? sum(scratchVals.map((c) => c.scratch!)) : null;
    const adjusted = scratchVals.length ? sum(scratchVals.map((c) => c.adjusted!)) : null;
    gameRows.push({
      game: g,
      scratch,
      adjusted,
      basis: scratch == null ? null : useHdcp ? adjusted : scratch,
      complete,
      forfeited,
    });
  }
  const bowled = lineup.flatMap((l) => l.games.filter((c) => c.scratch != null));
  const scratchSeries = sum(bowled.map((c) => c.scratch!));
  const adjustedSeries = sum(bowled.map((c) => c.adjusted!));
  const bestGame = bowled.length ? Math.max(...bowled.map((c) => (useHdcp ? c.adjusted! : c.scratch!))) : null;
  const bestSeries = lineup.length ? Math.max(...lineup.map((l) => l.basisSeries)) : null;
  return {
    side,
    participantId,
    lineup,
    games: gameRows,
    scratchSeries,
    handicapSeries: adjustedSeries - scratchSeries,
    adjustedSeries,
    basisSeries: useHdcp ? adjustedSeries : scratchSeries,
    points: 0,
    gameWins: 0,
    gamePoints: 0,
    seriesPoints: 0,
    bonusPoints: 0,
    highGame: bestGame,
    highSeries: bestSeries && bestSeries > 0 ? bestSeries : null,
  };
}

function award(winner: Side | "tie" | null, value: number, tieFraction: number): { A: number; B: number } {
  if (winner === "A") return { A: value, B: 0 };
  if (winner === "B") return { A: 0, B: value };
  if (winner === "tie") return { A: value * tieFraction, B: value * tieFraction };
  return { A: 0, B: 0 };
}

export interface EvaluateInput {
  matchup: Matchup;
  scores: Score[];
  cfg: RuleConfig;
  handicaps: Record<Id, BowlerHandicapInfo>;
  includeProvisional?: boolean;
}

/**
 * Pure matchup evaluation. Given recorded scratch scores, the handicaps in force and the rules,
 * it derives game/series winners, points and the overall result. Nothing here reads a database.
 */
export function evaluateMatchup(input: EvaluateInput): MatchupResult {
  const { matchup, cfg, handicaps } = input;
  const G = cfg.scoring.gamesPerSession;
  const useHdcp = usesHandicap(cfg);
  const official = isOfficial(matchup.state);
  const countsProvisional =
    !!input.includeProvisional && (matchup.state === "draft" || matchup.state === "ready_for_review");

  const sideScores = (side: Side) => {
    const m = new Map<string, Score>();
    for (const s of input.scores) if (s.matchupId === matchup.id && s.side === side) m.set(`${s.bowlerId}|${s.game}`, s);
    return m;
  };
  const lineupOf = (side: Side): Id[] => {
    const declared = side === "A" ? matchup.lineupA : matchup.lineupB;
    if (declared.length) return declared;
    if (matchup.kind === "individual") return [side === "A" ? matchup.sideA : matchup.sideB!].filter(Boolean) as Id[];
    return [...new Set(input.scores.filter((s) => s.matchupId === matchup.id && s.side === side).map((s) => s.bowlerId))];
  };

  const aScores = sideScores("A");
  const a = sideLine("A", matchup.sideA, lineupOf("A"), aScores, handicaps, cfg, G, useHdcp);
  const isBye = matchup.sideB == null;
  const b = isBye
    ? null
    : sideLine("B", matchup.sideB!, lineupOf("B"), sideScores("B"), handicaps, cfg, G, useHdcp);

  const base: Omit<MatchupResult, "winner" | "seriesWinner" | "margin" | "games" | "complete" | "missing" | "pairs"> = {
    matchup,
    weekNumber: matchup.weekNumber,
    isBye,
    forfeitBy: matchup.forfeitBy,
    official,
    counts: official || countsProvisional,
    basis: useHdcp ? "handicap" : "scratch",
    gamesPerSession: G,
    a,
    b,
    ruleVersion: matchup.ruleVersion,
  };

  if (isBye) {
    a.points = cfg.scoring.byePoints;
    return { ...base, games: [], winner: null, seriesWinner: null, margin: null, complete: true, missing: [], pairs: [] };
  }
  const bb = b!;

  if (matchup.forfeitBy) {
    const winSide: Side = matchup.forfeitBy === "A" ? "B" : "A";
    const winner = winSide === "A" ? a : bb;
    if (cfg.scoring.forfeitPoints === "max_to_opponent") {
      winner.gamePoints = G * cfg.scoring.pointsPerGame;
      winner.seriesPoints = cfg.scoring.pointsPerSeries;
      winner.points = winner.gamePoints + winner.seriesPoints;
      winner.gameWins = G;
    }
    return {
      ...base,
      games: Array.from({ length: G }, (_, i) => ({ game: i + 1, winner: winSide, margin: null, status: "forfeit" as const })),
      winner: winSide,
      seriesWinner: winSide,
      margin: null,
      complete: true,
      missing: [],
      pairs: [],
    };
  }

  // Missing scores.
  const missing: MatchupResult["missing"] = [];
  for (const line of [a, bb]) {
    for (const bl of line.lineup)
      for (const gl of bl.games) if (gl.kind === "missing") missing.push({ side: line.side, bowlerId: bl.bowlerId, game: gl.game });
  }
  const complete = missing.length === 0 && a.lineup.length > 0 && bb.lineup.length > 0;
  const partialOk = cfg.scoring.incompletePolicy === "allow_partial";

  // Games.
  const games: GameResult[] = [];
  let seriesA = 0;
  let seriesB = 0;
  let scoredGames = 0;
  for (let g = 1; g <= G; g++) {
    const ga = a.games[g - 1];
    const gb = bb.games[g - 1];
    if (ga.forfeited || gb.forfeited) {
      const w: Side | "tie" = ga.forfeited && gb.forfeited ? "tie" : ga.forfeited ? "B" : "A";
      games.push({ game: g, winner: w, margin: null, status: "forfeit" });
      const p = award(w, cfg.scoring.pointsPerGame, cfg.scoring.tieFraction);
      a.gamePoints += p.A;
      bb.gamePoints += p.B;
      if (w === "A") a.gameWins++;
      if (w === "B") bb.gameWins++;
      continue;
    }
    const ready = ga.complete && gb.complete;
    const usable = ready || (partialOk && ga.basis != null && gb.basis != null && ga.complete && gb.complete);
    if (!usable) {
      games.push({ game: g, winner: null, margin: ga.basis != null && gb.basis != null ? Math.abs(ga.basis - gb.basis) : null, status: "incomplete" });
      continue;
    }
    const w = cmp(ga.basis!, gb.basis!);
    games.push({ game: g, winner: w, margin: Math.abs(ga.basis! - gb.basis!), status: "scored" });
    seriesA += ga.basis!;
    seriesB += gb.basis!;
    scoredGames++;
    const p = award(w, cfg.scoring.pointsPerGame, cfg.scoring.tieFraction);
    a.gamePoints += p.A;
    bb.gamePoints += p.B;
    if (w === "A") a.gameWins++;
    if (w === "B") bb.gameWins++;
  }

  let seriesWinner: Side | "tie" | null = null;
  const seriesScorable = complete || (partialOk && scoredGames > 0);
  if (seriesScorable && scoredGames > 0) {
    seriesWinner = cmp(seriesA, seriesB);
    const p = award(seriesWinner, cfg.scoring.pointsPerSeries, cfg.scoring.tieFraction);
    a.seriesPoints = p.A;
    bb.seriesPoints = p.B;
  }
  if (seriesScorable && scoredGames > 0) {
    const bonusG = award(
      a.highGame != null && bb.highGame != null ? cmp(a.highGame, bb.highGame) : null,
      cfg.scoring.bonus.highGame,
      cfg.scoring.tieFraction
    );
    const bonusS = award(
      a.highSeries != null && bb.highSeries != null ? cmp(a.highSeries, bb.highSeries) : null,
      cfg.scoring.bonus.highSeries,
      cfg.scoring.tieFraction
    );
    a.bonusPoints = bonusG.A + bonusS.A;
    bb.bonusPoints = bonusG.B + bonusS.B;
  }
  a.points = a.gamePoints + a.seriesPoints + a.bonusPoints;
  bb.points = bb.gamePoints + bb.seriesPoints + bb.bonusPoints;

  let winner: Side | "tie" | null = null;
  if (complete || (partialOk && scoredGames > 0)) {
    winner = cfg.scoring.matchupWinnerBy === "series" ? seriesWinner : cmp(a.points, bb.points);
  }

  // Pair-wise individual comparisons inside team matchups (format "both").
  const pairs: PairResult[] = [];
  if (matchup.kind === "team" && cfg.format === "both") {
    const n = Math.min(a.lineup.length, bb.lineup.length);
    for (let i = 0; i < n; i++) {
      const la = a.lineup[i];
      const lb = bb.lineup[i];
      const gamesA: number[] = [];
      const gamesB: number[] = [];
      let winsA = 0;
      let winsB = 0;
      let pointsA = 0;
      let pointsB = 0;
      let ok = true;
      for (let g = 0; g < G; g++) {
        const ca = la.games[g];
        const cb = lb.games[g];
        if (ca.scratch == null || cb.scratch == null) {
          ok = false;
          continue;
        }
        const va = useHdcp ? ca.adjusted! : ca.scratch;
        const vb = useHdcp ? cb.adjusted! : cb.scratch;
        gamesA.push(va);
        gamesB.push(vb);
        const w = cmp(va, vb);
        if (w === "A") winsA++;
        if (w === "B") winsB++;
        const p = award(w, cfg.scoring.individual.pointsPerGame, cfg.scoring.tieFraction);
        pointsA += p.A;
        pointsB += p.B;
      }
      const seriesAi = sum(gamesA);
      const seriesBi = sum(gamesB);
      let sw: Side | "tie" | null = null;
      if (ok) {
        sw = cmp(seriesAi, seriesBi);
        const p = award(sw, cfg.scoring.individual.pointsPerSeries, cfg.scoring.tieFraction);
        pointsA += p.A;
        pointsB += p.B;
      }
      pairs.push({
        a: la.bowlerId,
        b: lb.bowlerId,
        gamesA,
        gamesB,
        winsA,
        winsB,
        seriesA: seriesAi,
        seriesB: seriesBi,
        seriesWinner: sw,
        pointsA,
        pointsB,
        complete: ok,
      });
    }
  }

  return {
    ...base,
    games,
    winner,
    seriesWinner,
    margin: scoredGames > 0 ? Math.abs(seriesA - seriesB) : null,
    complete,
    missing,
    pairs,
  };
}
