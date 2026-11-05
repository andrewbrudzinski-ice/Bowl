import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig } from "@/domain/config";
import { buildSeasonModel } from "@/domain/engine";
import { pairKey } from "@/domain/partners";
import { computeStandings } from "@/domain/standings";
import { seasonData } from "@/server/access";
import { AppError } from "@/server/errors";
import { exportBundle, exportCsv, importBundle } from "@/server/services/data";
import { previewSeasonRules } from "@/server/services/rules";
import { createLeague } from "@/server/services/leagues";
import { finalizeMatchup, saveEntry } from "@/server/services/results";
import { addBowler, addToRoster, createMatchup, drawWeekPartners, generateSchedule, updateBowler } from "@/server/services/season";
import { join, mkStore, mkUser, type World } from "./world";

const code = async (fn: () => unknown) => {
  try { await fn(); } catch (e) { if (e instanceof AppError) return e.code; throw e; }
  return "none";
};

const partnersConfig = (patch: (c: ReturnType<typeof normalizeConfig>) => void = () => {}) => {
  const c = normalizeConfig(DEFAULT_CONFIG);
  c.bowlersPerTeam = 2;
  c.scheduleFormat = "manual";
  c.partners.enabled = true;
  c.handicap.enabled = false;
  c.scoring.basis = "scratch";
  c.standings.pinsBasis = "scratch";
  patch(c);
  return c;
};

const NAMES = ["Alex Rivera", "Sam Chen", "Jordan Blake", "Taylor Nguyen", "Casey Morgan", "Riley Patel", "Jamie Okafor", "Morgan Reyes", "Quinn Larsen", "Avery Kim", "Drew Santos", "Harper Lee"];

/** A rotating-partners league: no teams, `n` bowlers on the roster. */
async function partnersWorld(n = 10, patch?: Parameters<typeof partnersConfig>[0]): Promise<World> {
  const store = await mkStore();
  const owner = await mkUser(store, "owner");
  const { leagueId, slug, seasonId } = await createLeague(store, owner, {
    name: "Thursday Partners", visibility: "private", season: { name: "2026 Season", year: 2026, startDate: "2026-01-06", regularWeeks: 9 }, config: partnersConfig(patch),
  });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const b = await addBowler(store, owner, leagueId, { name: NAMES[i] });
    ids.push(b);
    await addToRoster(store, owner, leagueId, seasonId, { bowlerId: b, teamId: null, enteringAverage: 170 });
  }
  return { store, owner, leagueId, slug, seasonId, teamIds: [], bowlerIds: [ids] };
}

const weekMatchups = (w: World, week: number) => w.store.read((db) => db.matchups.filter((m) => m.seasonId === w.seasonId && m.weekNumber === week).map((m) => structuredClone(m)));
const model = (w: World) => w.store.read((db) => buildSeasonModel(seasonData(db, w.leagueId, w.seasonId)));
const everyone = (w: World) => w.bowlerIds[0];

/** Every bowler in a match bowls the flat score given for them (default 170) in all three games, then the match is finalized. */
async function bowl(w: World, matchupId: string, flat: Record<string, number> = {}, finalize = true) {
  const m = (await w.store.read((db) => structuredClone(db.matchups.find((x) => x.id === matchupId)!)));
  const scores = (["A", "B"] as const).flatMap((side) =>
    (side === "A" ? m.lineupA : m.lineupB).flatMap((bowlerId) => [1, 2, 3].map((g) => ({ bowlerId, side, game: g, scratch: flat[bowlerId] ?? 170, kind: "bowled" as const })))
  );
  const res = await saveEntry(w.store, w.owner, w.leagueId, { matchupId, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores });
  if (finalize) await finalizeMatchup(w.store, w.owner, w.leagueId, matchupId, res.revision);
}

