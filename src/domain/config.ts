import { z } from "zod";

/**
 * RuleConfig is the single source of truth for how a season is calculated.
 * Every calculation in the domain layer takes a RuleConfig as input; nothing
 * else may hardcode a base average, a percentage, a game count or a point value.
 */

export const TIEBREAKERS = [
  "points",
  "wins",
  "winPct",
  "totalPins",
  "scratchPins",
  "average",
  "headToHead",
  "gameWins",
  "highSeries",
  "highGame",
] as const;
export type Tiebreaker = (typeof TIEBREAKERS)[number];

export const TIEBREAKER_LABELS: Record<Tiebreaker, string> = {
  points: "League points",
  wins: "Matchup wins",
  winPct: "Win percentage",
  totalPins: "Total pins (scoring basis)",
  scratchPins: "Total scratch pins",
  average: "Average game score",
  headToHead: "Head-to-head record among tied teams",
  gameWins: "Individual games won",
  highSeries: "High series",
  highGame: "High game",
};

const nonNeg = z.number().finite().min(0);

export const handicapSchema = z.object({
  enabled: z.boolean(),
  percentage: z.number().finite().min(0).max(200),
  /** fixed: baseValue. league_average / highest_average: derived from bowlers' averages entering the week. */
  baseMode: z.enum(["fixed", "league_average", "highest_average"]),
  baseValue: z.number().finite().min(0).max(300),
  /** entering: always the commissioner-entered average. established: league average once enough games exist. */
  averageSource: z.enum(["entering", "established"]),
  /** cumulative: all season games. rolling: last N games. blended: entering average counts as N virtual games. */
  averageMethod: z.enum(["cumulative", "rolling", "blended"]),
  rollingGames: z.number().int().min(1).max(200),
  blendGames: z.number().int().min(1).max(200),
  establishAfterGames: z.number().int().min(0).max(200),
  /** How the average is rounded *before* it is used in the handicap formula. */
  averageRounding: z.enum(["none", "floor", "nearest"]),
  /** How the raw handicap is rounded to whole pins. */
  rounding: z.enum(["nearest", "floor", "ceil", "truncate"]),
  minHandicap: z.number().finite().nullable(),
  maxHandicap: z.number().finite().nullable(),
  allowNegative: z.boolean(),
  newBowlerPolicy: z.enum(["no_handicap", "fixed_average", "first_games_average"]),
  newBowlerAverage: z.number().finite().min(0).max(300),
  subPolicy: z.enum(["own_average", "fixed_average", "no_handicap"]),
  subAverage: z.number().finite().min(0).max(300),
  /** Averages feeding the handicap refresh every N weeks (1 = every week). */
  recalcEveryWeeks: z.number().int().min(1).max(52),
  /** locked: finalized matchups keep the handicap snapshot taken at finalization. live: recomputed from source scores. */
  lockMode: z.enum(["locked", "live"]),
});

export const bonusSchema = z.object({
  highGame: nonNeg,
  highSeries: nonNeg,
});

export const scoringSchema = z.object({
  gamesPerSession: z.number().int().min(1).max(10),
  /** What decides games/series: handicap-adjusted or scratch totals. Ignored (=scratch) when handicap disabled. */
  basis: z.enum(["handicap", "scratch"]),
  pointsPerGame: nonNeg,
  pointsPerSeries: nonNeg,
  /** Fraction of a point value each side receives on a tie (0.5 = split). */
  tieFraction: z.number().min(0).max(1),
  bonus: bonusSchema,
  /** W/L/T for the record is decided by league points or by the series total. */
  matchupWinnerBy: z.enum(["points", "series"]),
  /** Points for individual-vs-individual comparison inside team matches (format = both). */
  individual: z.object({ pointsPerGame: nonNeg, pointsPerSeries: nonNeg }),
  incompletePolicy: z.enum(["block_finalize", "allow_partial"]),
  /** Score substituted for an absent bowler. */
  absentPolicy: z.enum(["blind", "none"]),
  blindMode: z.enum(["average_minus_offset", "fixed"]),
  blindOffset: z.number().finite().min(0).max(300),
  blindFixed: z.number().int().min(0).max(300),
  forfeitPoints: z.enum(["max_to_opponent", "none"]),
  byePoints: nonNeg,
  minGameScore: z.number().int().min(0).max(300),
  maxGameScore: z.number().int().min(1).max(450),
  /** Entries this many pins above/below the bowler's average are flagged as suspicious. */
  suspiciousDeviation: z.number().int().min(10).max(300),
});

export const standingsSchema = z.object({
  tiebreakers: z.array(z.enum(TIEBREAKERS)).min(1).max(TIEBREAKERS.length),
  includeProvisional: z.boolean(),
  /** Which pins count toward total pins & average in standings. */
  pinsBasis: z.enum(["handicap", "scratch"]),
});

