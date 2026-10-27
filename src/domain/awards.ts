import type { SeasonModel } from "./engine";
import { computeStandings, playoffAdvancer, type StandingRow } from "./standings";
import { bowlerSeasonStats, collectNights, collectTeamNights, improvement, topWithTies, winStreaks, type BowlerSeasonStats } from "./stats";
import type { AwardsConfig, Id } from "./types";
import { isOfficial } from "./types";

export interface AwardParam {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
}
export interface AwardDef {
  id: string;
  name: string;
  scope: "week" | "season";
  description: string;
  /** Plain-language eligibility + tie rules, shown next to the award. */
  qualification: string;
  params: AwardParam[];
}

export const AWARD_DEFS: AwardDef[] = [
  {
    id: "bowler_of_week", name: "Bowler of the Week", scope: "week",
    description: "Most pins over their own average for the night.",
    qualification: "Series scratch pins minus (games bowled × the bowler's average entering the week). Bowlers need an established or entering average and at least the minimum games in the week. Ties are shared.",
    params: [{ key: "minGames", label: "Minimum games in the week", default: 3, min: 1, max: 10 }],
  },
  {
    id: "high_game", name: "Highest Game", scope: "week",
    description: "Best single scratch game.", qualification: "Highest scratch game in the period. Blind and absent scores are never eligible. Ties are shared.", params: [],
  },
  {
    id: "high_series", name: "Highest Series", scope: "week",
    description: "Best scratch series.", qualification: "Highest scratch series of fully bowled games in the period. Ties are shared.", params: [],
  },
  {
    id: "high_game_hdcp", name: "Highest Handicap Game", scope: "week",
    description: "Best handicap-adjusted game.", qualification: "Scratch score plus the handicap in force for that match. Ties are shared.", params: [],
  },
  {
    id: "high_series_hdcp", name: "Highest Handicap Series", scope: "week",
    description: "Best handicap-adjusted series.", qualification: "Scratch series plus handicap for each game. Ties are shared.", params: [],
  },
  {
    id: "closest_matchup", name: "Closest Matchup", scope: "week",
    description: "Smallest margin in a completed, non-forfeited matchup.", qualification: "Smallest absolute series margin on the league's scoring basis among decided matchups. Ties are shared.", params: [],
  },
  {
    id: "biggest_upset", name: "Biggest Upset", scope: "week",
    description: "A win by the team with the lower combined scratch average.", qualification: "Among matchups won by the side with the lower combined entering scratch average, the largest average gap. Requires averages on both sides.", params: [],
  },
  {
    id: "best_team_performance", name: "Best Team Performance", scope: "week",
    description: "Best team series.", qualification: "Highest team scratch series in the period. Ties are shared.", params: [],
  },
  {
    id: "most_improved", name: "Most Improved Average", scope: "season",
    description: "Biggest rise of recent form over an established baseline.", qualification:
      "Average of the latest N games minus the baseline (average of earlier games, or the entering average if there are fewer than N earlier games). Requires at least the minimum games so one big game cannot win it.",
    params: [
      { key: "window", label: "Games in the recent window", default: 6, min: 3, max: 30 },
      { key: "minGames", label: "Minimum games bowled", default: 9, min: 3, max: 100 },
    ],
  },
  {
    id: "most_consistent", name: "Most Consistent Bowler", scope: "season",
    description: "Lowest spread between game scores.", qualification: "Lowest sample standard deviation of scratch game scores, with the minimum number of games. Ties are shared.",
    params: [{ key: "minGames", label: "Minimum games bowled", default: 9, min: 3, max: 100 }],
  },
  {
    id: "longest_win_streak", name: "Longest Winning Streak", scope: "season",
    description: "Most consecutive matchup wins.", qualification: "Consecutive official wins; a tie or loss ends a streak. Ties between holders are shared.", params: [],
  },
  {
    id: "season_mvp", name: "Season MVP", scope: "season",
    description: "Most total pins over average across the season.", qualification: "Sum over every night of (scratch series − games × average entering that night). Rewards sustained output above personal expectation; minimum games apply.",
    params: [{ key: "minGames", label: "Minimum games bowled", default: 9, min: 3, max: 100 }],
  },
  {
    id: "league_champion", name: "League Champion", scope: "season",
    description: "Winner of the season.", qualification: "The playoff final winner when playoffs are played; otherwise the first-place team after the regular season once the season is marked complete.", params: [],
  },
];

export function defaultAwardsConfig(): AwardsConfig {
  return Object.fromEntries(
    AWARD_DEFS.map((d) => [d.id, { enabled: true, params: Object.fromEntries(d.params.map((p) => [p.key, p.default])) }])
  );
}