describe("rotating partners: drawing a week", () => {
  it("makes matches of two pairs, sits the rest out, and records the draw", async () => {
    const w = await partnersWorld(10);
    const draw = await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 7 });
    expect(draw.matches.filter((m) => m.b)).toHaveLength(2);
    expect(draw.matches.filter((m) => !m.b)).toHaveLength(2);
    const ms = await weekMatchups(w, 1);
    expect(ms).toHaveLength(4);
    const real = ms.filter((m) => m.sideB);
    expect(real.every((m) => m.kind === "team" && m.lineupA.length === 2 && m.lineupB.length === 2 && m.state === "scheduled")).toBe(true);
    const sitting = ms.filter((m) => !m.sideB);
    expect(sitting.every((m) => m.lineupA.length === 1 && m.state === "finalized")).toBe(true);
    const placed = ms.flatMap((m) => [...m.lineupA, ...m.lineupB]);
    expect([...placed].sort()).toEqual([...everyone(w)].sort());
    // Each side is a one-week id, never a team.
    expect(await w.store.read((db) => db.teams.filter((t) => t.leagueId === w.leagueId).length)).toBe(0);
    const audit = await w.store.read((db) => db.audit.filter((a) => a.leagueId === w.leagueId && a.action === "partners.drawn"));
    expect(audit).toHaveLength(1);
    expect(audit[0].after).toMatchObject({ week: 1, seed: 7, bowlers: 10 });
  });

  it("gives the same draw for the same seed, and replaces an earlier draw before scores exist", async () => {
    const w = await partnersWorld(10);
    const first = await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 11 });
    const again = await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 11 });
    expect(again.matches).toEqual(first.matches);
    expect(again.replaced).toBe(4);
    expect(await weekMatchups(w, 1)).toHaveLength(4);
    const other = await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 12 });
    expect(JSON.stringify(other.matches)).not.toEqual(JSON.stringify(first.matches));
  });

  it("draws only the bowlers picked, and shares sit-outs over the weeks", async () => {
    const w = await partnersWorld(10);
    const six = everyone(w).slice(0, 6);
    const d = await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: six, seed: 3 });
    expect(d.matches.filter((m) => m.b)).toHaveLength(1);
    expect(d.matches.filter((m) => !m.b)).toHaveLength(2);
    const bowling = (await weekMatchups(w, 1)).flatMap((m) => [...m.lineupA, ...m.lineupB]);
    expect([...bowling].sort()).toEqual([...six].sort());
  });

  it("avoids repeating partners from earlier weeks", async () => {
    const w = await partnersWorld(10);
    const seen = new Set<string>();
    for (let week = 1; week <= 4; week++) {
      await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week, bowlerIds: everyone(w), seed: week * 101 });
      for (const m of (await weekMatchups(w, week)).filter((x) => x.sideB))
        for (const pair of [m.lineupA, m.lineupB]) {
          const k = pairKey(pair[0], pair[1]);
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
    }
    expect(seen.size).toBe(16);
  });

  it("refuses bad draws with clear errors", async () => {
    const w = await partnersWorld(10);
    const draw = (patch: Partial<Parameters<typeof drawWeekPartners>[4]>) => drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 1, ...patch });
    expect(await code(() => draw({ bowlerIds: everyone(w).slice(0, 3) }))).toBe("validation");
    expect(await code(() => draw({ week: 42 }))).toBe("validation");
    const stranger = await addBowler(w.store, w.owner, w.leagueId, { name: "Not On Roster" });
    expect(await code(() => draw({ bowlerIds: [...everyone(w).slice(0, 5), stranger] }))).toBe("validation");
    expect(await code(() => draw({ bowlerIds: [...everyone(w).slice(0, 5), "no-such-bowler"] }))).toBe("not_found");
    // Only people who can manage the schedule may draw.
    const keeper = await join(w, "scorekeeper");
    expect(await code(() => drawWeekPartners(w.store, keeper, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 1 }))).toBe("forbidden");
  });

  it("will not redraw a week once scores are in, or draw a week that is already final", async () => {
    const w = await partnersWorld(10);
    await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 5 });
    const [first, second] = (await weekMatchups(w, 1)).filter((m) => m.sideB);
    await bowl(w, first.id, {}, false);
    expect(await code(() => drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 6 }))).toBe("conflict");
    await bowl(w, first.id);
    await bowl(w, second.id);
    expect(await code(() => drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 6 }))).toBe("conflict");
    // Later weeks are still open.
    await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 2, bowlerIds: everyone(w), seed: 6 });
  });

  it("is only for leagues that use rotating partners, and they have no generated schedule", async () => {
    const store = await mkStore();
    const owner = await mkUser(store, "owner");
    const { leagueId, seasonId } = await createLeague(store, owner, { name: "Plain League", visibility: "private", season: { name: "S", year: 2026, startDate: "2026-01-06", regularWeeks: 6 }, config: normalizeConfig(DEFAULT_CONFIG) });
    expect(await code(() => drawWeekPartners(store, owner, leagueId, seasonId, { week: 1, bowlerIds: ["a", "b", "c", "d"] }))).toBe("validation");
    const w = await partnersWorld(8);
    expect(await code(() => generateSchedule(w.store, w.owner, w.leagueId, w.seasonId))).toBe("validation");
    expect(await code(() => createMatchup(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, sideA: "x", sideB: "y" }))).toBe("validation");
  });
});

