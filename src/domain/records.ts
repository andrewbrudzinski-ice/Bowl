import type { SeasonModel } from "./engine";
import { computeStandings } from "./standings";
import { collectNights, collectTeamNights, winStreaks } from "./stats";
import type { Id } from "./types";

export type RecordCategory =
  | "individual_scratch"
  | "individual_handicap"
  | "team"
  | "season"
  | "career"
  | "streaks";

export const RECORD_CATEGORY_LABELS: Record<RecordCategory, string> = {
  individual_scratch: "Individual scratch",
  individual_handicap: "Individual handicap-adjusted",
  team: "Team",
  season: "Season",
  career: "Career",
  streaks: "Streaks & achievements",
};

export interface RecordEvent {
  value: number;
  holderKind: "bowler" | "team";
  holderId: Id;
  holderName: string;
  date: string;
  seasonId: Id;
  seasonName: string;
  week: number | null;
  matchupId: Id | null;
  detail: string;
  /** record = set a new mark, tied = matched the standing mark, former = beaten since. */
  status: "current" | "tied" | "former";
}

export interface RecordItem {
  key: string;
  category: RecordCategory;
  /** single_game | series | season | career | streak */
  type: "single_game" | "series" | "season" | "career" | "streak";
  title: string;
  definition: string;
  direction: "max";
  value: number | null;
  /** Current holders (more than one when the record is tied). */
  holders: RecordEvent[];
  /** Everyone who has held or tied the record, oldest first. */
  history: RecordEvent[];
}

interface Cand {
  value: number;
  order: number; // chronological sort key
  event: Omit<RecordEvent, "status">;
}

function resolve(cands: Cand[]): { holders: RecordEvent[]; history: RecordEvent[]; value: number | null } {
  const sorted = [...cands].sort((a, b) => a.order - b.order);
  const history: RecordEvent[] = [];
  let best: number | null = null;
  for (const c of sorted) {
    if (best == null || c.value > best) {
      best = c.value;
      history.push({ ...c.event, status: "current" });
    } else if (c.value === best) {
      history.push({ ...c.event, status: "tied" });
    }
  }
  for (const h of history) if (best != null && h.value < best) h.status = "former";
  // A "tied" entry that matches the final best is current too; mark both current and tied as current holders.
  const holders = history.filter((h) => h.value === best);
  return { holders, history, value: best };
}

const ord = (date: string, week: number, sub = 0) => new Date(date).getTime() / 1000 / 60 + week * 10 + sub * 0.01;

export interface RecordBookOptions {
  minGamesSeasonAverage: number;
  minGamesCareerAverage: number;
}