export interface AwardWinner {
  kind: "bowler" | "team";
  id: Id;
  name: string;
  detail: string;
  week?: number;
  matchupId?: Id;
}
export interface AwardResult {
  id: string;
  name: string;
  scope: "week" | "season";
  week: number | null;
  winners: AwardWinner[];
  /** Short supporting line shown with the award. */
  summary: string;
  qualification: string;
  source: "statistical" | "commissioner";
}

export interface CommissionerAward {
  id: Id;
  title: string;
  recipientKind: "bowler" | "team";
  recipientId: Id;
  note: string;
  week: number | null;
}

function paramsOf(cfg: AwardsConfig, def: AwardDef): Record<string, number> {
  const stored = cfg[def.id]?.params ?? {};
  return Object.fromEntries(def.params.map((p) => [p.key, stored[p.key] ?? p.default]));
}

export function championOf(model: SeasonModel): { kind: "team" | "bowler"; id: Id; name: string; how: string } | null {
  const kind = model.configForWeek(1).format === "individual" ? "bowler" : "team";
  const nameOf = (id: Id) => (kind === "team" ? model.teamById.get(id)?.name : model.bowlerById.get(id)?.name) ?? "Unknown";
  const cfg = model.configForWeek(1);
  if (cfg.playoffs.enabled) {
    const playoff = model.results.filter((r) => model.weekByNumber.get(r.weekNumber)?.phase === "playoff" && !r.isBye && isOfficial(r.matchup.state));
    if (playoff.length) {
      const lastWeek = Math.max(...playoff.map((r) => r.weekNumber));
      const finals = playoff.filter((r) => r.weekNumber === lastWeek);
      const side = finals.length === 1 ? playoffAdvancer(finals[0], cfg) : null;
      if (side) {
        const id = side === "A" ? finals[0].a.participantId : finals[0].b!.participantId;
        return { kind, id, name: nameOf(id), how: `Won the playoff final in week ${lastWeek}` };
      }
      // A playoff is under way but not decided: no champion yet, regardless of any stored value.
      return null;
    }
  }
  if (model.data.season.championId) {
    const id = model.data.season.championId;
    return { kind, id, name: nameOf(id), how: "Recorded by the commissioner" };
  }
  if (model.data.season.status === "completed") {
    const { rows } = computeStandings(model, { scope: kind === "team" ? "team" : "bowler" });
    if (rows[0]) return { kind, id: rows[0].id, name: rows[0].name, how: "First place after the regular season" };
  }
  return null;
}

/**
 * Computes statistical awards from recorded results. Disabled awards are skipped; commissioner-chosen awards are
 * appended and clearly labelled as such rather than presented as statistical results.
 */