describe("rotating partners: a night of bowling", () => {
  it("credits each partner with their pair's win, then the bonus once the night is final", async () => {
    const w = await partnersWorld(10);
    await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 21 });
    const [first, second] = (await weekMatchups(w, 1)).filter((m) => m.sideB);
    const star = second.lineupB[0]; // on a pair that loses, but bowls the best series of the night
    await bowl(w, first.id, { ...Object.fromEntries(first.lineupA.map((b) => [b, 190])), ...Object.fromEntries(first.lineupB.map((b) => [b, 160])) });
    let rows = computeStandings(await model(w), { scope: "bowler" }).rows;
    expect(rows.every((r) => r.bonus === 0)).toBe(true); // the second match isn't final, so no bonus yet
    await bowl(w, second.id, { ...Object.fromEntries(second.lineupA.map((b) => [b, 180])), [star]: 200, [second.lineupB[1]]: 120 });
    rows = computeStandings(await model(w), { scope: "bowler" }).rows;
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    for (const b of first.lineupA) expect(by[b]).toMatchObject({ points: 2, wins: 1, played: 1 });
    for (const b of first.lineupB) expect(by[b]).toMatchObject({ points: 0, losses: 1 });
    // second match: A pair 180+180, B pair 200+120 → A (2160 vs 1920) wins
    for (const b of second.lineupA) expect(by[b]).toMatchObject({ points: 2 });
    expect(by[star]).toMatchObject({ points: 1, bonus: 1, losses: 1 }); // the top series, 600, earns the bonus although their pair lost
    expect(rows[0].points).toBe(2);
    expect(Object.values(by).filter((r) => r.bonus > 0)).toHaveLength(1);
    // Sitting out earns nothing by default.
    const sat = (await weekMatchups(w, 1)).filter((m) => !m.sideB).flatMap((m) => m.lineupA);
    for (const b of sat) expect(by[b]).toBeUndefined();
  });

  it("pays the points the league is configured with", async () => {
    const w = await partnersWorld(8, (c) => { c.partners.winPoints = 5; c.partners.bonusPoints = 3; c.partners.bonusFor = "pair"; });
    await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 2 });
    const [first, second] = (await weekMatchups(w, 1)).filter((m) => m.sideB);
    await bowl(w, first.id, Object.fromEntries(first.lineupA.map((b) => [b, 200])));
    await bowl(w, second.id, Object.fromEntries(second.lineupB.map((b) => [b, 150])));
    const by = Object.fromEntries(computeStandings(await model(w), { scope: "bowler" }).rows.map((r) => [r.id, r]));
    for (const b of first.lineupA) expect(by[b]).toMatchObject({ points: 8, bonus: 3 }); // 5 for the win + 3 for the highest combined total
    for (const b of first.lineupB) expect(by[b].points).toBe(0);
    for (const b of second.lineupB) expect(by[b]).toMatchObject({ points: 0 }); // 150s lose to 170s
    for (const b of second.lineupA) expect(by[b]).toMatchObject({ points: 5, bonus: 0 });
  });

  it("names each pair after its bowlers, and renaming a bowler renames the pair", async () => {
    const w = await partnersWorld(8);
    await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 4 });
    const [m] = (await weekMatchups(w, 1)).filter((x) => x.sideB);
    const names = (await model(w)).teamById;
    const [a, b] = m.lineupA;
    const nameOf = (id: string) => NAMES[everyone(w).indexOf(id)].split(" ")[0];
    expect(names.get(m.sideA)?.name).toBe(`${nameOf(a)} & ${nameOf(b)}`);
    await updateBowler(w.store, w.owner, w.leagueId, a, { name: "Pat Renamed" });
    expect((await model(w)).teamById.get(m.sideA)?.name).toBe(`Pat & ${nameOf(b)}`);
  });

  it("survives an export and import with the same standings", async () => {
    const w = await partnersWorld(8);
    await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 9 });
    const [first, second] = (await weekMatchups(w, 1)).filter((m) => m.sideB);
    await bowl(w, first.id, Object.fromEntries(first.lineupA.map((b) => [b, 200])));
    await bowl(w, second.id, Object.fromEntries(second.lineupB.map((b) => [b, 190])));
    const bundle = await exportBundle(w.store, w.owner, w.leagueId);
    const copy = await importBundle(w.store, w.owner, JSON.parse(JSON.stringify(bundle)), "Imported partners");
    const imported = await w.store.read((db) => {
      const season = db.seasons.find((s) => s.leagueId === copy.leagueId)!;
      return buildSeasonModel(seasonData(db, copy.leagueId, season.id));
    });
    const summary = (m: ReturnType<typeof buildSeasonModel>) => computeStandings(m, { scope: "bowler" }).rows.map((r) => `${r.name}:${r.points}:${r.bonus}:${r.wins}`).sort();
    expect(summary(imported)).toEqual(summary(await model(w)));
    expect(imported.pairTeamIds.size).toBe(4);
  });
});

