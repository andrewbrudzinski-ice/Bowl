import { usesPartners } from "./config";
import { defaultLineup, type SeasonModel } from "./engine";
import { weekRecap } from "./narrative";
import type { MatchupResult } from "./scoring";
import { computeStandings, standingsScope, type StandingRow } from "./standings";
import type { Id, Week } from "./types";

/**
 * Everything on a league's weekly sheet, as plain data: the printed page league secretaries hand out before each night. It holds last week's
 * results, the standings, this week's matchups with the handicaps bowlers will use, and every bowler's average and handicap with how they
 * changed. Nothing here is stored; it is all worked out from the season's finalized scores, so the sheet is always current.
 */

export interface SheetBowler {
  bowlerId: Id;
  name: string;
  average: number | null;
  handicap: number;
  isSub: boolean;
}

export interface SheetSide {
  id: Id;
  name: string;
  lineup: SheetBowler[];
  /** Win-loss(-tie) entering the week, for leagues with standing teams or individuals. */
  record: string | null;
  rank: number | null;
}

export type SheetMatchKind = "match" | "extra" | "bye";

export interface SheetMatch {
  matchupId: Id;
  /** A bye is someone sitting out; an extra comparison (rotating partners) is a pair bowling against another pair's scores. */
  kind: SheetMatchKind;
  a: SheetSide;
  b: SheetSide | null;
}

export interface SheetBowlerRow {
  bowlerId: Id;
  name: string;
  teamName: string | null;
  isSub: boolean;
  /** Games and highs are through the previous week. */
  games: number;
  highGame: number | null;
  highSeries: number | null;
  /** The average the week's handicap is worked from. */
  average: number | null;
  /** Change from the average they entered the previous week with; null when there is nothing to compare. */
  averageChange: number | null;
  handicap: number;
  handicapChange: number | null;
}

export interface SheetPrevious {
  week: number;
  date: string;
  settingWeek: boolean;
  results: MatchupResult[];
  /** Matchups of that week still not final (they are left off the sheet). */
  notFinal: number;
  highGame: { name: string; score: number }[];
  topSeries: { name: string; score: number }[];
  headlines: string[];
}

export interface SheetUpcoming {
  week: number;
  date: string;
  phase: Week["phase"];
  label: string;
  postponed: boolean;
  matches: { a: string; b: string | null; extra: boolean }[];
}

export interface WeeklySheet {
  week: number;
  date: string;
  phase: Week["phase"];
  label: string;
  /** Bowled scratch to set handicaps; counts toward averages only. */
  settingWeek: boolean;
  /** Whether handicaps are applied this week. */
  handicapOn: boolean;
  partners: boolean;
  previous: SheetPrevious | null;
  /** Standings entering this week; null until a week that counts has been bowled. */
  standings: StandingRow[] | null;
  standingsFor: "team" | "bowler";
  /** How many qualify for the playoffs, when the league has them: the standings draw a line there. */
  qualifiers: number | null;
  matchups: SheetMatch[];
  bowlers: SheetBowlerRow[];
  upcoming: SheetUpcoming[];
}

