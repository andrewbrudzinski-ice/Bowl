import { beforeAll, describe, expect, it } from "vitest";
import { championOf } from "@/domain/awards";
import { buildSeasonModel } from "@/domain/engine";
import { computeStandings } from "@/domain/standings";
import type { Season } from "@/domain/types";
import { auditConsistency } from "@/domain/validate";
import { seasonData, type Actor } from "@/server/access";
import type { Store } from "@/server/db";
import { createDemoLeague, removeDemoLeague } from "@/server/demo";
import { mkStore, mkUser } from "./world";

describe("demo league", () => {
  let store: Store;
  let owner: Actor;
  let leagueId: string;
  let seasons: Season[];
  const model = (id: string) => store.read((db) => buildSeasonModel(seasonData(db, leagueId, id)));

  beforeAll(async () => {
    store = await mkStore();
    owner = await mkUser(store, "demo");
    ({ leagueId } = await createDemoLeague(store, owner));
    seasons = await store.read((db) => db.seasons.filter((s) => s.leagueId === leagueId));
  }, 180_000);

  it("builds two seasons: a completed 2025 with a playoff champion and a live 2026", async () => {
    expect(seasons.map((s) => s.year).sort()).toEqual([2025, 2026]);
    const s25 = seasons.find((s) => s.year === 2025)!;
    const s26 = seasons.find((s) => s.year === 2026)!;
    expect(s25.status).toBe("completed");
    expect(s25.championId).toBeTruthy();
    expect(championOf(await model(s25.id))?.how).toMatch(/playoff final/);
    expect(s26.status).toBe("active");
    expect((await model(s26.id)).lastOfficialWeek).toBe(6);
  });

  it("each season keeps its own rules (80% of 210 in 2025, 90% of 220 in 2026)", async () => {
    const s25 = seasons.find((s) => s.year === 2025)!;
    const s26 = seasons.find((s) => s.year === 2026)!;
    expect((await model(s25.id)).configForWeek(1).handicap).toMatchObject({ percentage: 80, baseValue: 210 });
    expect((await model(s26.id)).configForWeek(1).handicap).toMatchObject({ percentage: 90, baseValue: 220 });
  });

  it("is internally consistent: no inconsistent finals, one draft week with an incomplete matchup", async () => {
    for (const s of seasons) expect(auditConsistency(await model(s.id)).filter((i) => i.severity === "error")).toEqual([]);
    const s26 = seasons.find((s) => s.year === 2026)!;
    const m = await model(s26.id);
    const week7 = m.results.filter((r) => r.weekNumber === 7 && !r.isBye);
    expect(week7.every((r) => !r.official)).toBe(true);
    expect(week7.some((r) => !r.complete)).toBe(true);
    expect(computeStandings(m).rows.every((r) => r.played === 6 || r.played === 5)).toBe(true);
  });

  it("everything is flagged as demo and removal deletes it all without touching other leagues", async () => {
    const other = await mkUser(store, "other");
    expect(await store.read((db) => db.bowlers.filter((b) => b.leagueId === leagueId).every((b) => b.isDemo))).toBe(true);
    await removeDemoLeague(store, owner, leagueId);
    expect(await store.read((db) => [db.leagues.length, db.teams.length, db.bowlers.length, db.matchups.length, db.scores.length, db.audit.length])).toEqual([0, 0, 0, 0, 0, 0]);
    expect(await store.read((db) => db.users.some((u) => u.id === other.id))).toBe(true);
  });
});
