import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, STARTER_TEMPLATES, partnersOf, usesPartners, validateConfig, type RuleConfig } from "@/domain/config";
import { describeRules } from "@/domain/describe";
import { buildSeasonModel } from "@/domain/engine";
import { drawPartners, emptyHistory, guestLinks, pairKey, pairName, pairTeamFor, partnerHistory, seededRandom, type PartnerHistory } from "@/domain/partners";
import { collectNights } from "@/domain/stats";
import { computeStandings, standingsScope } from "@/domain/standings";
import { validateEntry } from "@/domain/validate";
import { cfgWith, fixture, type Fixture } from "./helpers";

const bowlerIds = (n: number) => Array.from({ length: n }, (_, i) => `P${String(i + 1).padStart(2, "0")}`);

/** Applies a drawn week to a history, the way the matchups it creates would. */
function record(h: PartnerHistory, draw: ReturnType<typeof drawPartners>) {
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const m of draw.matches) {
    for (const side of m.extra ? [m.a] : [m.a, m.b ?? []]) if (side.length === 2) bump(h.partnered, pairKey(side[0], side[1]));
    if (m.b) for (const x of m.a) for (const y of m.b) bump(h.faced, pairKey(x, y));
    else for (const x of m.a) h.rests.set(x, (h.rests.get(x) ?? 0) + 1);
    if (m.extra) for (const x of m.a) h.floats.set(x, (h.floats.get(x) ?? 0) + 1);
  }
}

