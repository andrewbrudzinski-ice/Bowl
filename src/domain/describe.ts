import { TIEBREAKER_LABELS, type RuleConfig } from "./config";
import { handicapBounds } from "./handicap";
import { maxMatchupPoints } from "./scoring";

export interface RuleSection {
  id: string;
  title: string;
  items: { label: string; value: string; note?: string }[];
}

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
const pts = (x: number, unit: string) => `${n(x)} ${unit}${x === 1 ? "" : "s"}`;

/** Plain-language description of a rule configuration. Generated from the saved settings, never hand-written. */
export function describeRules(cfg: RuleConfig): RuleSection[] {
  const s = cfg.scoring;
  const h = cfg.handicap;
  const g = s.gamesPerSession;
  const basis = s.basis === "handicap" && h.enabled ? "handicap-adjusted" : "scratch";
  const sections: RuleSection[] = [];

  sections.push({
    id: "format", title: "Format",
    items: [
      { label: "Competition", value: cfg.format === "team" ? "Team vs. team" : cfg.format === "individual" ? "Bowler vs. bowler" : "Team vs. team, with an individual competition inside each team matchup" },
      ...(cfg.format !== "individual" ? [{ label: "Team size", value: `${cfg.bowlersPerTeam} bowler${cfg.bowlersPerTeam === 1 ? "" : "s"}`, note: cfg.allowSubstitutes ? "Substitutes are allowed." : "Substitutes are not allowed." }] : []),
      { label: "Games per night", value: String(g) },
      { label: "Schedule", value: cfg.scheduleFormat === "round_robin" ? "Round robin" : cfg.scheduleFormat === "double_round_robin" ? "Double round robin" : "Built by hand by the commissioner" },
    ],
  });

  sections.push({
    id: "scoring", title: "Scoring & points",
    items: [
      { label: "Games are decided on", value: `${basis} pins`, note: basis === "scratch" ? (h.enabled ? "Handicap is calculated but not used to decide results." : "No handicap is used.") : "Each bowler's score plus their handicap." },
      { label: "Each game", value: `Winner earns ${pts(s.pointsPerGame, "point")}`, note: `A tied game gives each side ${n(s.pointsPerGame * s.tieFraction)}.` },
      { label: "Series (all ${g} games)".replace("${g}", String(g)), value: `Winner of the combined ${basis} pins earns ${pts(s.pointsPerSeries, "point")}`, note: `A tied series gives each side ${n(s.pointsPerSeries * s.tieFraction)}.` },
      ...(s.bonus.highGame || s.bonus.highSeries ? [{ label: "Bonus points", value: [s.bonus.highGame ? `${pts(s.bonus.highGame, "point")} for the side with the highest single game` : "", s.bonus.highSeries ? `${pts(s.bonus.highSeries, "point")} for the highest individual series` : ""].filter(Boolean).join("; ") }] : []),
      ...(cfg.format === "both" ? [{ label: "Individual competition", value: `Each bowler faces the matching bowler on the other team: ${pts(s.individual.pointsPerGame, "point")} per game, ${pts(s.individual.pointsPerSeries, "point")} for the series.` }] : []),
      { label: "Maximum points per matchup", value: n(maxMatchupPoints(cfg)) },
      { label: "Matchup win/loss is decided by", value: s.matchupWinnerBy === "points" ? "Most points earned in the matchup" : "The series total" },
      { label: "Valid game scores", value: `${s.minGameScore}–${s.maxGameScore}`, note: `Entries more than ${s.suspiciousDeviation} pins from a bowler's average are flagged for review.` },
    ],
  });

  sections.push({
    id: "situations", title: "Absences, forfeits & incomplete games",
    items: [
      { label: "Absent bowler", value: s.absentPolicy === "none" ? "Scores nothing" : s.blindMode === "fixed" ? `Blind score of ${s.blindFixed} per game` : `Blind score: their average minus ${s.blindOffset}` },
      { label: "Forfeit", value: s.forfeitPoints === "max_to_opponent" ? "Opponent receives the maximum points" : "No points are awarded" },
      { label: "Incomplete games", value: s.incompletePolicy === "block_finalize" ? "A matchup can't be finalized until every score is entered" : "Finalizing is allowed; only fully-scored games count" },
      { label: "Bye week", value: `${pts(s.byePoints, "point")}` },
    ],
  });

  if (h.enabled) {
    const { min, max } = handicapBounds(h);
    sections.push({
      id: "handicap", title: "Handicap",
      items: [
        { label: "Formula", value: `${h.rounding === "nearest" ? "Round" : h.rounding === "floor" ? "Round down" : h.rounding === "ceil" ? "Round up" : "Truncate"}((base − average) × ${n(h.percentage)}%)`, note: `Example: (${h.baseValue} − 160) × ${n(h.percentage)}% = ${Math.max(0, Math.round((h.baseValue - 160) * h.percentage) / 100)}` },
        { label: "Base average", value: h.baseMode === "fixed" ? `${h.baseValue} (fixed)` : h.baseMode === "league_average" ? `League average each week (${h.baseValue} until averages exist)` : `Highest bowler average each week (${h.baseValue} until averages exist)` },
        { label: "Average used", value: h.averageSource === "entering" ? "Always the entering average" : `Entering average until ${h.establishAfterGames} games are bowled, then the ${h.averageMethod === "cumulative" ? "season average" : h.averageMethod === "rolling" ? `average of the last ${h.rollingGames} games` : `season average blended with the entering average (counted as ${h.blendGames} games)`}` },
        { label: "Average rounding", value: h.averageRounding === "none" ? "Not rounded" : h.averageRounding === "floor" ? "Rounded down before use" : "Rounded to nearest before use" },
        { label: "Limits", value: `${h.allowNegative ? (min === -Infinity ? "No minimum" : `Minimum ${min}`) : `Minimum ${min} (no negative handicaps)`}; ${max === Infinity ? "no maximum" : `maximum ${max}`}` },
        { label: "New bowlers", value: h.newBowlerPolicy === "no_handicap" ? "No handicap until established" : h.newBowlerPolicy === "fixed_average" ? `Treated as a ${h.newBowlerAverage} average` : "Use the average of games bowled so far" },
        { label: "Substitutes", value: h.subPolicy === "own_average" ? "Use their own average" : h.subPolicy === "fixed_average" ? `Treated as a ${h.subAverage} average` : "No handicap" },
        { label: "Updated", value: h.recalcEveryWeeks === 1 ? "Every week, from all finalized earlier weeks" : `Every ${h.recalcEveryWeeks} weeks` },
        { label: "Finalized results", value: h.lockMode === "locked" ? "Handicaps are locked at finalization and never change retroactively" : "Recomputed from source scores if earlier scores are corrected" },
      ],
    });
  } else sections.push({ id: "handicap", title: "Handicap", items: [{ label: "Handicap", value: "Not used — everyone bowls scratch." }] });

  sections.push({
    id: "standings", title: "Standings & tie-breakers",
    items: [
      { label: "Ranked by", value: cfg.standings.tiebreakers.map((t) => TIEBREAKER_LABELS[t]).join(" → "), note: "Teams still level after every criterion are listed alphabetically." },
      { label: "Pins counted", value: cfg.standings.pinsBasis === "handicap" ? "Handicap-adjusted" : "Scratch" },
      { label: "Unfinalized scores", value: cfg.standings.includeProvisional ? "Included as provisional" : "Not counted until finalized" },
    ],
  });

  sections.push({
    id: "playoffs", title: "Playoffs",
    items: cfg.playoffs.enabled
      ? [
          { label: "Qualifying", value: `Top ${cfg.playoffs.qualifiers} in the standings, seeded by rank` },
          { label: "Format", value: `Single elimination over up to ${cfg.playoffs.weeks} week${cfg.playoffs.weeks === 1 ? "" : "s"}; top seeds get byes when the field isn't a power of two` },
          { label: "Level on points", value: cfg.playoffs.tiebreak === "series_then_seed" ? "The series-total winner advances, then the higher seed" : "The higher seed advances" },
          ...(cfg.playoffs.gamesPerSession != null || cfg.playoffs.basis != null || cfg.playoffs.pointsPerGame != null ? [{ label: "Playoff scoring", value: "Uses its own overrides (games, basis or points) instead of regular-season values" }] : []),
        ]
      : [{ label: "Playoffs", value: "None — the regular-season leader wins the title." }],
  });

  sections.push({
    id: "records", title: "Records & eligibility",
    items: [
      { label: "Awards need", value: `${cfg.eligibility.minGamesForAwards} games bowled` },
      { label: "Substitutes in records", value: cfg.eligibility.subsCountForRecords ? "Eligible" : "Not eligible" },
      { label: "Records", value: cfg.recordsCarryOver ? "Carry across seasons" : "Reset each season" },
    ],
  });
  return sections;
}