export function buildRecordBook(models: SeasonModel[], opts: RecordBookOptions = { minGamesSeasonAverage: 18, minGamesCareerAverage: 30 }): RecordItem[] {
  const cand: Record<string, Cand[]> = {};
  const add = (key: string, c: Cand) => (cand[key] ??= []).push(c);
  const dateOf = (m: SeasonModel, week: number) => m.weekByNumber.get(week)?.date ?? m.data.season.startDate;

  const careerBowler = new Map<Id, { pins: number; games: number; name: string }>();

  for (const m of models) {
    const season = m.data.season;
    const cfg0 = m.configForWeek(1);
    const subsOk = cfg0.eligibility.subsCountForRecords;
    const nights = collectNights(m);
    const gamesPerSession = (w: number) => m.configForWeek(w).scoring.gamesPerSession;

    for (const n of nights) {
      const bowler = m.bowlerById.get(n.bowlerId);
      if (!bowler) continue;
      const entry = m.rosterAt(n.bowlerId, n.week);
      if (entry?.isSub && !subsOk) continue;
      const date = dateOf(m, n.week);
      const base = { holderKind: "bowler" as const, holderId: n.bowlerId, holderName: bowler.name, date, seasonId: season.id, seasonName: season.name, week: n.week, matchupId: n.matchupId };
      const full = n.games.length === gamesPerSession(n.week);
      n.games.forEach((g) => {
        const o = ord(date, n.week, g.game);
        add("ind_scratch_game", { value: g.scratch, order: o, event: { ...base, value: g.scratch, detail: `${g.scratch} in game ${g.game}` } });
        add("ind_hdcp_game", { value: g.adjusted, order: o, event: { ...base, value: g.adjusted, detail: `${g.adjusted} (${g.scratch} + ${g.handicap} hdcp) in game ${g.game}` } });
      });
      if (full) {
        const o = ord(date, n.week, 9);
        add("ind_scratch_series", { value: n.scratchSeries, order: o, event: { ...base, value: n.scratchSeries, detail: n.games.map((g) => g.scratch).join("-") } });
        add("ind_hdcp_series", { value: n.adjustedSeries, order: o, event: { ...base, value: n.adjustedSeries, detail: `${n.scratchSeries} scratch + ${n.adjustedSeries - n.scratchSeries} hdcp` } });
      }
      const c = careerBowler.get(n.bowlerId) ?? { pins: 0, games: 0, name: bowler.name };
      c.pins += n.scratchSeries;
      c.games += n.games.length;
      careerBowler.set(n.bowlerId, c);
    }

    for (const t of collectTeamNights(m)) {
      const team = m.teamById.get(t.teamId);
      if (!team) continue;
      const date = dateOf(m, t.week);
      const base = { holderKind: "team" as const, holderId: t.teamId, holderName: team.name, date, seasonId: season.id, seasonName: season.name, week: t.week, matchupId: t.matchupId };
      t.gameScratch.forEach((g, i) => {
        add("team_scratch_game", { value: g, order: ord(date, t.week, i + 1), event: { ...base, value: g, detail: `${g} in game ${i + 1}` } });
        add("team_hdcp_game", { value: t.gameAdjusted[i], order: ord(date, t.week, i + 1), event: { ...base, value: t.gameAdjusted[i], detail: `${t.gameAdjusted[i]} in game ${i + 1}` } });
      });
      add("team_scratch_series", { value: t.scratchSeries, order: ord(date, t.week, 9), event: { ...base, value: t.scratchSeries, detail: t.gameScratch.join("-") } });
      add("team_hdcp_series", { value: t.adjustedSeries, order: ord(date, t.week, 9), event: { ...base, value: t.adjustedSeries, detail: t.gameAdjusted.join("-") } });
    }

    // Season records: only meaningful once a season has results; dated at the last official week.
    const last = m.lastOfficialWeek;
    if (last > 0) {
      const date = dateOf(m, last);
      const seasonBase = { date, seasonId: season.id, seasonName: season.name, week: last, matchupId: null };
      const perBowler = new Map<Id, { pins: number; games: number }>();
      for (const n of nights) {
        const e = m.rosterAt(n.bowlerId, n.week);
        if (e?.isSub && !subsOk) continue;
        const p = perBowler.get(n.bowlerId) ?? { pins: 0, games: 0 };
        p.pins += n.scratchSeries;
        p.games += n.games.length;
        perBowler.set(n.bowlerId, p);
      }
      for (const [id, p] of perBowler) {
        if (p.games < opts.minGamesSeasonAverage) continue;
        const name = m.bowlerById.get(id)?.name ?? "Unknown";
        const avg = Math.round((p.pins / p.games) * 10) / 10;
        add("season_avg", { value: avg, order: ord(date, last), event: { ...seasonBase, holderKind: "bowler", holderId: id, holderName: name, value: avg, detail: `${avg.toFixed(1)} over ${p.games} games` } });
        add("season_pins", { value: p.pins, order: ord(date, last), event: { ...seasonBase, holderKind: "bowler", holderId: id, holderName: name, value: p.pins, detail: `${p.pins} pins in ${p.games} games` } });
      }
      if (cfg0.format !== "individual") {
        const { rows } = computeStandings(m, { scope: "team" });
        for (const r of rows) {
          if (!r.played) continue;
          add("season_team_points", { value: r.points, order: ord(date, last), event: { ...seasonBase, holderKind: "team", holderId: r.id, holderName: r.name, value: r.points, detail: `${r.points} points (${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""})` } });
          add("season_team_wins", { value: r.wins, order: ord(date, last), event: { ...seasonBase, holderKind: "team", holderId: r.id, holderName: r.name, value: r.wins, detail: `${r.wins} wins, ${r.losses} losses` } });
        }
      }
    }

    // Streaks
    for (const scope of ["team", "individual"] as const) {
      if ((scope === "team" && cfg0.format === "individual") || (scope === "individual" && cfg0.format !== "individual")) continue;
      for (const s of winStreaks(m.results, scope)) {
        if (s.length < 2) continue;
        const name = scope === "team" ? (m.teamById.get(s.id)?.name ?? "?") : (m.bowlerById.get(s.id)?.name ?? "?");
        add("streak_wins", { value: s.length, order: ord(dateOf(m, s.toWeek), s.toWeek), event: { value: s.length, holderKind: scope === "team" ? "team" : "bowler", holderId: s.id, holderName: name, date: dateOf(m, s.toWeek), seasonId: season.id, seasonName: season.name, week: s.toWeek, matchupId: null, detail: `${s.length} straight wins, weeks ${s.fromWeek}–${s.toWeek}` } });
      }
    }
    // 200 / 250 / 300 games count as an achievement (most in a season) is intentionally omitted: too many arbitrary thresholds.
  }

  // Career
  const lastModel = models[models.length - 1];
  const careerDate = lastModel ? (lastModel.data.weeks.length ? lastModel.weekByNumber.get(lastModel.lastOfficialWeek)?.date ?? lastModel.data.season.startDate : lastModel.data.season.startDate) : "";
  for (const [id, c] of careerBowler) {
    const base = { holderKind: "bowler" as const, holderId: id, holderName: c.name, date: careerDate, seasonId: lastModel.data.season.id, seasonName: "Career", week: null, matchupId: null };
    add("career_pins", { value: c.pins, order: 0, event: { ...base, value: c.pins, detail: `${c.pins} pins in ${c.games} games` } });
    add("career_games", { value: c.games, order: 0, event: { ...base, value: c.games, detail: `${c.games} games` } });
    if (c.games >= opts.minGamesCareerAverage) {
      const avg = Math.round((c.pins / c.games) * 10) / 10;
      add("career_avg", { value: avg, order: 0, event: { ...base, value: avg, detail: `${avg.toFixed(1)} over ${c.games} games` } });
    }
  }

  const defs: { key: string; category: RecordCategory; type: RecordItem["type"]; title: string; definition: string }[] = [
    { key: "ind_scratch_game", category: "individual_scratch", type: "single_game", title: "High scratch game", definition: "Highest single-game scratch score. Blind and absent scores are excluded." },
    { key: "ind_scratch_series", category: "individual_scratch", type: "series", title: "High scratch series", definition: "Highest scratch series of a full night's games." },
    { key: "ind_hdcp_game", category: "individual_handicap", type: "single_game", title: "High handicap game", definition: "Scratch score plus the handicap in force for that match." },
    { key: "ind_hdcp_series", category: "individual_handicap", type: "series", title: "High handicap series", definition: "Handicap-adjusted series for a full night." },
    { key: "team_scratch_game", category: "team", type: "single_game", title: "Team high scratch game", definition: "Highest combined scratch team game." },
    { key: "team_scratch_series", category: "team", type: "series", title: "Team high scratch series", definition: "Highest combined scratch team series." },
    { key: "team_hdcp_game", category: "team", type: "single_game", title: "Team high handicap game", definition: "Highest handicap-adjusted team game." },
    { key: "team_hdcp_series", category: "team", type: "series", title: "Team high handicap series", definition: "Highest handicap-adjusted team series." },
    { key: "season_avg", category: "season", type: "season", title: "Highest season average", definition: `Best scratch average in one season (minimum ${opts.minGamesSeasonAverage} games).` },
    { key: "season_pins", category: "season", type: "season", title: "Most pins in a season", definition: "Most total scratch pins in a single season." },
    { key: "season_team_points", category: "season", type: "season", title: "Most team points in a season", definition: "Most league points by a team in a single season." },
    { key: "season_team_wins", category: "season", type: "season", title: "Most team wins in a season", definition: "Most matchup wins by a team in a single season." },
    { key: "career_avg", category: "career", type: "career", title: "Highest career average", definition: `Best scratch average across all seasons (minimum ${opts.minGamesCareerAverage} games).` },
    { key: "career_pins", category: "career", type: "career", title: "Most career pins", definition: "Most total scratch pins across all seasons." },
    { key: "career_games", category: "career", type: "career", title: "Most career games", definition: "Most games bowled across all seasons." },
    { key: "streak_wins", category: "streaks", type: "streak", title: "Longest winning streak", definition: "Most consecutive matchup wins. A tie or loss ends the streak." },
  ];
  return defs
    .map((d) => {
      const r = resolve(cand[d.key] ?? []);
      return { ...d, direction: "max" as const, value: r.value, holders: r.holders, history: r.history };
    })
    .filter((i) => i.value != null);
}

/** Events in `week` that set a new mark or matched the standing mark (the very first entry is skipped: nothing was beaten). */
export function recordsBrokenInWeek(book: RecordItem[], seasonId: Id, week: number): { item: RecordItem; event: RecordEvent; kind: "new" | "tied" }[] {
  const out: { item: RecordItem; event: RecordEvent; kind: "new" | "tied" }[] = [];
  for (const item of book) {
    item.history.forEach((e, idx) => {
      if (idx === 0 || e.seasonId !== seasonId || e.week !== week) return;
      const prevBest = Math.max(...item.history.slice(0, idx).map((h) => h.value));
      out.push({ item, event: e, kind: e.value > prevBest ? "new" : "tied" });
    });
  }
  return out;
}