describe("partner draw", () => {
  it("needs at least four bowlers", () => {
    expect(() => drawPartners(bowlerIds(3), emptyHistory(), seededRandom(1))).toThrow(/at least four/);
  });

  it("puts every bowler in exactly one place", () => {
    for (let n = 4; n <= 15; n++) {
      const ids = bowlerIds(n);
      const d = drawPartners(ids, emptyHistory(), seededRandom(n));
      const seen = d.matches.flatMap((m) => (m.extra ? m.a : [...m.a, ...(m.b ?? [])]));
      // The extra pair's comparison names the pair it is compared with, who already play in a real match.
      const placed = d.matches.filter((m) => !m.extra).flatMap((m) => [...m.a, ...(m.b ?? [])]).concat(d.matches.filter((m) => m.extra).flatMap((m) => m.a));
      expect([...placed].sort()).toEqual([...ids].sort());
      expect(seen).toHaveLength(n);
      const pairs = Math.floor(n / 2);
      expect(d.matches.filter((m) => m.b && !m.extra)).toHaveLength(Math.floor(pairs / 2));
      expect(d.matches.filter((m) => m.extra)).toHaveLength(pairs % 2);
      expect(d.resting).toHaveLength(n % 2);
      for (const m of d.matches) expect(m.b ? [m.a.length, m.b.length] : [m.a.length]).toEqual(m.b ? [2, 2] : [1]);
    }
  });

  it("with ten bowlers everyone bowls: two matches and one extra pair", () => {
    const d = drawPartners(bowlerIds(10), emptyHistory(), seededRandom(5));
    expect(d.matches.map((m) => (m.extra ? "extra" : m.b ? "match" : "sits"))).toEqual(["match", "match", "extra"]);
    expect(d.resting).toEqual([]);
  });

  it("with twelve bowlers there are three matches and no extra pair", () => {
    const d = drawPartners(bowlerIds(12), emptyHistory(), seededRandom(5));
    expect(d.matches.map((m) => (m.extra ? "extra" : m.b ? "match" : "sits"))).toEqual(["match", "match", "match"]);
  });

  it("with an odd number of bowlers one sits out, listed last", () => {
    const d = drawPartners(bowlerIds(11), emptyHistory(), seededRandom(8));
    expect(d.matches.map((m) => (m.extra ? "extra" : m.b ? "match" : "sits"))).toEqual(["match", "match", "extra", "sits"]);
    expect(d.resting).toHaveLength(1);
  });

  it("compares the extra pair with the A side of a real match", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const d = drawPartners(bowlerIds(10), emptyHistory(), seededRandom(seed));
      const extra = d.matches.find((m) => m.extra)!;
      expect(d.matches.filter((m) => !m.extra && m.b).some((m) => m.a.join() === extra.b!.join())).toBe(true);
    }
  });

  it("is repeatable from its seed and varies between seeds", () => {
    const a = drawPartners(bowlerIds(10), emptyHistory(), seededRandom(42));
    const b = drawPartners(bowlerIds(10), emptyHistory(), seededRandom(42));
    expect(b).toEqual(a);
    const others = Array.from({ length: 10 }, (_, i) => JSON.stringify(drawPartners(bowlerIds(10), emptyHistory(), seededRandom(100 + i))));
    expect(new Set(others).size).toBeGreaterThan(5);
  });

  it("does not repeat a partner while there are new partners to try", () => {
    for (const n of [10, 12]) {
      for (let seed = 1; seed <= 40; seed++) {
        const rand = seededRandom(seed);
        const h = emptyHistory();
        const weeks = n - 3; // comfortably inside the n-1 weeks of fresh partners
        for (let week = 1; week <= weeks; week++) record(h, drawPartners(bowlerIds(n), h, rand));
        expect([...h.partnered.values()].every((c) => c === 1)).toBe(true);
        expect(h.partnered.size).toBe(weeks * (n / 2));
      }
    }
  });

  it("almost never repeats a partner in a season shorter than the number of other bowlers", () => {
    let repeats = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const rand = seededRandom(seed);
      const h = emptyHistory();
      for (let week = 1; week <= 9; week++) record(h, drawPartners(bowlerIds(10), h, rand));
      if ([...h.partnered.values()].some((c) => c > 1)) repeats++;
    }
    expect(repeats).toBeLessThanOrEqual(5); // measured: about 1 season in 75
  });

  it("shares the extra-pair turns out", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rand = seededRandom(seed);
      const h = emptyHistory();
      const ids = bowlerIds(10);
      for (let week = 1; week <= 5; week++) record(h, drawPartners(ids, h, rand));
      const floats = ids.map((id) => h.floats.get(id) ?? 0);
      expect(floats.reduce((a, b) => a + b, 0)).toBe(10);
      expect(Math.max(...floats)).toBeLessThanOrEqual(2);
    }
  });

  it("shares the sit-outs when there is an odd number of bowlers", () => {
    const rand = seededRandom(3);
    const h = emptyHistory();
    const ids = bowlerIds(11);
    for (let week = 1; week <= 11; week++) record(h, drawPartners(ids, h, rand));
    expect(ids.map((id) => h.rests.get(id) ?? 0)).toEqual(Array(11).fill(1));
  });

  it("builds its history from the other weeks' matchups", () => {
    const fx = fixture({ teams: 4, perTeam: 2 });
    const base = { kind: "team" as const };
    fx.addMatchup(1, "S1", "S2", { A: [] }, "finalized", { ...base, lineupA: ["B11", "B12"], lineupB: ["B21", "B22"] });
    // Extra comparison: B31/B32 against the pair S1 (B11/B12), who also play in the real match above.
    fx.addMatchup(1, "S3", "S1", { A: [] }, "finalized", { ...base, lineupA: ["B31", "B32"], lineupB: ["B11", "B12"] });
    fx.addMatchup(1, "S4", null, { A: [] }, "finalized", { ...base, lineupA: ["B41"], lineupB: [] });
    fx.addMatchup(2, "S5", "S6", { A: [] }, "scheduled", { ...base, lineupA: ["B11", "B21"], lineupB: ["B12", "B22"] });
    const h = partnerHistory(fx.data, 2);
    expect(h.partnered.get(pairKey("B11", "B12"))).toBe(1); // counted once, not again for the extra comparison
    expect(h.partnered.get(pairKey("B31", "B32"))).toBe(1);
    expect(h.partnered.get(pairKey("B11", "B21"))).toBeUndefined();
    expect(h.faced.get(pairKey("B11", "B21"))).toBe(1);
    expect(h.faced.get(pairKey("B31", "B11"))).toBe(1);
    expect(h.floats.get("B31")).toBe(1);
    expect(h.floats.get("B11")).toBeUndefined();
    expect(h.rests.get("B41")).toBe(1);
    expect(partnerHistory(fx.data).partnered.get(pairKey("B11", "B21"))).toBe(1);
  });

  it("recognises an extra comparison by its shared pair", () => {
    const fx = fixture({ teams: 4, perTeam: 2 });
    const real = fx.addMatchup(1, "S1", "S2", { A: [] }, "finalized", { lineupA: ["B11", "B12"], lineupB: ["B21", "B22"] });
    const extra = fx.addMatchup(1, "S3", "S1", { A: [] }, "finalized", { lineupA: ["B31", "B32"], lineupB: ["B11", "B12"] });
    const other = fx.addMatchup(2, "S4", "S5", { A: [] }, "scheduled", { lineupA: ["B11", "B21"], lineupB: ["B12", "B22"] });
    const links = guestLinks(fx.data.matchups);
    expect([...links.keys()]).toEqual([extra.id]);
    expect(links.get(extra.id)).toMatchObject({ refSide: "A" });
    expect(links.get(extra.id)!.ref.id).toBe(real.id);
    expect(links.has(other.id)).toBe(false);
  });

  it("names a pair after its lineup", () => {
    const bowlers = new Map([["a", { name: "Alex Rivera", avatarColor: "#111" }], ["b", { name: "Sam Chen", avatarColor: "#222" }], ["c", { name: "Sam Patel", avatarColor: "#333" }]]);
    expect(pairTeamFor("x", "L1", ["a", "b"], bowlers)).toMatchObject({ id: "x", name: "Alex & Sam C.", logo: "AS", color: "#111", active: false });
    expect(pairTeamFor("x", "L1", ["c", "a"], bowlers)?.name).toBe("Sam P. & Alex");
    expect(pairTeamFor("x", "L1", [], bowlers)).toBeNull();
    expect(pairTeamFor("x", "L1", ["zz"], bowlers)).toBeNull();
    expect(pairName("Cher", [{ name: "Cher" }])).toBe("Cher");
  });
});

