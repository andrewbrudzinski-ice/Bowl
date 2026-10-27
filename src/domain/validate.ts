import type { RuleConfig } from "./config";
import { evaluateMatchup } from "./scoring";
import type { SeasonData, SeasonModel } from "./engine";
import type { Id, Matchup, ScoreKind, Side } from "./types";
import { isOfficial } from "./types";

export interface ScoreInput {
  bowlerId: Id;
  side: Side;
  game: number;
  scratch: number | null;
  kind: ScoreKind;
}

export interface Issue {
  severity: "error" | "warning";
  code:
    | "missing_score"
    | "out_of_range"
    | "not_integer"
    | "suspicious"
    | "perfect_game"
    | "duplicate_matchup"
    | "bowler_double_booked"
    | "wrong_team"
    | "unknown_bowler"
    | "unknown_team"
    | "sub_not_allowed"
    | "lineup_size"
    | "duplicate_score"
    | "bad_game_number"
    | "inconsistent_final"
    | "not_in_lineup"
    | "same_side";
  message: string;
  bowlerId?: Id;
  game?: number;
  side?: Side;
}

/** Validates a matchup's lineup and proposed score entries against the roster, the week and the rules. */
export function validateEntry(
  model: SeasonModel,
  matchup: Matchup,
  scores: ScoreInput[],
  cfg: RuleConfig,
  opts: { forFinalize: boolean }
): Issue[] {
  const issues: Issue[] = [];
  const data = model.data;
  const { scoring } = cfg;
  const add = (i: Issue) => issues.push(i);
  const bowlerName = (id: Id) => model.bowlerById.get(id)?.name ?? id;

  // Participants exist.
  const participantKnown = (id: Id | null) =>
    id == null || (matchup.kind === "team" ? model.teamById.has(id) : model.bowlerById.has(id));
  if (!participantKnown(matchup.sideA) || !participantKnown(matchup.sideB))
    add({ severity: "error", code: "unknown_team", message: "One of the participants no longer exists. Edit the schedule before entering scores." });
  if (matchup.sideB && matchup.sideA === matchup.sideB)
    add({ severity: "error", code: "same_side", message: "A participant cannot play itself." });

  // Duplicate matchups / double booking within the week.
  const sameWeek = data.matchups.filter((m) => m.weekNumber === matchup.weekNumber && m.id !== matchup.id && m.seasonId === matchup.seasonId);
  for (const other of sameWeek) {
    const pair = [matchup.sideA, matchup.sideB].filter(Boolean) as Id[];
    const otherPair = [other.sideA, other.sideB].filter(Boolean) as Id[];
    if (pair.length === 2 && pair.every((p) => otherPair.includes(p)) && otherPair.length === 2)
      add({ severity: "error", code: "duplicate_matchup", message: `This pairing is already scheduled in week ${matchup.weekNumber}. A matchup cannot count twice.` });
    else if (pair.some((p) => otherPair.includes(p)))
      add({ severity: "error", code: "duplicate_matchup", message: `A participant already has another matchup in week ${matchup.weekNumber}.` });
  }

  if (matchup.sideB == null) return issues; // bye

  // Lineup checks.
  for (const side of ["A", "B"] as const) {
    const lineup = side === "A" ? matchup.lineupA : matchup.lineupB;
    const teamId = side === "A" ? matchup.sideA : matchup.sideB!;
    if (new Set(lineup).size !== lineup.length)
      add({ severity: "error", code: "duplicate_score", side, message: "A bowler is listed twice in the same lineup." });
    if (matchup.kind === "team") {
      if (lineup.length > cfg.bowlersPerTeam)
        add({ severity: "error", code: "lineup_size", side, message: `${model.teamById.get(teamId)?.name ?? "Team"} has ${lineup.length} bowlers; this league allows ${cfg.bowlersPerTeam}.` });
      if (lineup.length < cfg.bowlersPerTeam)
        add({ severity: opts.forFinalize && cfg.scoring.absentPolicy === "blind" ? "error" : "warning", code: "lineup_size", side, message: `${model.teamById.get(teamId)?.name ?? "Team"} has only ${lineup.length} of ${cfg.bowlersPerTeam} bowlers in the lineup. Add the missing bowlers and mark them absent if they did not bowl.` });
    }
    for (const id of lineup) {
      if (!model.bowlerById.has(id)) {
        add({ severity: "error", code: "unknown_bowler", bowlerId: id, side, message: `Bowler ${id} does not exist.` });
        continue;
      }
      const entry = model.rosterAt(id, matchup.weekNumber);
      if (!entry) {
        add({ severity: "error", code: "wrong_team", bowlerId: id, side, message: `${bowlerName(id)} is not on this season's roster for week ${matchup.weekNumber}.` });
        continue;
      }
      if (entry.isSub) {
        if (!cfg.allowSubstitutes) add({ severity: "error", code: "sub_not_allowed", bowlerId: id, side, message: `${bowlerName(id)} is a substitute, but this league does not allow substitutes.` });
      } else if (matchup.kind === "team" && entry.teamId !== teamId) {
        const real = entry.teamId ? model.teamById.get(entry.teamId)?.name : "no team";
        add({ severity: "error", code: "wrong_team", bowlerId: id, side, message: `${bowlerName(id)} is rostered with ${real} in week ${matchup.weekNumber}, not ${model.teamById.get(teamId)?.name ?? "this team"}. Mark them as a substitute or fix the roster.` });
      }
      // Bowling twice in the same week
      for (const other of sameWeek) {
        if ([...other.lineupA, ...other.lineupB].includes(id) || (other.kind === "individual" && (other.sideA === id || other.sideB === id)))
          add({ severity: "error", code: "bowler_double_booked", bowlerId: id, message: `${bowlerName(id)} also appears in another week-${matchup.weekNumber} matchup.` });
      }
    }
  }

  // Score-level checks.
  const lineupIds = new Set([...matchup.lineupA, ...matchup.lineupB]);
  const seen = new Set<string>();
  for (const s of scores) {
    const key = `${s.bowlerId}|${s.game}`;
    if (seen.has(key)) add({ severity: "error", code: "duplicate_score", bowlerId: s.bowlerId, game: s.game, message: `Two scores were submitted for ${bowlerName(s.bowlerId)} in game ${s.game}.` });
    seen.add(key);
    if (!lineupIds.has(s.bowlerId)) add({ severity: "error", code: "not_in_lineup", bowlerId: s.bowlerId, game: s.game, message: `${bowlerName(s.bowlerId)} has a score but is not in this matchup's lineup.` });
    if (s.game < 1 || s.game > scoring.gamesPerSession)
      add({ severity: "error", code: "bad_game_number", bowlerId: s.bowlerId, game: s.game, message: `Game ${s.game} is outside this league's ${scoring.gamesPerSession} games per session.` });
    if (s.kind === "bowled" && s.scratch != null) {
      if (!Number.isInteger(s.scratch)) add({ severity: "error", code: "not_integer", bowlerId: s.bowlerId, game: s.game, message: `${bowlerName(s.bowlerId)} game ${s.game}: scores must be whole numbers.` });
      else if (s.scratch < scoring.minGameScore || s.scratch > scoring.maxGameScore)
        add({ severity: "error", code: "out_of_range", bowlerId: s.bowlerId, game: s.game, message: `${bowlerName(s.bowlerId)} game ${s.game}: ${s.scratch} is outside the allowed range ${scoring.minGameScore}–${scoring.maxGameScore}.` });
      else {
        const avg = model.handicapAt(s.bowlerId, matchup.weekNumber).average.average;
        if (s.scratch === 300) add({ severity: "warning", code: "perfect_game", bowlerId: s.bowlerId, game: s.game, message: `${bowlerName(s.bowlerId)} game ${s.game}: a 300 — please confirm.` });
        else if (avg != null && Math.abs(s.scratch - avg) > scoring.suspiciousDeviation)
          add({ severity: "warning", code: "suspicious", bowlerId: s.bowlerId, game: s.game, message: `${bowlerName(s.bowlerId)} game ${s.game}: ${s.scratch} is ${Math.abs(Math.round(s.scratch - avg))} pins ${s.scratch > avg ? "above" : "below"} their ${avg} average.` });
      }
    }
    if (s.kind === "bowled" && s.scratch == null) {
      /* treated as missing below */
    }
  }

  // Missing scores.
  if (!matchup.forfeitBy) {
    const have = new Map(scores.map((s) => [`${s.bowlerId}|${s.game}`, s]));
    for (const side of ["A", "B"] as const) {
      for (const id of side === "A" ? matchup.lineupA : matchup.lineupB) {
        for (let g = 1; g <= scoring.gamesPerSession; g++) {
          const s = have.get(`${id}|${g}`);
          const ok = s && (s.kind === "absent" || s.kind === "forfeit" || (s.kind === "bowled" && s.scratch != null));
          if (!ok) {
            const blocks = opts.forFinalize && scoring.incompletePolicy === "block_finalize";
            add({ severity: blocks ? "error" : "warning", code: "missing_score", bowlerId: id, game: g, side, message: `${bowlerName(id)} is missing game ${g}.` });
          }
        }
      }
    }
    if (!matchup.lineupA.length || !matchup.lineupB.length)
      add({ severity: opts.forFinalize ? "error" : "warning", code: "lineup_size", message: "Both sides need at least one bowler in the lineup." });
  }
  return issues;
}

