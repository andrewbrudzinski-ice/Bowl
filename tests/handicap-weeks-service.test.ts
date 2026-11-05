import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig } from "@/domain/config";
import { buildSeasonModel } from "@/domain/engine";
import { computeStandings } from "@/domain/standings";
import { bowlerSeasonStats } from "@/domain/stats";
import { seasonData } from "@/server/access";
import { createLeague } from "@/server/services/leagues";
import { finalizeMatchup, previewFinalize, saveEntry } from "@/server/services/results";
import { previewSeasonRules } from "@/server/services/rules";
import { addBowler, addToRoster, drawWeekPartners } from "@/server/services/season";
import { mkStore, mkUser, type World } from "./world";

/** A rotating-partners league with handicap on (base 220 at 100%) and the first `weeks` weeks set aside for setting handicaps. */
async function league(weeks: number, n = 8): Promise<World> {
  const store = await mkStore();
  const owner = await mkUser(store, "owner");
  const c = normalizeConfig(DEFAULT_CONFIG);
  c.bowlersPerTeam = 2;
  c.scheduleFormat = "manual";
  c.partners.enabled = true;
  c.scoring.pointsPerGame = 2;
  c.scoring.pointsPerSeries = 1;
  c.handicap.baseValue = 220;
  c.handicap.percentage = 100;
  c.handicapSetting.weeks = weeks;
  const { leagueId, slug, seasonId } = await createLeague(store, owner, { name: "Thursday Partners", visibility: "private", season: { name: "2026 Season", year: 2026, startDate: "2026-01-06", regularWeeks: 9 }, config: c });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const b = await addBowler(store, owner, leagueId, { name: `Bowler${i + 1} Test` });
    ids.push(b);
    await addToRoster(store, owner, leagueId, seasonId, { bowlerId: b, teamId: null, enteringAverage: 150 });
  }
  return { store, owner, leagueId, slug, seasonId, teamIds: [], bowlerIds: [ids] };
}

const model = (w: World) => w.store.read((db) => buildSeasonModel(seasonData(db, w.leagueId, w.seasonId)));
const week = (w: World, n: number) => w.store.read((db) => db.matchups.filter((m) => m.seasonId === w.seasonId && m.weekNumber === n).map((m) => structuredClone(m)));
const draw = (w: World, n: number, seed: number) => drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: n, bowlerIds: w.bowlerIds[0], seed });

/** Everyone bowls 190 in all three games, then every match of the week is finalized. */
async function bowlWeek(w: World, n: number, score = 190) {
  for (const m of await week(w, n)) {
    if (!m.sideB) continue;
    const scores = (["A", "B"] as const).flatMap((side) => (side === "A" ? m.lineupA : m.lineupB).flatMap((bowlerId) => [1, 2, 3].map((g) => ({ bowlerId, side, game: g, scratch: score, kind: "bowled" as const }))));
    const res = await saveEntry(w.store, w.owner, w.leagueId, { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores });
    await finalizeMatchup(w.store, w.owner, w.leagueId, m.id, res.revision);
  }
}

describe("handicap-setting weeks, through the services", () => {
  it("count toward averages and handicaps but leave the standings empty", async () => {
    const w = await league(1);
    await draw(w, 1, 5);
    await bowlWeek(w, 1);
    const m = await model(w);
    expect(m.isSettingWeek(1)).toBe(true);
    expect(computeStandings(m, { scope: "bowler" }).rows.every((r) => r.played === 0 && r.points === 0)).toBe(true);
    // Everyone has a 190 average from week 1, so their handicap in week 2 is 30 pins a game against the 220 base.
    const b = w.bowlerIds[0][0];
    expect(m.handicapAt(b, 2).average.average).toBe(190);
    expect(m.handicapAt(b, 2).breakdown.handicap).toBe(30);
    expect(bowlerSeasonStats(m).find((s) => s.bowlerId === b)).toMatchObject({ games: 3, average: 190 });
  });

  it("are finalized with no handicap, and the next week locks in the handicaps they set", async () => {
    const w = await league(1);
    await draw(w, 1, 5);
    await bowlWeek(w, 1);
    for (const mu of await week(w, 1)) expect(Object.values(mu.handicapSnapshot ?? {}).every((h) => h.handicap === 0)).toBe(true);
    await draw(w, 2, 6);
    await bowlWeek(w, 2, 200);
    for (const mu of await week(w, 2)) expect(Object.values(mu.handicapSnapshot ?? {}).every((h) => h.handicap === 30)).toBe(true);
    const m = await model(w);
    const rows = computeStandings(m, { scope: "bowler" }).rows;
    expect(rows.every((r) => r.played === 1)).toBe(true); // only week 2 counts
    expect(rows.some((r) => r.points > 0)).toBe(true);
  });

  it("show no change to the standings when a setting-week matchup is finalized", async () => {
    const w = await league(1);
    await draw(w, 1, 5);
    const [mu] = (await week(w, 1)).filter((x) => x.sideB);
    const scores = (["A", "B"] as const).flatMap((side) => (side === "A" ? mu.lineupA : mu.lineupB).flatMap((bowlerId) => [1, 2, 3].map((g) => ({ bowlerId, side, game: g, scratch: 180, kind: "bowled" as const }))));
    await saveEntry(w.store, w.owner, w.leagueId, { matchupId: mu.id, expectedRevision: mu.revision, lineupA: mu.lineupA, lineupB: mu.lineupB, scores });
    const preview = await previewFinalize(w.store, w.owner, w.leagueId, mu.id);
    expect(preview.canFinalize).toBe(true);
    expect(JSON.stringify(preview.standingsAfter.map((r) => [r.id, r.points, r.played]))).toBe(JSON.stringify(preview.standingsBefore.map((r) => [r.id, r.points, r.played])));
  });

  it("show in a rule preview what changing their number does to the standings", async () => {
    const w = await league(0);
    await draw(w, 1, 5);
    await bowlWeek(w, 1);
    const current = await w.store.read((db) => structuredClone(db.seasons.find((s) => s.id === w.seasonId)!.ruleVersions.at(-1)!.config));
    const preview = await previewSeasonRules(w.store, w.owner, w.leagueId, w.seasonId, { ...current, handicapSetting: { weeks: 1 } }, { type: "historical" });
    expect(preview.classification.affectsStandings).toBe(true);
    expect(preview.standingsBefore.some((r) => r.played > 0)).toBe(true);
    expect(preview.standingsAfter.every((r) => r.played === 0)).toBe(true);
  });
});