// ---------------------------------------------------------------------------------------------------------------------

/** Two points a game, one for the higher total: seven a night at most. */
const partnersCfg = (patch: (c: RuleConfig) => void = () => {}) =>
  cfgWith((c) => {
    c.bowlersPerTeam = 2;
    c.partners.enabled = true;
    c.scoring.pointsPerGame = 2;
    c.scoring.pointsPerSeries = 1;
    c.handicap.enabled = false;
    c.scoring.basis = "scratch";
    c.standings.pinsBasis = "scratch";
    patch(c);
  });

/** Ten bowlers (B11..B52), re-paired by hand for each match. */
const league = (patch?: (c: RuleConfig) => void) => fixture({ teams: 5, perTeam: 2, weeks: 6, config: partnersCfg(patch) });
/** Each bowler of a pair bowls the same flat score every game; `games` overrides game by game. */
const flat = (a: number, b: number, games = 3) => [Array(games).fill(a), Array(games).fill(b)];
let sideSeq = 0;
function addPairs(fx: Fixture, week: number, a: string[], b: string[] | null, sa: number[][], sb: number[][] | undefined, state: "finalized" | "draft" = "finalized") {
  const id = `X${++sideSeq}`;
  return fx.addMatchup(week, `${id}a`, b ? `${id}b` : null, { A: sa, B: sb }, state, { lineupA: a, lineupB: b ?? [] });
}
/** An extra comparison: the pair `a` against the scores of the A side of `ref` (a matchup made with addPairs). */
function addExtra(fx: Fixture, ref: ReturnType<typeof addPairs>, a: string[], sa: number[][], state: "finalized" | "draft" = "finalized") {
  return fx.addMatchup(ref.weekNumber, `X${++sideSeq}x`, ref.sideA, { A: sa }, state, { lineupA: a, lineupB: ref.lineupA });
}
const standings = (fx: Fixture) => Object.fromEntries(computeStandings(buildSeasonModel(fx.data), { scope: "bowler" }).rows.map((r) => [r.id, r]));

