import type { HandicapConfig } from "./config";
import { mean, roundWith } from "./math";

export interface HandicapInput {
  /** Bowler average used in the formula (already source/rounding-resolved). null = unknown. */
  average: number | null;
  base: number;
}

export interface HandicapBreakdown {
  enabled: boolean;
  average: number | null;
  base: number;
  percentage: number;
  difference: number | null;
  raw: number | null;
  rounded: number | null;
  handicap: number;
  clampedBy: "min" | "max" | "negative" | null;
  formula: string;
  steps: string[];
}

/** Effective [min,max] bounds after applying the allowNegative rule. */
export function handicapBounds(cfg: HandicapConfig): { min: number; max: number } {
  const min = cfg.allowNegative ? (cfg.minHandicap ?? -Infinity) : Math.max(0, cfg.minHandicap ?? 0);
  const max = cfg.maxHandicap ?? Infinity;
  return { min, max };
}

export function roundAverage(avg: number, cfg: HandicapConfig): number {
  if (cfg.averageRounding === "none") return avg;
  return roundWith(avg, cfg.averageRounding === "floor" ? "floor" : "nearest");
}

/**
 * The one and only handicap formula:
 *   handicap = round((base − average) × percentage / 100), then clamped to the configured bounds.
 * Returns the full breakdown so the UI can show exactly how the number was reached.
 */
export function calculateHandicap(input: HandicapInput, cfg: HandicapConfig): HandicapBreakdown {
  const { base, average } = input;
  const steps: string[] = [];
  if (!cfg.enabled) {
    return {
      enabled: false,
      average,
      base,
      percentage: cfg.percentage,
      difference: null,
      raw: null,
      rounded: null,
      handicap: 0,
      clampedBy: null,
      formula: "Handicap is disabled for this league.",
      steps: ["Handicap is disabled — every bowler scores scratch."],
    };
  }
  if (average == null) {
    return {
      enabled: true,
      average: null,
      base,
      percentage: cfg.percentage,
      difference: null,
      raw: null,
      rounded: null,
      handicap: 0,
      clampedBy: null,
      formula: "No established average yet, so handicap is 0.",
      steps: ["No usable average for this bowler yet → handicap 0."],
    };
  }
  const difference = base - average;
  const raw = (difference * cfg.percentage) / 100;
  const rounded = roundWith(raw, cfg.rounding);
  const { min, max } = handicapBounds(cfg);
  let handicap = rounded;
  let clampedBy: HandicapBreakdown["clampedBy"] = null;
  if (handicap < min) {
    clampedBy = min === 0 && !cfg.allowNegative ? "negative" : "min";
    handicap = min;
  } else if (handicap > max) {
    clampedBy = "max";
    handicap = max;
  }
  steps.push(`Base ${base} − average ${average} = ${difference}`);
  steps.push(`${difference} × ${cfg.percentage}% = ${Math.round(raw * 1000) / 1000}`);
  steps.push(`Rounded (${cfg.rounding}) → ${rounded}`);
  if (clampedBy === "negative") steps.push(`Negative handicaps are not allowed → ${handicap}`);
  if (clampedBy === "min") steps.push(`Raised to the league minimum → ${handicap}`);
  if (clampedBy === "max") steps.push(`Capped at the league maximum → ${handicap}`);
  return {
    enabled: true,
    average,
    base,
    percentage: cfg.percentage,
    difference,
    raw,
    rounded,
    handicap,
    clampedBy,
    formula: `(${base} − ${average}) × ${cfg.percentage}% = ${handicap}`,
    steps,
  };
}

export interface AverageContext {
  enteringAverage: number | null;
  /** Scratch game scores bowled this season before the handicap cut-off, oldest first. */
  games: number[];
  isSub: boolean;
}

export interface ResolvedAverage {
  average: number | null;
  source: "entering" | "established" | "blended" | "rolling" | "new_bowler_fixed" | "new_bowler_games" | "sub_fixed" | "none";
  gamesCounted: number;
  note: string;
}

