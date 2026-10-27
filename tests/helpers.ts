import { DEFAULT_CONFIG, normalizeConfig, type RuleConfig } from "@/domain/config";
import type { SeasonData } from "@/domain/engine";
import type { Bowler, Matchup, ResultState, RosterEntry, Score, Season, Team, Week } from "@/domain/types";

let n = 0;
export const uid = (p: string) => `${p}${++n}`;

export function cfgWith(patch: (c: RuleConfig) => void): RuleConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  patch(c);
  return normalizeConfig(c);
}

export interface Fixture {
  data: SeasonData;
  teams: Team[];
  bowlers: Bowler[];
  addMatchup(week: number, aTeam: string, bTeam: string | null, scores: { A: number[][]; B?: number[][] }, state?: ResultState, extra?: Partial<Matchup>): Matchup;
}

/** teams × bowlersPerTeam, each bowler with the given entering average. */
export function fixture(opts: { teams?: number; perTeam?: number; weeks?: number; config?: RuleConfig; entering?: number | null } = {}): Fixture {
  const T = opts.teams ?? 4;
  const P = opts.perTeam ?? 3;
  const weekCount = opts.weeks ?? 6;
  const config = opts.config ?? DEFAULT_CONFIG;
  const season: Season = {
    id: uid("s"), leagueId: "L1", slug: "2026", name: "Test", year: 2026, startDate: "2026-01-06",
    regularWeeks: weekCount, status: "active", championId: null, isDemo: false, createdAt: "2026-01-01T00:00:00Z",
    ruleVersions: [{ version: 1, effectiveFromWeek: 1, config, createdAt: "2026-01-01T00:00:00Z", createdBy: "u1", reason: "Initial" }],
  };
  const teams: Team[] = [];
  const bowlers: Bowler[] = [];
  const roster: RosterEntry[] = [];
  for (let t = 0; t < T; t++) {
    const team: Team = { id: `T${t + 1}`, leagueId: "L1", name: `Team ${String.fromCharCode(65 + t)}`, shortName: String.fromCharCode(65 + t), color: "#888", logo: "A", active: true, isDemo: false };
    teams.push(team);
    for (let p = 0; p < P; p++) {
      const b: Bowler = { id: `B${t + 1}${p + 1}`, leagueId: "L1", name: `Bowler ${t + 1}.${p + 1}`, nickname: "", avatarColor: "#444", avatarUrl: null, active: true, userId: null, notes: "", isDemo: false, createdAt: "2026-01-01T00:00:00Z" };
      bowlers.push(b);
      roster.push({ id: `R${b.id}`, seasonId: season.id, bowlerId: b.id, teamId: team.id, enteringAverage: opts.entering === undefined ? 160 : opts.entering, isSub: false, fromWeek: 1, toWeek: null });
    }
  }
  const weeks: Week[] = Array.from({ length: weekCount }, (_, i) => ({
    id: `W${i + 1}`, seasonId: season.id, number: i + 1, date: `2026-01-${String(6 + i * 7).padStart(2, "0")}`, status: "scheduled", phase: "regular", label: "",
  }));
  const data: SeasonData = { season, teams, bowlers, roster, weeks, matchups: [], scores: [] };
  const fx: Fixture = {
    data, teams, bowlers,
    addMatchup(week, aTeam, bTeam, scores, state = "finalized", extra = {}) {
      const id = uid("M");
      const lineup = (team: string | null) => (team ? data.roster.filter((r) => r.teamId === team).map((r) => r.bowlerId) : []);
      const m: Matchup = {
        id, seasonId: season.id, weekNumber: week, kind: "team", sideA: aTeam, sideB: bTeam,
        lineupA: lineup(aTeam), lineupB: lineup(bTeam), state, forfeitBy: null, ruleVersion: null, handicapSnapshot: null,
        playoffRound: null, notes: "", revision: 1, finalizedAt: null, finalizedBy: null, updatedAt: "2026-01-01T00:00:00Z", updatedBy: "u1", isDemo: false, ...extra,
      };
      data.matchups.push(m);
      const put = (side: "A" | "B", rows: number[][] | undefined, ids: string[]) => {
        (rows ?? []).forEach((games, bi) =>
          games.forEach((scratch, gi) =>
            data.scores.push({ id: uid("S"), matchupId: id, bowlerId: ids[bi], side, game: gi + 1, scratch, kind: "bowled", updatedAt: "", updatedBy: "u1" } as Score)
          )
        );
      };
      put("A", scores.A, m.lineupA);
      put("B", scores.B, m.lineupB);
      return m;
    },
  };
  return fx;
}