describe("rotating partners: rules and exports", () => {
  it("names each pair in the schedule export", async () => {
    const w = await partnersWorld(8);
    await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 13 });
    const { csv } = await exportCsv(w.store, w.owner, w.leagueId, w.seasonId, "schedule");
    const lines = csv.trim().split("\n").slice(1);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.match(/ & /g)).toHaveLength(2); // "Alex & Sam" and "Jordan & Taylor"
  });

  it("lets the option change until scores exist, then locks it", async () => {
    const w = await partnersWorld(8);
    const current = await w.store.read((db) => structuredClone(db.seasons.find((s) => s.id === w.seasonId)!.ruleVersions.at(-1)!.config));
    const off = { ...current, bowlersPerTeam: 3, partners: { ...current.partners, enabled: false } };
    const before = await previewSeasonRules(w.store, w.owner, w.leagueId, w.seasonId, off, { type: "from_week", week: 1 });
    expect(before.blockers).toEqual([]);
    expect(before.classification.structural).toContain("partners.enabled");
    await drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 1 });
    const [m] = (await weekMatchups(w, 1)).filter((x) => x.sideB);
    await bowl(w, m.id, {}, false);
    const after = await previewSeasonRules(w.store, w.owner, w.leagueId, w.seasonId, off, { type: "from_week", week: 2 });
    expect(after.blockers.join(" ")).toMatch(/partners\.enabled cannot change/);
    // Changing the points is always allowed, and shows who it moves.
    const richer = { ...current, partners: { ...current.partners, winPoints: 4 } };
    const ok = await previewSeasonRules(w.store, w.owner, w.leagueId, w.seasonId, richer, { type: "from_week", week: 2 });
    expect(ok.blockers).toEqual([]);
  });
});