/**
 * Decides which average feeds the handicap formula, according to the league's
 * average source/method, "establish after N games" and new-bowler/sub policies.
 */
export function resolveAverage(ctx: AverageContext, cfg: HandicapConfig): ResolvedAverage {
  const { games, enteringAverage } = ctx;
  const n = games.length;
  const finish = (avg: number, source: ResolvedAverage["source"], note: string, counted = n): ResolvedAverage => ({
    average: roundAverage(avg, cfg),
    source,
    gamesCounted: counted,
    note,
  });

  if (ctx.isSub) {
    if (cfg.subPolicy === "no_handicap") return { average: null, source: "none", gamesCounted: n, note: "Substitute bowlers receive no handicap." };
    if (cfg.subPolicy === "fixed_average") return finish(cfg.subAverage, "sub_fixed", `Substitute bowlers use a fixed average of ${cfg.subAverage}.`, 0);
  }

  const established = n >= cfg.establishAfterGames && n > 0;

  if (cfg.averageSource === "entering" && enteringAverage != null) {
    return finish(enteringAverage, "entering", "Using the entering average (league is set to always use entering averages).", 0);
  }

  if (established) {
    if (cfg.averageMethod === "rolling") {
      const recent = games.slice(-cfg.rollingGames);
      return finish(mean(recent)!, "rolling", `Average of the last ${recent.length} games.`, recent.length);
    }
    if (cfg.averageMethod === "blended" && enteringAverage != null) {
      const total = enteringAverage * cfg.blendGames + games.reduce((a, b) => a + b, 0);
      return finish(total / (cfg.blendGames + n), "blended", `Entering average counts as ${cfg.blendGames} games blended with ${n} bowled.`);
    }
    return finish(mean(games)!, "established", `Season average over ${n} games.`);
  }

  // Not yet established.
  if (enteringAverage != null) return finish(enteringAverage, "entering", `Fewer than ${cfg.establishAfterGames} games bowled — using entering average.`, 0);

  // Brand-new bowler: no entering average.
  switch (cfg.newBowlerPolicy) {
    case "fixed_average":
      return finish(cfg.newBowlerAverage, "new_bowler_fixed", `New bowler with no entering average — using the league's new-bowler average of ${cfg.newBowlerAverage}.`, 0);
    case "first_games_average":
      if (n > 0) return finish(mean(games)!, "new_bowler_games", `New bowler — average of ${n} game(s) bowled so far.`);
      return { average: null, source: "none", gamesCounted: 0, note: "New bowler with no games yet — no handicap until a game is bowled." };
    default:
      return { average: null, source: "none", gamesCounted: n, note: "New bowler — no handicap until established." };
  }
}

export interface BaseContext {
  /** Resolved averages of every active bowler entering the week. */
  averages: number[];
}

export function resolveBase(cfg: HandicapConfig, ctx: BaseContext): { base: number; note: string } {
  const avgs = ctx.averages.filter((a) => a > 0);
  if (cfg.baseMode === "league_average" && avgs.length) {
    const b = roundWith(mean(avgs)!, "nearest");
    return { base: b, note: `League average entering the week (${b}).` };
  }
  if (cfg.baseMode === "highest_average" && avgs.length) {
    const b = Math.round(Math.max(...avgs));
    return { base: b, note: `Highest bowler average entering the week (${b}).` };
  }
  return { base: cfg.baseValue, note: `Fixed base average ${cfg.baseValue}.` };
}

/** Week whose completed games feed handicaps for `week` given the "recalculate every N weeks" rule. */
export function averageCutoffWeek(week: number, recalcEveryWeeks: number): number {
  const n = Math.max(1, recalcEveryWeeks);
  // Weeks 1..n use nothing; weeks n+1..2n use games through week n; ...
  return Math.floor((week - 1) / n) * n;
}
