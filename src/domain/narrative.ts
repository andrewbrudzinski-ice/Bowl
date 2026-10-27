import type { SeasonModel } from "./engine";
import type { MatchupResult } from "./scoring";
import { computeStandings } from "./standings";
import { bowlerSeasonStats, collectNights, type BowlerSeasonStats } from "./stats";
import type { Id } from "./types";

export interface Insight {
  id: string;
  kind: "average_trend" | "team_streak" | "above_average_series" | "scratch_vs_handicap";
  subjectKind: "bowler" | "team";
  subjectId: Id;
  text: string;
  /** The numbers the sentence is built from, shown verbatim in the UI. */
  support: string[];
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Plain observations with their arithmetic attached. No forecasts. */
export function generateInsights(model: SeasonModel, stats: BowlerSeasonStats[] = bowlerSeasonStats(model)): Insight[] {
  const out: Insight[] = [];
  const cfg = model.configForWeek(Math.max(1, model.lastOfficialWeek));

  for (const s of stats) {
    // Average trend over the last three weeks bowled.
    const p = s.progression;
    if (p.length >= 4 && s.games >= cfg.eligibility.minGamesForAwards) {
      const now = p[p.length - 1];
      const then = p[p.length - 4];
      const delta = now.average - then.average;
      if (Math.abs(delta) >= 3)
        out.push({
          id: `trend:${s.bowlerId}`, kind: "average_trend", subjectKind: "bowler", subjectId: s.bowlerId,
          text: `${s.name}'s season average has ${delta > 0 ? "increased" : "dropped"} by ${f1(Math.abs(delta))} pins over the last 3 weeks.`,
          support: [`Week ${then.week}: ${f1(then.average)} (${then.games} games)`, `Week ${now.week}: ${f1(now.average)} (${now.games} games)`],
        });
    }
    // Consecutive series above the bowler's entering average.
    const nights = [...s.nightsLog].sort((a, b) => a.week - b.week);
    let run = 0;
    for (let i = nights.length - 1; i >= 0; i--) {
      const n = nights[i];
      if (n.average != null && n.scratchSeries > n.games.length * n.average) run++;
      else break;
    }
    if (run >= 3) {
      const last = nights.slice(-run);
      out.push({
        id: `above:${s.bowlerId}`, kind: "above_average_series", subjectKind: "bowler", subjectId: s.bowlerId,
        text: `${s.name} has bowled ${run} consecutive series above their average.`,
        support: last.map((n) => `Week ${n.week}: ${n.scratchSeries} vs ${n.games.length} × ${n.average} = ${n.games.length * n.average!}`),
      });
    }
  }

  // Team win streaks (current).
  const kind = cfg.format === "individual" ? "bowler" : "team";
  const { rows } = computeStandings(model, { scope: kind === "team" ? "team" : "bowler" });
  for (const r of rows) {
    if (r.streak.type === "W" && r.streak.count >= 3)
      out.push({
        id: `streak:${r.id}`, kind: "team_streak", subjectKind: kind, subjectId: r.id,
        text: `${r.name} has won ${r.streak.count} consecutive matchups.`,
        support: [`Last ${r.form.length} results: ${r.form.join(" ")}`, `Record ${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`],
      });
  }

  // Scratch vs handicap-adjusted standing of teams.
  if (cfg.handicap.enabled && cfg.format !== "individual") {
    const teams = rows.filter((r) => r.gamesBowled > 0);
    if (teams.length >= 4) {
      const scratchRank = [...teams].sort((a, b) => b.scratchPins / b.gamesBowled - a.scratchPins / a.gamesBowled).map((t) => t.id);
      const adjRank = [...teams].sort((a, b) => b.totalPins / b.gamesBowled - a.totalPins / a.gamesBowled).map((t) => t.id);
      if (cfg.standings.pinsBasis === "handicap") {
        for (const t of teams) {
          const rs = scratchRank.indexOf(t.id) + 1;
          const ra = adjRank.indexOf(t.id) + 1;
          if (Math.abs(rs - ra) >= 3)
            out.push({
              id: `scratchhdcp:${t.id}`, kind: "scratch_vs_handicap", subjectKind: "team", subjectId: t.id,
              text: `${t.name} ranks ${ordinal(rs)} in scratch scoring but ${ordinal(ra)} in handicap-adjusted scoring.`,
              support: [`Scratch game average ${f1(t.scratchPins / t.gamesBowled)} (${ordinal(rs)} of ${teams.length})`, `Adjusted game average ${f1(t.totalPins / t.gamesBowled)} (${ordinal(ra)} of ${teams.length})`],
            });
        }
      }
    }
  }
  return out;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export interface RecapLine {
  kind: string;
  text: string;
}

const numWord = (n: number) => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);

/** Narrow-finish threshold in pins. A fixed, stated cutoff rather than a judgment call. */
export const NARROW_MARGIN_PINS = 15;

/**
 * Concise recap lines for a completed matchup. Every line is derived from recorded scores; if the evidence
 * isn't there the line isn't produced. Returns [] for matchups that aren't complete and official.
 */
export function matchupRecap(model: SeasonModel, r: MatchupResult): RecapLine[] {
  if (!r.official || r.isBye || !r.b) return [];
  const lines: RecapLine[] = [];
  const kind = r.matchup.kind;
  const nm = (id: Id) => (kind === "team" ? model.teamById.get(id)?.name : model.bowlerById.get(id)?.name) ?? "Unknown";
  const A = nm(r.a.participantId);
  const B = nm(r.b.participantId);
  const G = r.gamesPerSession;

  if (r.forfeitBy) {
    const loser = r.forfeitBy === "A" ? A : B;
    const winner = r.forfeitBy === "A" ? B : A;
    return [{ kind: "forfeit", text: `${loser} forfeited; ${winner} was awarded the win.` }];
  }
  if (!r.complete && r.winner == null) return [];

  const winSide = r.winner === "A" ? r.a : r.winner === "B" ? r.b : null;
  const loseSide = r.winner === "A" ? r.b : r.winner === "B" ? r.a : null;
  const bases = r.basis === "handicap" ? "handicap-adjusted" : "scratch";

  if (winSide && loseSide) {
    lines.push({
      kind: "result",
      text: `${nm(winSide.participantId)} defeated ${nm(loseSide.participantId)} ${winSide.points}–${loseSide.points} in matchup points, ${winSide.basisSeries}–${loseSide.basisSeries} in ${bases} pins.`,
    });
    const gamesWon = r.games.filter((g) => g.winner === winSide.side).length;
    const gamesLost = r.games.filter((g) => g.winner === loseSide.side).length;
    if (gamesWon === G && G > 1) lines.push({ kind: "sweep", text: `${nm(winSide.participantId)} swept all ${numWord(G)} games.` });
  } else if (r.winner === "tie") {
    lines.push({ kind: "tie", text: `${A} and ${B} tied ${r.a.points}–${r.b.points} in matchup points.` });
  }

  // Won the games but lost the series (or vice versa).
  if (r.seriesWinner && r.seriesWinner !== "tie") {
    const sw = r.seriesWinner === "A" ? r.a : r.b;
    const sl = r.seriesWinner === "A" ? r.b : r.a;
    const swGames = r.games.filter((g) => g.winner === sw.side).length;
    const slGames = r.games.filter((g) => g.winner === sl.side).length;
    if (slGames > swGames)
      lines.push({ kind: "split", text: `${nm(sl.participantId)} won ${numWord(slGames)} of ${numWord(G)} games but lost the overall series, ${sw.basisSeries}–${sl.basisSeries}.` });
  }

  // Narrow finish.
  if (r.margin != null && r.winner && r.winner !== "tie" && r.margin <= NARROW_MARGIN_PINS)
    lines.push({ kind: "narrow", text: `Decided by just ${r.margin} ${r.margin === 1 ? "pin" : "pins"} on ${bases} totals.` });
  if (r.margin === 0 && r.winner === "tie") lines.push({ kind: "narrow", text: `The series ended level on ${bases} pins.` });

  // Handicap flipped the result.
  if (r.basis === "handicap" && r.a.scratchSeries !== r.b.scratchSeries) {
    const scratchWinner = r.a.scratchSeries > r.b.scratchSeries ? r.a : r.b;
    if (r.seriesWinner && r.seriesWinner !== "tie" && scratchWinner.side !== r.seriesWinner) {
      const adjWinner = r.seriesWinner === "A" ? r.a : r.b;
      lines.push({
        kind: "handicap_flip",
        text: `${nm(scratchWinner.participantId)} had the higher scratch series (${scratchWinner.scratchSeries} vs ${adjWinner.scratchSeries}), but ${nm(adjWinner.participantId)} won on handicap-adjusted pins.`,
      });
    }
  }

  // High game of the match.
  const all = [...r.a.lineup, ...r.b.lineup].flatMap((l) => l.games.filter((g) => g.kind === "bowled" && g.scratch != null).map((g) => ({ l, g })));
  if (all.length) {
    const best = Math.max(...all.map((x) => x.g.scratch!));
    const holders = all.filter((x) => x.g.scratch === best);
    if (holders.length === 1) {
      const h = holders[0];
      lines.push({ kind: "high_game", text: `${model.bowlerById.get(h.l.bowlerId)?.name ?? "A bowler"} had the high game of the match: ${best} (game ${h.g.game}).` });
    }
  }

  // Season-best series for a bowler (needs prior history so a first night can't be "best").
  const nights = collectNights(model);
  for (const side of [r.a, r.b]) {
    for (const l of side.lineup) {
      const mine = nights.filter((n) => n.bowlerId === l.bowlerId);
      const tonight = mine.find((n) => n.matchupId === r.matchup.id);
      if (!tonight) continue;
      const prior = mine.filter((n) => n.week < r.weekNumber && n.games.length === tonight.games.length);
      if (prior.length >= 2 && tonight.games.length === G && tonight.scratchSeries > Math.max(...prior.map((n) => n.scratchSeries)))
        lines.push({
          kind: "season_best",
          text: `${model.bowlerById.get(l.bowlerId)?.name} bowled a season-best series of ${tonight.scratchSeries} (previous best ${Math.max(...prior.map((n) => n.scratchSeries))}).`,
        });
    }
  }

  // Standings movement: reached first place this week (team/bowler participants of a regular-season matchup).
  if ((model.weekByNumber.get(r.weekNumber)?.phase ?? "regular") === "regular") {
    const scope = kind === "team" ? "team" : "bowler";
    const before = computeStandings(model, { scope, throughWeek: r.weekNumber - 1 }).rows;
    const after = computeStandings(model, { scope, throughWeek: r.weekNumber }).rows;
    const hadPlay = before.some((x) => x.played > 0);
    for (const side of [r.a, r.b]) {
      const id = side.participantId;
      const pre = before.find((x) => x.id === id);
      const post = after.find((x) => x.id === id);
      if (!post) continue;
      if (post.rank === 1 && post.played > 0 && hadPlay && pre && pre.rank !== 1 && !post.fullyTied)
        lines.push({ kind: "first_place", text: `${nm(id)} moved into first place (from ${ordinal(pre.rank)}).` });
    }
  }
  return lines;
}

export interface WeekRecap {
  week: number;
  date: string | null;
  results: MatchupResult[];
  topSeries: { bowlerId: Id; scratchSeries: number; matchupId: Id }[];
  highGame: { bowlerId: Id; score: number; matchupId: Id }[];
  headlines: RecapLine[];
}

export function weekRecap(model: SeasonModel, week: number): WeekRecap {
  const results = model.results.filter((r) => r.weekNumber === week);
  const nights = collectNights(model).filter((n) => n.week === week);
  const bestSeries = nights.length ? Math.max(...nights.map((n) => n.scratchSeries)) : null;
  const games = nights.flatMap((n) => n.games.map((g) => ({ n, g })));
  const bestGame = games.length ? Math.max(...games.map((x) => x.g.scratch)) : null;
  const headlines: RecapLine[] = [];
  for (const r of results) {
    if (!r.official || r.isBye) continue;
    const lines = matchupRecap(model, r);
    for (const l of lines.filter((x) => ["narrow", "first_place", "split", "season_best", "handicap_flip", "sweep"].includes(x.kind))) headlines.push(l);
  }
  return {
    week,
    date: model.weekByNumber.get(week)?.date ?? null,
    results,
    topSeries: bestSeries == null ? [] : nights.filter((n) => n.scratchSeries === bestSeries).map((n) => ({ bowlerId: n.bowlerId, scratchSeries: n.scratchSeries, matchupId: n.matchupId })),
    highGame: bestGame == null ? [] : games.filter((x) => x.g.scratch === bestGame).map((x) => ({ bowlerId: x.n.bowlerId, score: x.g.scratch, matchupId: x.n.matchupId })),
    headlines,
  };
}