describe("rotating partners: scoring", () => {
  it("pays each partner 2 a game and 1 for the higher total, so 7 at most", () => {
    const fx = league();
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    const r = buildSeasonModel(fx.data).results[0];
    expect([r.a.points, r.b!.points]).toEqual([7, 0]);
    const s = standings(fx);
    expect(s.B11).toMatchObject({ points: 7, wins: 1, played: 1 });
    expect(s.B12).toMatchObject({ points: 7 });
    expect(s.B21).toMatchObject({ points: 0, losses: 1 });
  });

  it("counts games one at a time: win two, lose one and the total", () => {
    const fx = league();
    // Pair A wins games 1 and 2 narrowly and loses game 3 heavily: 4 for the games, none for the total.
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], [[200, 200, 100], [200, 200, 100]], [[190, 190, 200], [190, 190, 200]]);
    const r = buildSeasonModel(fx.data).results[0];
    expect([r.a.points, r.b!.points]).toEqual([4, 3]);
    expect(r.winner).toBe("A");
    const s = standings(fx);
    expect([s.B11.points, s.B21.points]).toEqual([4, 3]);
  });

  it("splits a tied game", () => {
    const fx = league();
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], [[200, 200, 200], [200, 200, 200]], [[200, 190, 190], [200, 190, 190]]);
    const r = buildSeasonModel(fx.data).results[0];
    // game 1 tied (1 each), games 2 and 3 to A (4), total to A (1)
    expect([r.a.points, r.b!.points]).toEqual([6, 1]);
  });

  it("uses whatever points the league sets", () => {
    const fx = league((c) => { c.scoring.pointsPerGame = 3; c.scoring.pointsPerSeries = 2; });
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    expect(standings(fx).B11.points).toBe(11);
  });

  it("credits both partners, and tracks each bowler's own pins", () => {
    const fx = league();
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    const s = standings(fx);
    expect(s.B11).toMatchObject({ totalPins: 600, gamesBowled: 3, highSeries: 600, highGame: 200, rank: 1 });
    expect(s.B12).toMatchObject({ totalPins: 570 });
    expect(s.B22.form).toEqual(["L"]);
    expect(Object.keys(s)).toHaveLength(4);
  });

  it("gives a no-show nothing, while their blind score still counts for the pair", () => {
    const fx = league();
    const m = addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(250, 100), flat(180, 180));
    for (const s of fx.data.scores) if (s.matchupId === m.id && s.bowlerId === "B12") { s.kind = "absent"; s.scratch = null; }
    const r = buildSeasonModel(fx.data).results[0];
    expect(r.a.lineup[1].gamesScored).toBe(3); // blind scores: 150 a game for a 160 average
    expect(r.winner).toBe("A"); // 750 + 450 beats 1080
    const s = standings(fx);
    expect(s.B11).toMatchObject({ points: 7, played: 1 });
    expect(s.B12).toBeUndefined();
  });

  it("pays sit-outs the bye points and does not count it as playing", () => {
    const fx = league((c) => { c.scoring.byePoints = 1; });
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    addPairs(fx, 1, ["B31"], null, [], undefined);
    addPairs(fx, 2, ["B31", "B32"], ["B41", "B42"], flat(200, 190), flat(180, 180));
    expect(standings(fx).B31).toMatchObject({ points: 8, played: 1 });
  });
});