/** Finds finalized matchups whose stored data no longer supports a final result. */
export function auditConsistency(model: SeasonModel): Issue[] {
  const issues: Issue[] = [];
  const data = model.data;
  const seenPairs = new Map<string, Id>();
  for (const m of data.matchups) {
    const cfg = model.configForWeek(m.weekNumber);
    if (isOfficial(m.state) && m.sideB != null && !m.forfeitBy) {
      const result = evaluateMatchup({
        matchup: m,
        scores: data.scores.filter((s) => s.matchupId === m.id),
        cfg,
        handicaps: {},
      });
      if (!result.complete && cfg.scoring.incompletePolicy === "block_finalize")
        issues.push({ severity: "error", code: "inconsistent_final", message: `Week ${m.weekNumber}: a finalized matchup is missing ${result.missing.length} score(s).` });
      if (m.ruleVersion == null || !m.handicapSnapshot)
        issues.push({ severity: "warning", code: "inconsistent_final", message: `Week ${m.weekNumber}: a finalized matchup has no rule-version / handicap snapshot.` });
    }
    if (m.sideB) {
      const k = `${m.weekNumber}|${[m.sideA, m.sideB].sort().join("|")}`;
      if (seenPairs.has(k)) issues.push({ severity: "error", code: "duplicate_matchup", message: `Week ${m.weekNumber}: the same pairing is scheduled twice.` });
      seenPairs.set(k, m.id);
    }
  }
  return issues;
}

export type { SeasonData };