export const playoffsSchema = z.object({
  enabled: z.boolean(),
  qualifiers: z.number().int().min(2).max(32),
  weeks: z.number().int().min(1).max(8),
  seeding: z.enum(["standings"]),
  format: z.enum(["single_elimination"]),
  /** Who advances when a playoff matchup is level on points: the series-total winner (then higher seed), or always the higher seed. */
  tiebreak: z.enum(["series_then_seed", "higher_seed"]),
  /** Playoff matchups can use their own game count / basis. null = same as regular season. */
  gamesPerSession: z.number().int().min(1).max(10).nullable(),
  basis: z.enum(["handicap", "scratch"]).nullable(),
  pointsPerGame: nonNeg.nullable(),
  pointsPerSeries: nonNeg.nullable(),
});

export const eligibilitySchema = z.object({
  /** Games a bowler needs before counting for ranked individual awards / records. */
  minGamesForAwards: z.number().int().min(0).max(100),
  subsCountForRecords: z.boolean(),
});

export const ruleConfigSchema = z.object({
  format: z.enum(["team", "individual", "both"]),
  bowlersPerTeam: z.number().int().min(1).max(8),
  allowSubstitutes: z.boolean(),
  scoring: scoringSchema,
  handicap: handicapSchema,
  standings: standingsSchema,
  playoffs: playoffsSchema,
  eligibility: eligibilitySchema,
  scheduleFormat: z.enum(["round_robin", "double_round_robin", "manual"]),
  recordsCarryOver: z.boolean(),
});

export type RuleConfig = z.infer<typeof ruleConfigSchema>;
export type HandicapConfig = z.infer<typeof handicapSchema>;
export type ScoringConfig = z.infer<typeof scoringSchema>;

export const DEFAULT_CONFIG: RuleConfig = {
  format: "team",
  bowlersPerTeam: 3,
  allowSubstitutes: true,
  scoring: {
    gamesPerSession: 3,
    basis: "handicap",
    pointsPerGame: 1,
    pointsPerSeries: 1,
    tieFraction: 0.5,
    bonus: { highGame: 0, highSeries: 0 },
    matchupWinnerBy: "points",
    individual: { pointsPerGame: 1, pointsPerSeries: 1 },
    incompletePolicy: "block_finalize",
    absentPolicy: "blind",
    blindMode: "average_minus_offset",
    blindOffset: 10,
    blindFixed: 100,
    forfeitPoints: "max_to_opponent",
    byePoints: 0,
    minGameScore: 0,
    maxGameScore: 300,
    suspiciousDeviation: 80,
  },
  handicap: {
    enabled: true,
    percentage: 90,
    baseMode: "fixed",
    baseValue: 220,
    averageSource: "established",
    averageMethod: "cumulative",
    rollingGames: 30,
    blendGames: 9,
    establishAfterGames: 3,
    averageRounding: "floor",
    rounding: "nearest",
    minHandicap: 0,
    maxHandicap: null,
    allowNegative: false,
    newBowlerPolicy: "first_games_average",
    newBowlerAverage: 150,
    subPolicy: "own_average",
    subAverage: 150,
    recalcEveryWeeks: 1,
    lockMode: "locked",
  },
  standings: {
    tiebreakers: ["points", "wins", "totalPins", "headToHead"],
    includeProvisional: false,
    pinsBasis: "handicap",
  },
  playoffs: {
    enabled: false,
    qualifiers: 4,
    weeks: 2,
    seeding: "standings",
    format: "single_elimination",
    tiebreak: "series_then_seed",
    gamesPerSession: null,
    basis: null,
    pointsPerGame: null,
    pointsPerSeries: null,
  },
  eligibility: { minGamesForAwards: 6, subsCountForRecords: false },
  scheduleFormat: "round_robin",
  recordsCarryOver: true,
};

export interface ConfigTemplate {
  id: string;
  name: string;
  description: string;
  config: RuleConfig;
}

function derive(patch: (c: RuleConfig) => void): RuleConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  patch(c);
  return c;
}

export const STARTER_TEMPLATES: ConfigTemplate[] = [
  {
    id: "traditional-handicap-team",
    name: "Traditional handicap team league",
    description:
      "Teams of three, 3 games a night, 90% of 220 handicap, a point per game plus a point for the series.",
    config: derive(() => {}),
  },
  {
    id: "scratch-team",
    name: "Scratch team league",
    description: "No handicap. Teams are decided on raw pins; a point per game plus a series point.",
    config: derive((c) => {
      c.handicap.enabled = false;
      c.scoring.basis = "scratch";
      c.standings.pinsBasis = "scratch";
    }),
  },
  {
    id: "individual-head-to-head",
    name: "Individual head-to-head league",
    description: "Bowler vs. bowler every week with handicap; one point per game and one for the series.",
    config: derive((c) => {
      c.format = "individual";
      c.bowlersPerTeam = 1;
      c.allowSubstitutes = false;
    }),
  },
  {
    id: "team-and-individual",
    name: "Team and individual combined",
    description:
      "Teams compete on team totals while each bowler also faces the matching bowler on the other team for individual standings.",
    config: derive((c) => {
      c.format = "both";
      c.standings.tiebreakers = ["points", "wins", "totalPins", "headToHead"];
    }),
  },
];