const recordText = (r: StandingRow) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`;
const round1 = (n: number) => Math.round(n * 10) / 10;
const once = <T extends { bowlerId: Id }>(xs: T[]): T[] => [...new Map(xs.map((x) => [x.bowlerId, x])).values()];

/** How many following weeks the sheet previews. */
export const UPCOMING_WEEKS = 2;

export function buildWeeklySheet(model: SeasonModel, week: number): WeeklySheet | null {
  const w = model.weekByNumber.get(week);
  if (!w) return null;
  const cfg = model.configForWeek(week);
  const partners = usesPartners(cfg);
  const scope = standingsScope(cfg);
  const settingWeek = model.isSettingWeek(week);

  const nameOf = (matchKind: "team" | "individual", id: Id) =>
    matchKind === "team" ? (model.teamById.get(id)?.name ?? "Unknown team") : (model.bowlerById.get(id)?.name ?? "Unknown bowler");

  // Standings entering this week.
  const rows = week > 1 ? computeStandings(model, { scope, throughWeek: week - 1 }).rows : [];
  const counted = rows.some((r) => r.played > 0);
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // Last week: the most recent earlier week with a final result.
  const prevWeek = Math.max(0, ...model.results.filter((r) => r.official && !r.isBye && r.weekNumber < week).map((r) => r.weekNumber));
  let previous: SheetPrevious | null = null;
  if (prevWeek > 0) {
    const all = model.results.filter((r) => r.weekNumber === prevWeek);
    const recap = weekRecap(model, prevWeek);
    const name = (id: Id) => model.bowlerById.get(id)?.name ?? "Unknown bowler";
    previous = {
      week: prevWeek,
      date: model.weekByNumber.get(prevWeek)?.date ?? "",
      settingWeek: model.isSettingWeek(prevWeek),
      results: all.filter((r) => r.official || r.isBye),
      notFinal: all.filter((r) => !r.official && !r.isBye).length,
      // A bowler who matched the best game in several games, or the best series, is named once.
      highGame: once(recap.highGame).map((h) => ({ name: name(h.bowlerId), score: h.score })),
      topSeries: once(recap.topSeries).map((s) => ({ name: name(s.bowlerId), score: s.scratchSeries })),
      headlines: recap.headlines.slice(0, 4).map((h) => h.text),
    };
  }

  // This week's matchups: bowlers come from the matchup, or from the team's usual lineup until one is entered.
  const side = (r: MatchupResult, which: "a" | "b"): SheetSide => {
    const s = r[which]!;
    const kind = r.matchup.kind;
    const ids = s.lineup.length ? s.lineup.map((l) => l.bowlerId) : kind === "team" ? defaultLineup(model.data, s.participantId, week, cfg.bowlersPerTeam) : [s.participantId];
    const row = rowById.get(s.participantId);
    return {
      id: s.participantId,
      name: nameOf(kind, s.participantId),
      record: row ? recordText(row) : null,
      rank: row?.rank ?? null,
      lineup: ids.map((id) => {
        const line = s.lineup.find((l) => l.bowlerId === id);
        const hc = line ? null : model.handicapAt(id, week);
        return {
          bowlerId: id,
          name: model.bowlerById.get(id)?.name ?? "Unknown bowler",
          average: line ? line.average : hc!.average.average,
          handicap: line ? line.handicap : hc!.breakdown.handicap,
          isSub: line ? line.isSub : hc!.isSub,
        };
      }),
    };
  };
  const rs = model.results.filter((r) => r.weekNumber === week);
  const matchups: SheetMatch[] = [
    ...rs.filter((r) => r.b && !r.guest).map((r) => ({ matchupId: r.matchup.id, kind: "match" as const, a: side(r, "a"), b: side(r, "b") })),
    ...rs.filter((r) => r.guest).map((r) => ({ matchupId: r.matchup.id, kind: "extra" as const, a: side(r, "a"), b: side(r, "b") })),
    ...rs.filter((r) => r.isBye).map((r) => ({ matchupId: r.matchup.id, kind: "bye" as const, a: side(r, "a"), b: null })),
  ];

  // Every bowler's average and handicap going into the week, and how they moved from the week before.
  const entering = (id: Id) => {
    const games = (model.officialGames.get(id) ?? []).filter((g) => g.week < week);
    const byNight = new Map<Id, number>();
    for (const g of games) byNight.set(g.matchupId, (byNight.get(g.matchupId) ?? 0) + g.scratch);
    return {
      games: games.length,
      highGame: games.length ? Math.max(...games.map((g) => g.scratch)) : null,
      highSeries: byNight.size ? Math.max(...byNight.values()) : null,
    };
  };
  const ids = [...new Set(model.data.roster.map((r) => r.bowlerId))].filter((id) => {
    const b = model.bowlerById.get(id);
    if (!b || b.active === false || !model.rosterAt(id, week)) return false;
    // Substitutes are listed once they have bowled.
    return !model.rosterAt(id, week)!.isSub || (model.officialGames.get(id)?.length ?? 0) > 0;
  });
  const bowlers: SheetBowlerRow[] = ids.map((id) => {
    const hc = model.handicapAt(id, week);
    const before = week > 1 ? model.handicapAt(id, week - 1) : null;
    const teamId = partners ? null : model.teamOf(id, week);
    const average = hc.average.average;
    const handicapChange = before && !settingWeek && !model.isSettingWeek(week - 1) ? hc.breakdown.handicap - before.breakdown.handicap : null;
    return {
      bowlerId: id,
      name: model.bowlerById.get(id)!.name,
      teamName: teamId ? (model.teamById.get(teamId)?.name ?? null) : null,
      isSub: hc.isSub,
      ...entering(id),
      average,
      averageChange: before && average != null && before.average.average != null ? round1(average - before.average.average) : null,
      handicap: hc.breakdown.handicap,
      handicapChange,
    };
  });
  bowlers.sort((a, b) => (a.teamName ?? "").localeCompare(b.teamName ?? "") || a.name.localeCompare(b.name));

  const upcoming: SheetUpcoming[] = model.data.weeks
    .filter((x) => x.number > week)
    .sort((a, b) => a.number - b.number)
    .slice(0, UPCOMING_WEEKS)
    .map((x) => ({
      week: x.number,
      date: x.date,
      phase: x.phase,
      label: x.label,
      postponed: x.status === "postponed",
      matches: model.results
        .filter((r) => r.weekNumber === x.number && !r.isBye)
        .map((r) => ({ a: nameOf(r.matchup.kind, r.a.participantId), b: r.b ? nameOf(r.matchup.kind, r.b.participantId) : null, extra: r.guest })),
    }));

  return {
    week,
    date: w.date,
    phase: w.phase,
    label: w.label,
    settingWeek,
    handicapOn: cfg.handicap.enabled,
    partners,
    previous,
    standings: counted ? rows : null,
    standingsFor: scope,
    qualifiers: cfg.playoffs.enabled ? cfg.playoffs.qualifiers : null,
    matchups,
    bowlers,
    upcoming,
  };
}