describe("rotating partners: the extra pair", () => {
  it("compares the extra pair with another pair's scores, and only the extra pair earns points", () => {
    const fx = league();
    const real = addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    addExtra(fx, real, ["B31", "B32"], flat(210, 200)); // beats B11/B12's 200 and 190 in every game
    const model = buildSeasonModel(fx.data);
    const extra = model.results.find((r) => r.guest)!;
    expect(extra.winner).toBe("A");
    expect([extra.a.points, extra.b!.points]).toEqual([7, 0]);
    expect(extra.b!.lineup.map((l) => l.bowlerId)).toEqual(["B11", "B12"]);
    expect(extra.b!.lineup[0].scratchSeries).toBe(600); // borrowed from their own matchup
    const s = standings(fx);
    expect(s.B31).toMatchObject({ points: 7, wins: 1, played: 1 });
    // The compared pair keeps exactly what its own matchup earned.
    expect(s.B11).toMatchObject({ points: 7, wins: 1, losses: 0, played: 1 });
    expect(s.B12).toMatchObject({ points: 7, played: 1 });
  });

  it("gives the extra pair nothing when it does worse, and costs the compared pair nothing", () => {
    const fx = league();
    const real = addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    addExtra(fx, real, ["B31", "B32"], flat(150, 150));
    const extra = buildSeasonModel(fx.data).results.find((r) => r.guest)!;
    expect(extra.winner).toBe("B"); // the other pair's scores were higher
    expect([extra.a.points, extra.b!.points]).toEqual([0, 0]);
    const s = standings(fx);
    expect(s.B31).toMatchObject({ points: 0, losses: 1, played: 1 });
    expect(s.B11).toMatchObject({ points: 7, wins: 1, losses: 0, played: 1 });
  });

  it("does not count the compared pair's games twice", () => {
    const fx = league();
    const real = addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    addExtra(fx, real, ["B31", "B32"], flat(210, 200));
    const nights = collectNights(buildSeasonModel(fx.data));
    expect(nights.filter((n) => n.bowlerId === "B11")).toHaveLength(1);
    expect(nights.filter((n) => n.bowlerId === "B31")).toHaveLength(1);
    expect(nights).toHaveLength(6);
  });

  it("follows the compared pair's lineup if a substitute takes their place", () => {
    const fx = league();
    const real = addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    addExtra(fx, real, ["B31", "B32"], flat(210, 200));
    // The compared pair's own lineup changes (B41 bowls the scores B12 had); the comparison uses whoever bowled.
    real.lineupA = ["B11", "B41"];
    for (const sc of fx.data.scores) if (sc.matchupId === real.id && sc.bowlerId === "B12") sc.bowlerId = "B41";
    const extra = buildSeasonModel(fx.data).results.find((r) => r.guest)!;
    expect(extra.b!.lineup.map((l) => l.bowlerId)).toEqual(["B11", "B41"]);
    expect(extra.b!.scratchSeries).toBe(600 + 570);
  });

  it("is an extra comparison only in a rotating-partners league", () => {
    const fx = fixture({ teams: 3, perTeam: 2, config: cfgWith((c) => { c.bowlersPerTeam = 2; }) });
    fx.addMatchup(1, "T1", "T2", { A: [[200, 200, 200], [200, 200, 200]], B: [[190, 190, 190], [190, 190, 190]] });
    expect(buildSeasonModel(fx.data).guests.size).toBe(0);
  });

  it("waits for the compared pair's matchup to be final", () => {
    const fx = league();
    const real = addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180), "draft");
    const extra = addExtra(fx, real, ["B31", "B32"], flat(210, 200), "draft");
    const cfg = partnersCfg();
    const scores = fx.data.scores.filter((s) => s.matchupId === extra.id).map((s) => ({ bowlerId: s.bowlerId, side: s.side, game: s.game, scratch: s.scratch, kind: s.kind }));
    const errors = (f: Fixture) => validateEntry(buildSeasonModel(f.data), extra, scores, cfg, { forFinalize: true }).filter((i) => i.severity === "error").map((i) => i.code);
    expect(errors(fx)).toEqual(["extra_pending"]);
    real.state = "finalized";
    expect(errors(fx)).toEqual([]);
  });

  it("does not trip the double-booking checks on either matchup", () => {
    const fx = league();
    const real = addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], [], undefined, "draft");
    const extra = addExtra(fx, real, ["B31", "B32"], [], "draft");
    const model = buildSeasonModel(fx.data);
    for (const m of [real, extra]) {
      const codes = validateEntry(model, m, [], partnersCfg(), { forFinalize: false }).filter((i) => i.severity === "error").map((i) => i.code);
      expect(codes).toEqual([]);
    }
  });
});

