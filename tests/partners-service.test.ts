import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig } from "@/domain/config";
import { buildSeasonModel } from "@/domain/engine";
import { guestLinks, pairKey } from "@/domain/partners";
import { computeStandings } from "@/domain/standings";
import { seasonData } from "@/server/access";
import { AppError } from "@/server/errors";
import { exportBundle, exportCsv, importBundle } from "@/server/services/data";
import { createLeague } from "@/server/services/leagues";
import { finalizeMatchup, saveEntry } from "@/server/services/results";
import { previewSeasonRules } from "@/server/services/rules";
import { addBowler, addToRoster, createMatchup, deleteMatchup, drawWeekPartners, generateSchedule, moveMatchup, updateBowler } from "@/server/services/season";
import { join, mkStore, mkUser, type World } from "./world";

const code = async (fn: () => unknown) => {
  try { await fn(); } catch (e) { if (e instanceof AppError) return e.code; throw e; }
  return "none";
};

/** The template's scoring: 2 a game, 1 for the higher total. */
const partnersConfig = (patch: (c: ReturnType<typeof normalizeConfig>) => void = () => {}) => {
  const c = normalizeConfig(DEFAULT_CONFIG);
  c.bowlersPerTeam = 2;
  c.scheduleFormat = "manual";
  c.partners.enabled = true;
  c.scoring.pointsPerGame = 2;
  c.scoring.pointsPerSeries = 1;
  c.handicap.enabled = false;
  c.scoring.basis = "scratch";
  c.standings.pinsBasis = "scratch";
  patch(c);
  return c;
};

const NAMES = ["Alex Rivera", "Sam Chen", "Jordan Blake", "Taylor Nguyen", "Casey Morgan", "Riley Patel", "Jamie Okafor", "Morgan Reyes", "Quinn Larsen", "Avery Kim", "Drew Santos", "Harper Lee", "Reese Cooper", "Blake Turner"];

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
const draw = (w: World, week: number, seed: number, bowlerIds = everyone(w)) => drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week, bowlerIds, seed });

type MatchupRow = Awaited<ReturnType<typeof weekMatchups>>[number];
/** `extra`: the extra pair's comparison; `solo`: the odd bowler's 1v1; `sitting`: byes from before a 1v1 replaced them. */
type Week = { real: MatchupRow[]; extra?: MatchupRow; solo?: MatchupRow; sitting: MatchupRow[] };
async function weekOf(w: World, week: number): Promise<Week> {
  const ms = await weekMatchups(w, week);
  const links = guestLinks(ms);
  return { real: ms.filter((m) => m.sideB && !links.has(m.id)), extra: ms.find((m) => links.has(m.id) && !links.get(m.id)!.only), solo: ms.find((m) => links.get(m.id)?.only), sitting: ms.filter((m) => !m.sideB) };
}

/** Every bowler of a matchup bowls the flat score given for them (default 170) in all three games. Side B is skipped for an extra comparison. */
async function bowl(w: World, matchupId: string, flat: Record<string, number> = {}, finalize = true) {
  const m = await w.store.read((db) => structuredClone(db.matchups.find((x) => x.id === matchupId)!));
  const scores = (["A", "B"] as const).flatMap((side) =>
    (side === "A" ? m.lineupA : m.lineupB).flatMap((bowlerId) => [1, 2, 3].map((g) => ({ bowlerId, side, game: g, scratch: flat[bowlerId] ?? 170, kind: "bowled" as const })))
  );
  const res = await saveEntry(w.store, w.owner, w.leagueId, { matchupId, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores });
  if (finalize) await finalizeMatchup(w.store, w.owner, w.leagueId, matchupId, res.revision);
}
const flatFor = (ids: string[], score: number) => Object.fromEntries(ids.map((b) => [b, score]));

