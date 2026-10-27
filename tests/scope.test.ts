import { describe, expect, it } from "vitest";
import { TEST_BACKEND, mkStore, mkWorld } from "./world";

// These tests assert that a scoped run sees *less* than a full one, which is exactly what BOWL_VERIFY_SCOPE flags.
process.env.BOWL_VERIFY_SCOPE = "";

// Scoping is a Postgres-store feature; the file store always holds everything in memory.
describe.skipIf(TEST_BACKEND === "file")("scoped loading", () => {
  async function two() {
    const store = await mkStore();
    const a = await mkWorld({ store, name: "Alpha League" });
    const b = await mkWorld({ store, name: "Beta League", owner: undefined });
    return { store, a, b };
  }

  it("a league-scoped callback only ever sees that league's rows", async () => {
    const { store, a, b } = await two();
    const seen = await store.read(
      (db) => ({
        leagues: db.leagues.map((l) => l.id),
        teams: db.teams.map((t) => t.leagueId),
        bowlers: db.bowlers.map((x) => x.leagueId),
        seasons: db.seasons.map((s) => s.leagueId),
        matchups: db.matchups.length,
        members: db.memberships.map((m) => m.leagueId),
      }),
      { leagueId: a.leagueId }
    );
    expect(seen.leagues).toEqual([a.leagueId]);
    for (const col of [seen.teams, seen.bowlers, seen.seasons, seen.members]) {
      expect(col.length).toBeGreaterThan(0);
      expect(new Set(col)).toEqual(new Set([a.leagueId]));
    }
    const all = await store.read((db) => ({ leagues: db.leagues.length, matchups: db.matchups.length }));
    expect(all.leagues).toBe(2);
    expect(all.matchups).toBeGreaterThan(seen.matchups);
    expect(b.leagueId).not.toBe(a.leagueId);
  });

  it("resolves a slug, and an unknown slug loads nothing", async () => {
    const { store, a } = await two();
    expect(await store.read((db) => db.leagues.map((l) => l.id), { leagueSlug: a.slug })).toEqual([a.leagueId]);
    const none = await store.read((db) => ({ l: db.leagues.length, t: db.teams.length, s: db.seasons.length }), { leagueSlug: "no-such-league" });
    expect(none).toEqual({ l: 0, t: 0, s: 0 });
  });

  it("a scope with no facet for a collection loads nothing from it", async () => {
    const { store, a } = await two();
    const n = await store.read((db) => ({ users: db.users.length, sessions: db.sessions.length }), { leagueId: a.leagueId });
    expect(n.sessions).toBe(0);
    expect(n.users).toBeGreaterThan(0); // the league's members
  });

  it("writes inside a scope leave other leagues untouched", async () => {
    const { store, a, b } = await two();
    const before = await store.read((db) => JSON.stringify(db.teams.filter((t) => t.leagueId === b.leagueId)));
    await store.transaction(
      (db) => {
        for (const t of db.teams) t.name = t.name + "!";
      },
      { leagueId: a.leagueId }
    );
    expect(await store.read((db) => JSON.stringify(db.teams.filter((t) => t.leagueId === b.leagueId)))).toBe(before);
    expect(await store.read((db) => db.teams.filter((t) => t.leagueId === a.leagueId).every((t) => t.name.endsWith("!")))).toBe(true);
  });

  it("userLeagues loads the seasons of the user's leagues and nobody else's", async () => {
    const { store, a } = await two(); // b is owned by a different user
    const c = await mkWorld({ store, name: "Gamma League", owner: a.owner });
    const seen = await store.read((db) => ({ leagues: db.leagues.map((l) => l.id).sort(), seasons: db.seasons.map((s) => s.leagueId) }), { userIds: [a.owner.id], userLeagues: ["seasons"] });
    expect(seen.leagues).toEqual([a.leagueId, c.leagueId].sort());
    expect(new Set(seen.seasons)).toEqual(new Set([a.leagueId, c.leagueId]));
    // without the facet, seasons are not loaded at all
    expect(await store.read((db) => db.seasons.length, { userIds: [a.owner.id] })).toBe(0);
  });
});