describe("rotating partners: standings", () => {
  it("ranks by the configured tie-breakers and is the standings view for the league", () => {
    const fx = league((c) => { c.standings.tiebreakers = ["points", "totalPins"]; });
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    addPairs(fx, 1, ["B31", "B32"], ["B41", "B42"], flat(220, 150), flat(100, 100));
    const rows = computeStandings(buildSeasonModel(fx.data), { scope: "bowler" }).rows;
    // Four bowlers are level on 7 points, so total pins decide: 660, 600, 570, 450.
    expect(rows.slice(0, 4).map((r) => r.id)).toEqual(["B31", "B11", "B12", "B32"]);
    expect(standingsScope(partnersCfg())).toBe("bowler");
    expect(standingsScope(cfgWith(() => {}))).toBe("team");
    expect(standingsScope(cfgWith((c) => { c.format = "individual"; c.bowlersPerTeam = 1; }))).toBe("bowler");
  });

  it("counts only the nights up to a given week", () => {
    const fx = league();
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    addPairs(fx, 2, ["B11", "B21"], ["B12", "B22"], flat(150, 150), flat(210, 150));
    const model = buildSeasonModel(fx.data);
    const all = Object.fromEntries(computeStandings(model, { scope: "bowler" }).rows.map((r) => [r.id, r]));
    const wk1 = Object.fromEntries(computeStandings(model, { scope: "bowler", throughWeek: 1 }).rows.map((r) => [r.id, r]));
    expect([all.B11.played, wk1.B11.played]).toEqual([2, 1]);
    expect(wk1.B11.points).toBe(7);
  });

  it("shows each drawn pair by its bowlers' names", () => {
    const fx = league();
    fx.data.bowlers.find((b) => b.id === "B11")!.name = "Alex Rivera";
    fx.data.bowlers.find((b) => b.id === "B12")!.name = "Sam Chen";
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    const model = buildSeasonModel(fx.data);
    const m = fx.data.matchups[0];
    expect(model.teamById.get(m.sideA)?.name).toBe("Alex & Sam");
    expect(model.pairTeamIds.has(m.sideA)).toBe(true);
    expect(model.pairTeamIds.size).toBe(2);
    fx.data.bowlers.find((b) => b.id === "B12")!.name = "Pat Renamed";
    expect(buildSeasonModel(fx.data).teamById.get(m.sideA)?.name).toBe("Alex & Pat");
  });

  it("names the compared pair the same way in the extra comparison", () => {
    const fx = league();
    fx.data.bowlers.find((b) => b.id === "B11")!.name = "Alex Rivera";
    fx.data.bowlers.find((b) => b.id === "B12")!.name = "Sam Chen";
    const real = addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    const extra = addExtra(fx, real, ["B31", "B32"], flat(210, 200));
    const model = buildSeasonModel(fx.data);
    expect(model.teamById.get(extra.sideB!)?.name).toBe("Alex & Sam");
    expect(model.pairTeamIds.size).toBe(3);
  });
});

