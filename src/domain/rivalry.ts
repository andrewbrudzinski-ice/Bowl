import type { SeasonModel } from "./engine";
import type { Id } from "./types";

export interface Meeting {
  seasonId: Id;
  seasonName: string;
  week: number;
  matchupId: Id;
  /** Perspective of the subject. */
  forPoints: number;
  againstPoints: number;
  forPins: number;
  againstPins: number;
  outcome: "W" | "L" | "T";
  margin: number | null;
  highGame: number | null;
}

export interface Rivalry {
  opponentId: Id;
  meetings: Meeting[];
  allTime: { w: number; l: number; t: number };
  currentSeason: { w: number; l: number; t: number };
  lastFive: Meeting[];
  avgSeries: number | null;
  avgOpponentSeries: number | null;
  highGame: number | null;
  highSeries: number | null;
  largestWin: Meeting | null;
  closestFinish: Meeting | null;
  bySeason: { seasonId: Id; seasonName: string; w: number; l: number; t: number }[];
}

const tally = (ms: Meeting[]) => ({ w: ms.filter((m) => m.outcome === "W").length, l: ms.filter((m) => m.outcome === "L").length, t: ms.filter((m) => m.outcome === "T").length });

/**
 * Head-to-head history from official, scored results only. Models should be ordered oldest → newest.
 * Returns an empty list when there are no meetings — nothing is inferred or invented.
 */
export function computeRivalries(models: SeasonModel[], kind: "team" | "individual", subjectId: Id, currentSeasonId: Id): Rivalry[] {
  const byOpp = new Map<Id, Meeting[]>();
  for (const m of models) {
    const s = m.data.season;
    for (const r of m.results) {
      if (!r.official || r.isBye || r.matchup.kind !== kind || !r.b || !r.winner) continue;
      const mine = r.a.participantId === subjectId ? r.a : r.b.participantId === subjectId ? r.b : null;
      if (!mine) continue;
      const theirs = mine === r.a ? r.b : r.a;
      const scored = !r.forfeitBy;
      const outcome: Meeting["outcome"] = r.winner === "tie" ? "T" : r.winner === mine.side ? "W" : "L";
      const games = mine.lineup.flatMap((l) => l.games).filter((g) => g.scratch != null);
      byOpp.set(theirs.participantId, [
        ...(byOpp.get(theirs.participantId) ?? []),
        {
          seasonId: s.id, seasonName: s.name, week: r.weekNumber, matchupId: r.matchup.id,
          forPoints: mine.points, againstPoints: theirs.points,
          forPins: scored ? mine.scratchSeries : 0, againstPins: scored ? theirs.scratchSeries : 0,
          outcome, margin: scored ? r.margin : null,
          highGame: scored && mine.games.some((g) => g.scratch != null) ? Math.max(...mine.games.map((g) => g.scratch ?? 0)) : (games.length ? 0 : null),
        },
      ]);
    }
  }
  const out: Rivalry[] = [];
  for (const [opponentId, meetings] of byOpp) {
    const scored = meetings.filter((m) => m.margin != null);
    const decided = scored.filter((m) => m.outcome !== "T");
    const largestWin = scored.filter((m) => m.outcome === "W").sort((a, b) => b.margin! - a.margin!)[0] ?? null;
    const closest = decided.sort((a, b) => a.margin! - b.margin!)[0] ?? null;
    const seasons = [...new Set(meetings.map((m) => m.seasonId))];
    out.push({
      opponentId,
      meetings,
      allTime: tally(meetings),
      currentSeason: tally(meetings.filter((m) => m.seasonId === currentSeasonId)),
      lastFive: meetings.slice(-5).reverse(),
      avgSeries: scored.length ? scored.reduce((t, m) => t + m.forPins, 0) / scored.length : null,
      avgOpponentSeries: scored.length ? scored.reduce((t, m) => t + m.againstPins, 0) / scored.length : null,
      highGame: scored.length ? Math.max(...scored.map((m) => m.highGame ?? 0)) : null,
      highSeries: scored.length ? Math.max(...scored.map((m) => m.forPins)) : null,
      largestWin,
      closestFinish: closest,
      bySeason: seasons.map((id) => {
        const ms = meetings.filter((m) => m.seasonId === id);
        return { seasonId: id, seasonName: ms[0].seasonName, ...tally(ms) };
      }),
    });
  }
  return out.sort((a, b) => b.meetings.length - a.meetings.length);
}