export function computeAwards(
  model: SeasonModel,
  config: AwardsConfig,
  opts: { week?: number; commissioner?: CommissionerAward[]; stats?: BowlerSeasonStats[] } = {}
): AwardResult[] {
  const out: AwardResult[] = [];
  const nights = collectNights(model);
  const teamNights = collectTeamNights(model);
  const stats = opts.stats ?? bowlerSeasonStats(model, nights);
  const week = opts.week ?? null;
  const inScope = <T extends { week: number }>(xs: T[], scope: "week" | "season") => (scope === "week" && week != null ? xs.filter((x) => x.week === week) : xs);
  const enabled = (id: string) => config[id]?.enabled !== false;
  const tName = (id: Id) => model.teamById.get(id)?.name ?? "Unknown team";
  const bName = (id: Id) => model.bowlerById.get(id)?.name ?? "Unknown bowler";
  const push = (def: AwardDef, scopeWeek: number | null, winners: AwardWinner[], summary: string) => {
    if (!winners.length) return;
    out.push({ id: def.id, name: def.name, scope: def.scope, week: scopeWeek, winners, summary, qualification: def.qualification, source: "statistical" });
  };

  for (const def of AWARD_DEFS) {
    if (!enabled(def.id)) continue;
    const params = paramsOf(config, def);
    // Single-week awards are produced for the requested week, or for the whole season when no week is given.
    const periodWeek = def.scope === "week" ? week : null;
    const nightsIn = def.scope === "week" ? inScope(nights, "week") : nights;
    const label = periodWeek != null ? `Week ${periodWeek}` : "Season";

    switch (def.id) {
      case "bowler_of_week": {
        if (periodWeek == null) break;
        const cand = nightsIn
          .filter((n) => n.games.length >= params.minGames && n.average != null)
          .map((n) => ({ n, over: n.scratchSeries - n.games.length * n.average! }));
        const top = topWithTies(cand, (c) => c.over);
        if (top && top.value > 0)
          push(def, periodWeek, top.holders.map((h) => ({ kind: "bowler", id: h.n.bowlerId, name: bName(h.n.bowlerId), week: h.n.week, matchupId: h.n.matchupId, detail: `${h.n.scratchSeries} series, ${h.over >= 0 ? "+" : ""}${Math.round(h.over)} pins over a ${h.n.average} average` })), `Best night relative to average in week ${periodWeek}`);
        break;
      }
      case "high_game": {
        const games = nightsIn.flatMap((n) => n.games.map((g) => ({ n, g })));
        const top = topWithTies(games, (x) => x.g.scratch);
        if (top) push(def, periodWeek, top.holders.map((h) => ({ kind: "bowler", id: h.n.bowlerId, name: bName(h.n.bowlerId), week: h.n.week, matchupId: h.n.matchupId, detail: `${h.g.scratch} in game ${h.g.game} (week ${h.n.week})` })), `${label}: ${top.value}`);
        break;
      }
      case "high_series": {
        const full = nightsIn.filter((n) => n.games.length === model.configForWeek(n.week).scoring.gamesPerSession);
        const top = topWithTies(full, (n) => n.scratchSeries);
        if (top) push(def, periodWeek, top.holders.map((n) => ({ kind: "bowler", id: n.bowlerId, name: bName(n.bowlerId), week: n.week, matchupId: n.matchupId, detail: `${n.games.map((g) => g.scratch).join("-")} = ${n.scratchSeries} (week ${n.week})` })), `${label}: ${top.value}`);
        break;
      }
      case "high_game_hdcp": {
        const games = nightsIn.flatMap((n) => n.games.map((g) => ({ n, g })));
        const top = topWithTies(games, (x) => x.g.adjusted);
        if (top) push(def, periodWeek, top.holders.map((h) => ({ kind: "bowler", id: h.n.bowlerId, name: bName(h.n.bowlerId), week: h.n.week, matchupId: h.n.matchupId, detail: `${h.g.adjusted} (${h.g.scratch} + ${h.g.handicap} handicap, week ${h.n.week})` })), `${label}: ${top.value}`);
        break;
      }
      case "high_series_hdcp": {
        const full = nightsIn.filter((n) => n.games.length === model.configForWeek(n.week).scoring.gamesPerSession);
        const top = topWithTies(full, (n) => n.adjustedSeries);
        if (top) push(def, periodWeek, top.holders.map((n) => ({ kind: "bowler", id: n.bowlerId, name: bName(n.bowlerId), week: n.week, matchupId: n.matchupId, detail: `${n.adjustedSeries} (${n.scratchSeries} scratch + ${n.adjustedSeries - n.scratchSeries} handicap, week ${n.week})` })), `${label}: ${top.value}`);
        break;
      }
      case "closest_matchup": {
        const rs = model.results.filter((r) => r.official && !r.isBye && !r.forfeitBy && r.complete && r.margin != null && r.winner && r.winner !== "tie" && (periodWeek == null || r.weekNumber === periodWeek));
        const top = topWithTies(rs, (r) => r.margin, "min");
        if (top) push(def, periodWeek, top.holders.map((r) => ({ kind: r.matchup.kind === "team" ? "team" : "bowler", id: r.winner === "A" ? r.a.participantId : r.b!.participantId, name: `${nameForParticipant(model, r.a.participantId, r.matchup.kind)} vs ${nameForParticipant(model, r.b!.participantId, r.matchup.kind)}`, week: r.weekNumber, matchupId: r.matchup.id, detail: `Decided by ${r.margin} pin${r.margin === 1 ? "" : "s"} (week ${r.weekNumber})` })), `${label}: ${top.value} pins`);
        break;
      }
      case "biggest_upset": {
        const ups: { r: (typeof model.results)[number]; gap: number }[] = [];
        for (const r of model.results) {
          if (!r.official || r.isBye || r.forfeitBy || !r.winner || r.winner === "tie") continue;
          if (periodWeek != null && r.weekNumber !== periodWeek) continue;
          const avgSum = (side: typeof r.a) => {
            const avs = side.lineup.map((l) => l.average);
            return avs.every((a) => a != null) && avs.length ? avs.reduce((x, y) => x! + y!, 0)! : null;
          };
          const aa = avgSum(r.a);
          const bb = avgSum(r.b!);
          if (aa == null || bb == null) continue;
          const winnerAvg = r.winner === "A" ? aa : bb;
          const loserAvg = r.winner === "A" ? bb : aa;
          if (winnerAvg < loserAvg) ups.push({ r, gap: loserAvg - winnerAvg });
        }
        const top = topWithTies(ups, (u) => u.gap);
        if (top) push(def, periodWeek, top.holders.map(({ r, gap }) => ({ kind: r.matchup.kind === "team" ? "team" : "bowler", id: r.winner === "A" ? r.a.participantId : r.b!.participantId, name: nameForParticipant(model, r.winner === "A" ? r.a.participantId : r.b!.participantId, r.matchup.kind), week: r.weekNumber, matchupId: r.matchup.id, detail: `Won in week ${r.weekNumber} with a combined average ${gap} pins lower than the opponent's` })), `${label}: ${top.value}-pin average gap`);
        break;
      }
      case "best_team_performance": {
        const tn = teamNights.filter((t) => periodWeek == null || t.week === periodWeek);
        const top = topWithTies(tn, (t) => t.scratchSeries);
        if (top) push(def, periodWeek, top.holders.map((t) => ({ kind: "team", id: t.teamId, name: tName(t.teamId), week: t.week, matchupId: t.matchupId, detail: `${t.scratchSeries} scratch series (${t.gameScratch.join("-")}), week ${t.week}` })), `${label}: ${top.value}`);
        break;
      }
      case "most_improved": {
        const elig = stats.map((s) => improvement(s, { window: params.window, minGames: params.minGames })).filter((x): x is NonNullable<typeof x> => !!x);
        const top = topWithTies(elig, (e) => Math.round(e.delta * 10) / 10);
        if (top && top.value > 0)
          push(def, null, top.holders.map((e) => ({ kind: "bowler", id: e.bowlerId, name: bName(e.bowlerId), detail: `+${(Math.round(e.delta * 10) / 10).toFixed(1)}: last ${e.window} games averaged ${e.recentAverage.toFixed(1)} vs ${e.baselineAverage.toFixed(1)} (${e.baselineSource})` })), `Over at least ${params.minGames} games`);
        break;
      }
      case "most_consistent": {
        const elig = stats.filter((s) => s.games >= params.minGames && s.stdDev != null);
        const top = topWithTies(elig, (s) => Math.round(s.stdDev! * 100) / 100, "min");
        if (top) push(def, null, top.holders.map((s) => ({ kind: "bowler", id: s.bowlerId, name: s.name, detail: `Standard deviation ${s.stdDev!.toFixed(1)} pins over ${s.games} games (average ${s.average!.toFixed(1)})` })), `Lowest spread, minimum ${params.minGames} games`);
        break;
      }
      case "longest_win_streak": {
        const kind = model.configForWeek(1).format === "individual" ? "individual" : "team";
        const streaks = winStreaks(model.results, kind);
        const top = topWithTies(streaks, (s) => s.length);
        if (top && top.value >= 2) push(def, null, top.holders.map((s) => ({ kind: kind === "team" ? "team" : "bowler", id: s.id, name: nameForParticipant(model, s.id, kind), detail: `${s.length} straight wins (weeks ${s.fromWeek}–${s.toWeek})` })), `${top.value} consecutive wins`);
        break;
      }
      case "season_mvp": {
        const rows = stats
          .filter((s) => s.games >= params.minGames)
          .map((s) => ({ s, over: s.nightsLog.reduce((t, n) => (n.average == null ? t : t + n.scratchSeries - n.games.length * n.average), 0) }));
        const top = topWithTies(rows, (r) => Math.round(r.over));
        if (top && top.value > 0) push(def, null, top.holders.map((r) => ({ kind: "bowler", id: r.s.bowlerId, name: r.s.name, detail: `+${Math.round(r.over)} pins over average across ${r.s.nights} nights` })), "Most total pins over personal average");
        break;
      }
      case "league_champion": {
        const c = championOf(model);
        if (c) push(def, null, [{ kind: c.kind, id: c.id, name: c.name, detail: c.how }], c.how);
        break;
      }
    }
  }
  for (const c of opts.commissioner ?? []) {
    if (week != null && c.week != null && c.week !== week) continue;
    out.push({
      id: `commissioner:${c.id}`, name: c.title, scope: c.week != null ? "week" : "season", week: c.week,
      winners: [{ kind: c.recipientKind, id: c.recipientId, name: c.recipientKind === "team" ? tName(c.recipientId) : bName(c.recipientId), detail: c.note }],
      summary: "Commissioner award — chosen by the commissioner, not calculated from scores",
      qualification: "Selected by the league commissioner.", source: "commissioner",
    });
  }
  return out;
}

export function nameForParticipant(model: SeasonModel, id: Id, kind: "team" | "individual"): string {
  return kind === "team" ? (model.teamById.get(id)?.name ?? "Unknown team") : (model.bowlerById.get(id)?.name ?? "Unknown bowler");
}

export type { StandingRow };