describe("rotating partners: drawing a week", () => {
  it("with ten bowlers everyone bowls: two matches and an extra comparison", async () => {
    const w = await partnersWorld(10);
    const d = await draw(w, 1, 7);
    expect(d.matches.map((m) => (m.extra ? "extra" : m.b ? "match" : "sits"))).toEqual(["match", "match", "extra"]);
    const { real, extra, sitting } = await weekOf(w, 1);
    expect(real).toHaveLength(2);
    expect(sitting).toHaveLength(0);
    expect(extra).toBeDefined();
    expect(real.every((m) => m.kind === "team" && m.lineupA.length === 2 && m.lineupB.length === 2 && m.state === "scheduled")).toBe(true);
    // The extra pair is compared with a pair from a real match, found by sharing that pair's side id (its A side).
    const ref = real.find((m) => m.sideA === extra!.sideB)!;
    expect(ref).toBeDefined();
    expect(extra!.lineupB).toEqual(ref.lineupA);
    const bowling = [...real.flatMap((m) => [...m.lineupA, ...m.lineupB]), ...extra!.lineupA];
    expect([...bowling].sort()).toEqual([...everyone(w)].sort());
    expect(await w.store.read((db) => db.teams.filter((t) => t.leagueId === w.leagueId).length)).toBe(0);
    const audit = await w.store.read((db) => db.audit.filter((a) => a.leagueId === w.leagueId && a.action === "partners.drawn"));
    expect(audit).toHaveLength(1);
    expect(audit[0].after).toMatchObject({ week: 1, seed: 7, bowlers: 10 });
  });

  it("with twelve bowlers there are three matches and nobody is left over", async () => {
    const w = await partnersWorld(12);
    await draw(w, 1, 3);
    const { real, extra, sitting } = await weekOf(w, 1);
    expect([real.length, extra === undefined, sitting.length]).toEqual([3, true, 0]);
  });

  it("with an odd number the odd bowler bowls a 1v1 against one bowler's scores, and the turns are shared", async () => {
    const w = await partnersWorld(11);
    const odd = new Set<string>();
    for (let week = 1; week <= 4; week++) {
      const d = await draw(w, week, week * 17);
      expect(d.matches.map((m) => (m.single ? "single" : m.extra ? "extra" : "match"))).toEqual(["match", "match", "extra", "single"]);
      expect(d.shown.at(-1)).toMatchObject({ extra: true, single: true, b: expect.not.stringContaining("&") });
      const { real, extra, solo, sitting } = await weekOf(w, week);
      expect([real.length, extra !== undefined, solo !== undefined, sitting.length]).toEqual([2, true, true, 0]);
      expect([solo!.lineupA.length, solo!.lineupB.length, solo!.state]).toEqual([1, 1, "scheduled"]);
      // Side B is the id of the bowler it is compared with, who plays in one of the real matches.
      expect(solo!.sideB).toBe(solo!.lineupB[0]);
      expect(real.flatMap((m) => [...m.lineupA, ...m.lineupB])).toContain(solo!.sideB);
      expect(odd.has(solo!.lineupA[0])).toBe(false); // everyone takes a turn before anyone repeats
      odd.add(solo!.lineupA[0]);
      // Everyone bowls exactly once.
      const bowling = [...real.flatMap((m) => [...m.lineupA, ...m.lineupB]), ...extra!.lineupA, ...solo!.lineupA];
      expect([...bowling].sort()).toEqual([...everyone(w)].sort());
    }
  });

  it("with thirteen bowlers there are three matches and a 1v1 for the odd bowler, and no extra pair", async () => {
    const w = await partnersWorld(13);
    const d = await draw(w, 1, 5);
    expect(d.matches.map((m) => (m.single ? "single" : m.extra ? "extra" : "match"))).toEqual(["match", "match", "match", "single"]);
    const { real, extra, solo } = await weekOf(w, 1);
    expect([real.length, extra === undefined, solo !== undefined]).toEqual([3, true, true]);
    expect([...[...real.flatMap((m) => [...m.lineupA, ...m.lineupB]), ...solo!.lineupA]].sort()).toEqual([...everyone(w)].sort());
    const audit = await w.store.read((db) => db.audit.filter((a) => a.action === "partners.drawn"));
    expect((audit[0].after as { matches: string[] }).matches.at(-1)).toMatch(/'s scores \(1v1\)$/);
  });

  it("gives the same draw for the same seed, and replaces an earlier draw before scores exist", async () => {
    const w = await partnersWorld(10);
    const first = await draw(w, 1, 11);
    const again = await draw(w, 1, 11);
    expect(again.matches).toEqual(first.matches);
    expect(again.replaced).toBe(3);
    expect(await weekMatchups(w, 1)).toHaveLength(3);
    const other = await draw(w, 1, 12);
    expect(JSON.stringify(other.matches)).not.toEqual(JSON.stringify(first.matches));
  });

  it("draws only the bowlers picked", async () => {
    const w = await partnersWorld(10);
    const six = everyone(w).slice(0, 6);
    await draw(w, 1, 3, six);
    const { real, extra } = await weekOf(w, 1);
    expect([real.length, extra !== undefined]).toEqual([1, true]);
    const bowling = (await weekMatchups(w, 1)).flatMap((m) => [...m.lineupA, ...(m.id === extra!.id ? [] : m.lineupB)]);
    expect([...bowling].sort()).toEqual([...six].sort());
  });

  it("avoids repeating partners from earlier weeks", async () => {
    const w = await partnersWorld(10);
    const seen = new Set<string>();
    for (let week = 1; week <= 4; week++) {
      await draw(w, week, week * 101);
      const { real, extra } = await weekOf(w, week);
      for (const pair of [...real.flatMap((m) => [m.lineupA, m.lineupB]), extra!.lineupA]) {
        const k = pairKey(pair[0], pair[1]);
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
    expect(seen.size).toBe(20);
  });

  it("refuses bad draws with clear errors", async () => {
    const w = await partnersWorld(10);
    const attempt = (patch: Partial<Parameters<typeof drawWeekPartners>[4]>) => drawWeekPartners(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 1, ...patch });
    expect(await code(() => attempt({ bowlerIds: everyone(w).slice(0, 3) }))).toBe("validation");
    expect(await code(() => attempt({ week: 42 }))).toBe("validation");
    const stranger = await addBowler(w.store, w.owner, w.leagueId, { name: "Not On Roster" });
    expect(await code(() => attempt({ bowlerIds: [...everyone(w).slice(0, 5), stranger] }))).toBe("validation");
    expect(await code(() => attempt({ bowlerIds: [...everyone(w).slice(0, 5), "no-such-bowler"] }))).toBe("not_found");
    const keeper = await join(w, "scorekeeper");
    expect(await code(() => drawWeekPartners(w.store, keeper, w.leagueId, w.seasonId, { week: 1, bowlerIds: everyone(w), seed: 1 }))).toBe("forbidden");
  });

  it("will not redraw a week once scores are in, or draw a week that is already final", async () => {
    const w = await partnersWorld(10);
    await draw(w, 1, 5);
    const { real } = await weekOf(w, 1);
    await bowl(w, real[0].id, {}, false);
    expect(await code(() => draw(w, 1, 6))).toBe("conflict");
    await bowl(w, real[0].id);
    await bowl(w, real[1].id);
    expect(await code(() => draw(w, 1, 6))).toBe("conflict");
    await draw(w, 2, 6); // later weeks are still open
  });

  it("is only for leagues that use rotating partners, which have no generated schedule", async () => {
    const store = await mkStore();
    const owner = await mkUser(store, "owner");
    const { leagueId, seasonId } = await createLeague(store, owner, { name: "Plain League", visibility: "private", season: { name: "S", year: 2026, startDate: "2026-01-06", regularWeeks: 6 }, config: normalizeConfig(DEFAULT_CONFIG) });
    expect(await code(() => drawWeekPartners(store, owner, leagueId, seasonId, { week: 1, bowlerIds: ["a", "b", "c", "d"] }))).toBe("validation");
    const w = await partnersWorld(8);
    expect(await code(() => generateSchedule(w.store, w.owner, w.leagueId, w.seasonId))).toBe("validation");
    expect(await code(() => createMatchup(w.store, w.owner, w.leagueId, w.seasonId, { week: 1, sideA: "x", sideB: "y" }))).toBe("validation");
  });

  it("won't move a drawn matchup, or remove one that an extra comparison depends on", async () => {
    const w = await partnersWorld(10);
    await draw(w, 1, 9);
    const { real, extra } = await weekOf(w, 1);
    expect(await code(() => moveMatchup(w.store, w.owner, w.leagueId, real[0].id, 2))).toBe("validation");
    const ref = real.find((m) => m.sideA === extra!.sideB)!;
    expect(await code(() => deleteMatchup(w.store, w.owner, w.leagueId, ref.id))).toBe("conflict");
    await deleteMatchup(w.store, w.owner, w.leagueId, extra!.id);
    await deleteMatchup(w.store, w.owner, w.leagueId, ref.id);
    expect(await weekMatchups(w, 1)).toHaveLength(1);
  });
});

describe("rotating partners: a night of bowling", () => {
  it("scores a ten-bowler night: 2 a game, 1 for the total, up to 7, with the extra pair compared", async () => {
    const w = await partnersWorld(10);
    await draw(w, 1, 21);
    const { real, extra } = await weekOf(w, 1);
    const [first, second] = real;
    const ref = real.find((m) => m.sideA === extra!.sideB)!;
    // The extra pair bowls first (175 a game), but can't be finalized until the pair it is compared with is final.
    await bowl(w, extra!.id, flatFor(extra!.lineupA, 175), false);
    const revision = async () => (await w.store.read((db) => db.matchups.find((x) => x.id === extra!.id)!.revision));
    expect(await code(async () => finalizeMatchup(w.store, w.owner, w.leagueId, extra!.id, await revision()))).toBe("validation");
    // First match: A sweeps B. Second match: B sweeps A.
    await bowl(w, first.id, { ...flatFor(first.lineupA, 190), ...flatFor(first.lineupB, 160) });
    await bowl(w, second.id, { ...flatFor(second.lineupA, 160), ...flatFor(second.lineupB, 190) });
    expect((await model(w)).guests.size).toBe(1);
    await finalizeMatchup(w.store, w.owner, w.leagueId, extra!.id, await revision());

    const rows = Object.fromEntries(computeStandings(await model(w), { scope: "bowler" }).rows.map((r) => [r.id, r]));
    const winnersOf = (mu: typeof first) => (mu === first ? mu.lineupA : mu.lineupB);
    const losersOf = (mu: typeof first) => (mu === first ? mu.lineupB : mu.lineupA);
    for (const b of [...winnersOf(first), ...winnersOf(second)]) expect(rows[b].points).toBe(7); // 3 games × 2 + 1 for the total
    for (const b of [...losersOf(first), ...losersOf(second)]) expect(rows[b].points).toBe(0);
    // The extra pair bowled 175 a game: it beats a 160 pair completely and loses completely to a 190 pair.
    const refScore = ref === first ? 190 : 160; // the compared pair is the A side of its match
    const expectedExtra = refScore === 160 ? 7 : 0;
    for (const b of extra!.lineupA) expect(rows[b]).toMatchObject({ points: expectedExtra, played: 1 });
    // The compared pair keeps what its own match earned: 7 if it won, 0 if not.
    for (const b of ref.lineupA) expect(rows[b]?.points ?? 0).toBe(refScore === 190 ? 7 : 0);
    // Everyone's points are between 0 and 7.
    expect(Math.max(...Object.values(rows).map((r) => r.points))).toBe(7);
    expect(Object.keys(rows)).toHaveLength(10);
  });

  it("scores a thirteen-bowler night: the odd bowler's 1v1 pays only them, and costs the compared bowler nothing", async () => {
    const w = await partnersWorld(13);
    await draw(w, 1, 8);
    const { real, solo } = await weekOf(w, 1);
    const oddOne = solo!.lineupA[0];
    const target = solo!.lineupB[0];
    // A sweeps B in every match (190 to 160); the odd bowler bowls 175 a game.
    for (const m of real.slice(0, 2)) await bowl(w, m.id, { ...flatFor(m.lineupA, 190), ...flatFor(m.lineupB, 160) }, false);
    await bowl(w, solo!.id, { [oddOne]: 175 }, false);
    const rev = async (id: string) => w.store.read((db) => db.matchups.find((x) => x.id === id)!.revision);
    const targetMatch = real.find((m) => [...m.lineupA, ...m.lineupB].includes(target))!;
    // Not until the compared bowler's own match is final.
    if (targetMatch === real[2]) await bowl(w, real[2].id, { ...flatFor(real[2].lineupA, 190), ...flatFor(real[2].lineupB, 160) }, false);
    expect(await code(async () => finalizeMatchup(w.store, w.owner, w.leagueId, solo!.id, await rev(solo!.id)))).toBe("validation");
    for (const m of real) {
      if (m === real[2] && targetMatch !== real[2]) await bowl(w, m.id, { ...flatFor(m.lineupA, 190), ...flatFor(m.lineupB, 160) }, false);
      const r = await rev(m.id);
      await finalizeMatchup(w.store, w.owner, w.leagueId, m.id, r);
    }
    await finalizeMatchup(w.store, w.owner, w.leagueId, solo!.id, await rev(solo!.id));
    const rows = Object.fromEntries(computeStandings(await model(w), { scope: "bowler" }).rows.map((r) => [r.id, r]));
    const targetScore = targetMatch.lineupA.includes(target) ? 190 : 160;
    expect(rows[oddOne]).toMatchObject({ points: targetScore === 160 ? 7 : 0, played: 1 }); // 175 beats 160 completely, and loses completely to 190
    for (const m of real) {
      for (const b of m.lineupA) expect(rows[b].points).toBe(7);
      for (const b of m.lineupB) expect(rows[b].points).toBe(0);
    }
    expect(Object.keys(rows)).toHaveLength(13);
    const { collectNights } = await import("@/domain/stats");
    expect(collectNights(await model(w))).toHaveLength(13); // nobody's games are counted twice
  });

  it("saves only the odd bowler's own scores, and keeps one bowler on each side", async () => {
    const w = await partnersWorld(11);
    await draw(w, 1, 12);
    const { real, solo } = await weekOf(w, 1);
    const oddOne = solo!.lineupA[0];
    const target = solo!.lineupB[0];
    const targetMatch = real.find((m) => [...m.lineupA, ...m.lineupB].includes(target))!;
    await bowl(w, targetMatch.id, flatFor([...targetMatch.lineupA, ...targetMatch.lineupB], 180));
    const stored = await w.store.read((db) => structuredClone(db.matchups.find((x) => x.id === solo!.id)!));
    // Scores for the compared bowler, or a different lineup for them, cannot change their side.
    const sneaky = [oddOne, target].flatMap((bowlerId, i) => [1, 2, 3].map((g) => ({ bowlerId, side: (i === 0 ? "A" : "B") as "A" | "B", game: g, scratch: i === 0 ? 190 : 300, kind: "bowled" as const })));
    await saveEntry(w.store, w.owner, w.leagueId, { matchupId: solo!.id, expectedRevision: stored.revision, lineupA: [oddOne], lineupB: [oddOne], scores: sneaky });
    const after = await w.store.read((db) => ({ m: structuredClone(db.matchups.find((x) => x.id === solo!.id)!), scores: db.scores.filter((s) => s.matchupId === solo!.id) }));
    expect(after.m.lineupB).toEqual([target]);
    expect(after.scores.every((s) => s.side === "A" && s.bowlerId === oddOne)).toBe(true);
    expect(after.scores).toHaveLength(3);
    const result = (await model(w)).resultById.get(solo!.id)!;
    expect(result.b!.scratchSeries).toBe(3 * 180); // the compared bowler's real scores, not the sneaky 300s
    expect(result.winner).toBe("A");
    // A second bowler on the odd bowler's side is refused: it is one bowler against one bowler.
    const other = everyone(w).find((b) => ![oddOne, target].includes(b))!;
    expect(await code(() => saveEntry(w.store, w.owner, w.leagueId, { matchupId: solo!.id, expectedRevision: after.m.revision, lineupA: [oddOne, other], lineupB: [target], scores: [] }))).toBe("validation");
  });

  it("won't take the compared bowler out of their match, or remove that match, while the 1v1 stands", async () => {
    const w = await partnersWorld(9);
    await draw(w, 1, 15);
    const { real, solo } = await weekOf(w, 1);
    const target = solo!.lineupB[0];
    const targetMatch = real.find((m) => [...m.lineupA, ...m.lineupB].includes(target))!;
    const swapped = (lineup: string[]) => lineup.map((b) => (b === target ? solo!.lineupA[0] : b));
    expect(await code(() => saveEntry(w.store, w.owner, w.leagueId, { matchupId: targetMatch.id, expectedRevision: targetMatch.revision, lineupA: swapped(targetMatch.lineupA), lineupB: swapped(targetMatch.lineupB), scores: [] }))).toBe("validation");
    expect(await code(() => deleteMatchup(w.store, w.owner, w.leagueId, targetMatch.id))).toBe("conflict");
    expect(await code(() => moveMatchup(w.store, w.owner, w.leagueId, solo!.id, 2))).toBe("validation");
    await deleteMatchup(w.store, w.owner, w.leagueId, solo!.id);
    await deleteMatchup(w.store, w.owner, w.leagueId, targetMatch.id);
    expect(await weekMatchups(w, 1)).toHaveLength(real.length - 1);
  });

  it("saves only the extra pair's own scores, and keeps the compared pair in sync", async () => {
    const w = await partnersWorld(10);
    await draw(w, 1, 31);
    const { real, extra } = await weekOf(w, 1);
    const ref = real.find((m) => m.sideA === extra!.sideB)!;
    await bowl(w, ref.id, flatFor(ref.lineupA, 180));
    // A client that also sends scores for the compared pair, or a different lineup for them, cannot change their side.
    const stored = await w.store.read((db) => structuredClone(db.matchups.find((x) => x.id === extra!.id)!));
    const sneaky = [...extra!.lineupA, ...ref.lineupA].flatMap((bowlerId, i) => [1, 2, 3].map((g) => ({ bowlerId, side: (i < 2 ? "A" : "B") as "A" | "B", game: g, scratch: i < 2 ? 190 : 300, kind: "bowled" as const })));
    await saveEntry(w.store, w.owner, w.leagueId, { matchupId: extra!.id, expectedRevision: stored.revision, lineupA: extra!.lineupA, lineupB: [extra!.lineupA[0]], scores: sneaky });
    const after = await w.store.read((db) => ({ m: structuredClone(db.matchups.find((x) => x.id === extra!.id)!), scores: db.scores.filter((s) => s.matchupId === extra!.id) }));
    expect(after.m.lineupB).toEqual(ref.lineupA);
    expect(after.scores.every((s) => s.side === "A")).toBe(true);
    expect(after.scores).toHaveLength(6);
    const result = (await model(w)).results.find((r) => r.guest)!;
    expect(result.b!.scratchSeries).toBe(2 * 3 * 180); // the compared pair's real scores
    expect(result.winner).toBe("A");
  });

  it("does not count the compared pair's games twice in anyone's stats", async () => {
    const w = await partnersWorld(10);
    await draw(w, 1, 41);
    const { real, extra } = await weekOf(w, 1);
    for (const m of real) await bowl(w, m.id);
    await bowl(w, extra!.id, flatFor(extra!.lineupA, 170));
    const { collectNights } = await import("@/domain/stats");
    const nights = collectNights(await model(w));
    expect(nights).toHaveLength(10);
    expect(new Set(nights.map((n) => n.bowlerId)).size).toBe(10);
  });

  it("names each pair after its bowlers, and renaming a bowler renames the pair", async () => {
    const w = await partnersWorld(8);
    await draw(w, 1, 4);
    const [m] = (await weekMatchups(w, 1)).filter((x) => x.sideB);
    const names = (await model(w)).teamById;
    const [a, b] = m.lineupA;
    const nameOf = (id: string) => NAMES[everyone(w).indexOf(id)].split(" ")[0];
    expect(names.get(m.sideA)?.name).toBe(`${nameOf(a)} & ${nameOf(b)}`);
    await updateBowler(w.store, w.owner, w.leagueId, a, { name: "Pat Renamed" });
    expect((await model(w)).teamById.get(m.sideA)?.name).toBe(`Pat & ${nameOf(b)}`);
  });

  it("survives an export and import with the same standings, extra comparison and 1v1 included", async () => {
    const w = await partnersWorld(11);
    await draw(w, 1, 9);
    const { real, extra, solo } = await weekOf(w, 1);
    for (const m of real) await bowl(w, m.id, { ...flatFor(m.lineupA, 200), ...flatFor(m.lineupB, 150) });
    await bowl(w, extra!.id, flatFor(extra!.lineupA, 180));
    await bowl(w, solo!.id, flatFor(solo!.lineupA, 175));
    const bundle = await exportBundle(w.store, w.owner, w.leagueId);
    const copy = await importBundle(w.store, w.owner, JSON.parse(JSON.stringify(bundle)), "Imported partners");
    const imported = await w.store.read((db) => {
      const season = db.seasons.find((s) => s.leagueId === copy.leagueId)!;
      return buildSeasonModel(seasonData(db, copy.leagueId, season.id));
    });
    const summary = (m: ReturnType<typeof buildSeasonModel>) => computeStandings(m, { scope: "bowler" }).rows.map((r) => `${r.name}:${r.points}:${r.wins}`).sort();
    expect(summary(imported)).toEqual(summary(await model(w)));
    expect(imported.guests.size).toBe(2); // the extra pair's comparison and the odd bowler's 1v1 are both found again
    expect([...imported.guests.values()].filter((l) => l.only)).toHaveLength(1);
  });
});

describe("rotating partners: rules and exports", () => {
  it("names each pair in the schedule export", async () => {
    const w = await partnersWorld(8);
    await draw(w, 1, 13);
    const { csv } = await exportCsv(w.store, w.owner, w.leagueId, w.seasonId, "schedule");
    const lines = csv.trim().split("\n").slice(1);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.match(/ & /g)).toHaveLength(2);
  });

  it("lets the option change until scores exist, then locks it", async () => {
    const w = await partnersWorld(8);
    const current = await w.store.read((db) => structuredClone(db.seasons.find((s) => s.id === w.seasonId)!.ruleVersions.at(-1)!.config));
    const off = { ...current, bowlersPerTeam: 3, partners: { ...current.partners, enabled: false } };
    const before = await previewSeasonRules(w.store, w.owner, w.leagueId, w.seasonId, off, { type: "from_week", week: 1 });
    expect(before.blockers).toEqual([]);
    expect(before.classification.structural).toContain("partners.enabled");
    await draw(w, 1, 1);
    const [m] = (await weekOf(w, 1)).real;
    await bowl(w, m.id, {}, false);
    const after = await previewSeasonRules(w.store, w.owner, w.leagueId, w.seasonId, off, { type: "from_week", week: 2 });
    expect(after.blockers.join(" ")).toMatch(/partners\.enabled cannot change/);
    const richer = { ...current, scoring: { ...current.scoring, pointsPerGame: 3 } };
    const ok = await previewSeasonRules(w.store, w.owner, w.leagueId, w.seasonId, richer, { type: "from_week", week: 2 });
    expect(ok.blockers).toEqual([]);
  });
});