describe("rotating partners: rules", () => {
  it("leaves every other league exactly as it was", () => {
    const fx = fixture({ teams: 2, config: cfgWith((c) => { c.handicap.enabled = false; c.scoring.basis = "scratch"; }) });
    fx.addMatchup(1, "T1", "T2", { A: [[200, 200, 200], [200, 200, 200], [200, 200, 200]], B: [[190, 190, 190], [190, 190, 190], [190, 190, 190]] });
    const model = buildSeasonModel(fx.data);
    expect(model.pairTeamIds.size).toBe(0);
    expect(model.results[0].a.points).toBe(4);
    expect(computeStandings(model).rows[0]).toMatchObject({ id: "T1", points: 4 });
  });

  it("treats rules saved before the option existed as having it off", () => {
    const old = structuredClone(DEFAULT_CONFIG) as Partial<RuleConfig>;
    delete old.partners;
    const fx = fixture({ teams: 2 });
    fx.data.season.ruleVersions[0].config = old as RuleConfig;
    const model = buildSeasonModel(fx.data);
    expect(usesPartners(model.configForWeek(1))).toBe(false);
    expect(partnersOf(old)).toEqual(DEFAULT_CONFIG.partners);
  });

  it("validates: pairs only, and no playoffs", () => {
    expect(validateConfig(partnersCfg()).ok).toBe(true);
    const errors = (patch: (c: RuleConfig) => void) => validateConfig(partnersCfg(patch)).issues.filter((i) => i.severity === "error").map((i) => i.path);
    expect(errors((c) => { c.bowlersPerTeam = 3; })).toContain("bowlersPerTeam");
    expect(errors((c) => { c.format = "both"; })).toContain("format");
    expect(errors((c) => { c.playoffs.enabled = true; })).toContain("playoffs.enabled");
  });

  it("offers a starter template that scores 2 a game and 1 for the total", () => {
    const t = STARTER_TEMPLATES.find((x) => x.id === "rotating-partners")!;
    expect(validateConfig(t.config).ok).toBe(true);
    expect(t.config).toMatchObject({ format: "team", bowlersPerTeam: 2, partners: { enabled: true }, scoring: { pointsPerGame: 2, pointsPerSeries: 1 } });
  });

  it("describes the rules in plain language", () => {
    const text = JSON.stringify(describeRules(partnersCfg()));
    expect(text).toContain("Rotating partners");
    expect(text).toContain("Extra pair");
    expect(text).toContain("Most a bowler can earn in a night");
    expect(JSON.stringify(describeRules(DEFAULT_CONFIG))).not.toContain("Rotating partners");
  });
});

describe("rotating partners: lineups", () => {
  it("lets any rostered bowlers be partners, which a team league does not", () => {
    const entry = (cfg: RuleConfig) => {
      const fx = fixture({ teams: 2, perTeam: 2, config: cfg });
      const m = fx.addMatchup(1, "T1", "T2", { A: [] }, "scheduled", { lineupA: ["B11", "B21"], lineupB: ["B12", "B22"] });
      return validateEntry(buildSeasonModel(fx.data), m, [], cfg, { forFinalize: false }).filter((i) => i.severity === "error").map((i) => i.code);
    };
    expect(entry(partnersCfg())).toEqual([]);
    expect(entry(cfgWith((c) => { c.bowlersPerTeam = 2; }))).toContain("wrong_team");
  });

  it("still stops a bowler being in two matches in the same week", () => {
    const fx = league();
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], [], undefined, "draft");
    const m = addPairs(fx, 1, ["B11", "B31"], ["B32", "B41"], [], undefined, "draft");
    const codes = validateEntry(buildSeasonModel(fx.data), m, [], partnersCfg(), { forFinalize: false }).map((i) => i.code);
    expect(codes).toContain("bowler_double_booked");
  });
});