/** Where settings may safely change mid-season. Used by the rule-change workflow. */
export const STRUCTURAL_PATHS = ["format", "scoring.gamesPerSession", "bowlersPerTeam"] as const;

export interface ConfigIssue {
  path: string;
  message: string;
  severity: "error" | "warning";
}

/** Structural + semantic validation beyond what zod can express. */
export function validateConfig(input: unknown): { ok: boolean; config?: RuleConfig; issues: ConfigIssue[] } {
  const parsed = ruleConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
        severity: "error" as const,
      })),
    };
  }
  const c = parsed.data;
  const issues: ConfigIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message, severity: "error" });
  const warn = (path: string, message: string) => issues.push({ path, message, severity: "warning" });

  if (c.scoring.minGameScore >= c.scoring.maxGameScore)
    err("scoring.minGameScore", "Minimum game score must be lower than the maximum.");
  if (c.format === "individual" && c.bowlersPerTeam !== 1)
    err("bowlersPerTeam", "Individual leagues use one bowler per side.");
  if (c.handicap.minHandicap != null && c.handicap.maxHandicap != null && c.handicap.minHandicap > c.handicap.maxHandicap)
    err("handicap.minHandicap", "Minimum handicap cannot exceed maximum handicap.");
  if (c.handicap.enabled && c.scoring.basis === "scratch")
    warn("scoring.basis", "Handicap is enabled but matchups are decided on scratch pins; handicaps are shown but not used for results.");
  if (!c.handicap.enabled && c.scoring.basis === "handicap")
    warn("scoring.basis", "Handicap is disabled, so results are decided on scratch pins.");
  if (c.scoring.pointsPerGame === 0 && c.scoring.pointsPerSeries === 0 && c.scoring.matchupWinnerBy === "points")
    err("scoring.matchupWinnerBy", "No points are awarded, so matchups cannot be decided by points. Award points or decide by series total.");
  if (c.standings.tiebreakers.length !== new Set(c.standings.tiebreakers).size)
    err("standings.tiebreakers", "Tie-breakers must not repeat.");
  if (c.format === "individual" && c.standings.tiebreakers.includes("headToHead"))
    warn("standings.tiebreakers", "Head-to-head still works for individual leagues, but only bowlers who met each other are separated by it.");
  if (c.playoffs.enabled && c.playoffs.qualifiers < 2) err("playoffs.qualifiers", "Playoffs need at least two qualifiers.");
  if (c.handicap.enabled && c.handicap.baseMode === "fixed" && c.handicap.baseValue === 0)
    warn("handicap.baseValue", "A base average of 0 gives every bowler no handicap.");
  if (c.format !== "team" && c.scoring.individual.pointsPerGame + c.scoring.individual.pointsPerSeries === 0 && c.format === "both")
    warn("scoring.individual", "Individual points are all zero, so individual standings will show no points.");
  if (c.handicap.allowNegative && c.handicap.minHandicap == null)
    warn("handicap.minHandicap", "Negative handicaps are allowed with no floor; bowlers far above the base will be penalised heavily.");
  if (c.handicap.percentage > 100) warn("handicap.percentage", "Handicap percentages above 100% over-compensate weaker bowlers.");
  if (c.scoring.maxGameScore > 300) warn("scoring.maxGameScore", "Standard bowling games cannot exceed 300; raise only for non-standard formats.");
  return { ok: !issues.some((i) => i.severity === "error"), config: c, issues };
}

export function playoffConfigFor(config: RuleConfig, phase: "regular" | "playoff"): RuleConfig {
  if (phase === "regular" || !config.playoffs.enabled) return config;
  const p = config.playoffs;
  const c = structuredClone(config);
  if (p.gamesPerSession != null) c.scoring.gamesPerSession = p.gamesPerSession;
  if (p.basis != null) c.scoring.basis = p.basis;
  if (p.pointsPerGame != null) c.scoring.pointsPerGame = p.pointsPerGame;
  if (p.pointsPerSeries != null) c.scoring.pointsPerSeries = p.pointsPerSeries;
  return c;
}

/** Resolve a (possibly partial) stored config against defaults so older rows stay readable. */
export function normalizeConfig(raw: unknown): RuleConfig {
  const base = structuredClone(DEFAULT_CONFIG) as Record<string, unknown>;
  const merged = deepMerge(base, (raw ?? {}) as Record<string, unknown>);
  return ruleConfigSchema.parse(merged);
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) {
      out[k] = deepMerge(a[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else if (v !== undefined) out[k] = v;
  }
  return out;
}
