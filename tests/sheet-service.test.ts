import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig } from "@/domain/config";
import { buildSeasonModel } from "@/domain/engine";
import { buildWeeklySheet } from "@/domain/sheet";
import { seasonData } from "@/server/access";
import { createLeague } from "@/server/services/leagues";
import { finalizeMatchup, saveEntry } from "@/server/services/results";
import { addBowler, addToRoster, drawWeekPartners } from "@/server/services/season";
import { mkStore, mkUser, type World } from "./world";

/** A rotating-partners league of `n` bowlers, with the first `settingWeeks` weeks bowled scratch to set handicaps. */
async function league(n: number, settingWeeks = 0): Promise<World> {
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
  c.handicapSetting.weeks = settingWeeks;
  const { leagueId, slug, seasonId } = await createLeague(store, owner, { name: "Thursday Partners", visibility: "private", season: { name: "2026 Season", year: 2026, startDate: "2026-01-06", regularWeeks: 9 }, config: c });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const b = await addBowler(store, owner, leagueId, { name: `Bowler${i + 1} Test` });
    ids.push(b);
    await addToRoster(store, owner, leagueId, seasonId, { bowlerId: b, teamId: null, enteringAverage: 150 });
  }
  return { store, owner, leagueId, slug, seasonId, teamIds: [], bowlerIds: [ids] };
}

const sheet = (w: World, week: number) => w.store.read((db) => buildWeeklySheet(buildSeasonModel(seasonData(db, w.leagueId, w.seasonId)), week)!);
const weekOf = (w: World, n: number) => w.store.read((db) => db.matchups.filter((m) => m.seasonId === w.seasonId && m.weekNumber === n).map((m) => structuredClone(m)));
const draw = (w: World, n: number, seed: number, bowlerIds = w.bowlerIds[0]) => drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: n, bowlerIds, seed });

/** Everyone bowls `score` in every game, then every real match of the week is finalized (the extra comparison last, as it depends on the match it borrows). */
async function bowlWeek(w: World, n: number, score = 190) {
  const ms = (await weekOf(w, n)).filter((m) => m.sideB);
  const ordered = [...ms.filter((m) => !ms.some((o) => o.id !== m.id && o.sideA === m.sideB)), ...ms.filter((m) => ms.some((o) => o.id !== m.id && o.sideA === m.sideB))];
  for (const m of ordered) {
    const scores = (["A", "B"] as const).flatMap((side) => (side === "A" ? m.lineupA : m.lineupB).flatMap((bowlerId) => [1, 2, 3].map((g) => ({ bowlerId, side, game: g, scratch: score, kind: "bowled" as const }))));
    const fresh = (await weekOf(w, n)).find((x) => x.id === m.id)!;
    const res = await saveEntry(w.store, w.owner, w.leagueId, { matchupId: m.id, expectedRevision: fresh.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores });
    await finalizeMatchup(w.store, w.owner, w.leagueId, m.id, res.revision);
  }
}

describe("weekly sheet for rotating partners", () => {
  it("lists the drawn matches, then the extra comparison, with each pair's bowlers", async () => {
    const w = await league(10);
    await draw(w, 1, 7);
    const s = await sheet(w, 1);
    expect(s.partners).toBe(true);
    expect(s.matchups.map((m) => m.kind)).toEqual(["match", "match", "extra"]);
    for (const m of s.matchups) {
      expect(m.a.lineup).toHaveLength(2);
      expect(m.b!.lineup).toHaveLength(2);
      expect(m.a.name).toMatch(/^\w+ & \w+$/);
      expect([m.a.record, m.a.rank]).toEqual([null, null]); // pairs change weekly, so they have no record
    }
    // The extra pair is compared with a pair that plays in one of the real matches.
    expect(s.matchups.slice(0, 2).flatMap((m) => [m.a.name, m.b!.name])).toContain(s.matchups[2].b!.name);
    // Everyone bowling is on the averages list: no teams, entering average of 150 against the 220 base.
    expect(s.bowlers).toHaveLength(10);
    expect(s.bowlers.every((b) => b.teamName === null && b.average === 150 && b.handicap === 70)).toBe(true);
  });

  it("puts anyone sitting out last, when there is an odd number of bowlers", async () => {
    const w = await league(9);
    await draw(w, 1, 3);
    const s = await sheet(w, 1);
    expect(s.matchups.map((m) => m.kind)).toEqual(["match", "match", "bye"]);
    expect(s.matchups[2].b).toBeNull();
    expect(s.matchups[2].a.lineup).toHaveLength(1);
  });

  it("recaps last week with every match and the extra comparison, and moves averages and handicaps", async () => {
    const w = await league(10);
    await draw(w, 1, 7);
    await bowlWeek(w, 1);
    await draw(w, 2, 8);
    const s = await sheet(w, 2);
    expect(s.previous).toMatchObject({ week: 1, notFinal: 0, settingWeek: false });
    expect(s.previous!.results).toHaveLength(3);
    expect(s.previous!.results.filter((r) => r.guest)).toHaveLength(1);
    expect(s.previous!.highGame).toHaveLength(10); // everyone tied the best game, and each is named once
    expect(s.previous!.highGame.every((h) => h.score === 190)).toBe(true);
    // Everyone averaged 190 over three games, up from the 150 they entered with: handicap 70 -> 30.
    expect(s.bowlers.every((b) => b.average === 190 && b.averageChange === 40 && b.handicap === 30 && b.handicapChange === -40)).toBe(true);
    expect(s.standings).not.toBeNull();
    expect(s.standingsFor).toBe("bowler");
    expect(s.standings!.length).toBe(10);
    expect(s.matchups.map((m) => m.kind)).toEqual(["match", "match", "extra"]);
  });

  it("keeps points out of a handicap week and its standings empty until a week counts", async () => {
    const w = await league(10, 1);
    await draw(w, 1, 7);
    await bowlWeek(w, 1);
    await draw(w, 2, 8);
    const s = await sheet(w, 2);
    expect(s.previous!.settingWeek).toBe(true);
    expect(s.standings).toBeNull();
    expect(s.handicapOn).toBe(true);
    expect(s.bowlers.every((b) => b.average === 190 && b.handicap === 30 && b.handicapChange === null)).toBe(true);
    const first = await sheet(w, 1);
    expect([first.settingWeek, first.handicapOn]).toEqual([true, false]);
    expect(first.matchups.every((m) => m.a.lineup.every((b) => b.handicap === 0))).toBe(true);
  });
});
