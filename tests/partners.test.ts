import { describe, expect, it } from "vitest";
import { partnersOf, usesPartners, validateConfig, STARTER_TEMPLATES, DEFAULT_CONFIG, type RuleConfig } from "@/domain/config";
import { describeRules } from "@/domain/describe";
import { buildSeasonModel } from "@/domain/engine";
import { drawPartners, pairKey, pairName, pairTeamFor, partnerHistory, seededRandom, type PartnerHistory } from "@/domain/partners";
import { maxMatchupPoints } from "@/domain/scoring";
import { computeStandings, standingsScope } from "@/domain/standings";
import { validateEntry } from "@/domain/validate";
import { cfgWith, fixture, type Fixture } from "./helpers";

const emptyHistory = (): PartnerHistory => ({ partnered: new Map(), faced: new Map(), rests: new Map() });
const bowlerIds = (n: number) => Array.from({ length: n }, (_, i) => `P${String(i + 1).padStart(2, "0")}`);

/** Applies a drawn week to a history, the way the matchups it creates would. */
function record(h: PartnerHistory, draw: ReturnType<typeof drawPartners>) {
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const m of draw.matches) {
    for (const side of [m.a, m.b ?? []]) if (side.length === 2) bump(h.partnered, pairKey(side[0], side[1]));
    if (m.b) for (const x of m.a) for (const y of m.b) bump(h.faced, pairKey(x, y));
    else for (const x of m.a) h.rests.set(x, (h.rests.get(x) ?? 0) + 1);
  }
}

describe("partner draw", () => {
  it("needs at least four bowlers", () => {
    expect(() => drawPartners(bowlerIds(3), emptyHistory(), seededRandom(1))).toThrow(/at least four/);
  });

  it("puts everyone in exactly one place: two pairs per match, and a lone bowler for each sit-out", () => {
    for (let n = 4; n <= 14; n++) {
      const ids = bowlerIds(n);
      const d = drawPartners(ids, emptyHistory(), seededRandom(n));
      const seen = d.matches.flatMap((m) => [...m.a, ...(m.b ?? [])]);
      expect([...seen].sort()).toEqual([...ids].sort());
      expect(d.resting).toHaveLength(n % 4);
      for (const m of d.matches) {
        if (m.b) expect([m.a.length, m.b.length]).toEqual([2, 2]);
        else expect(m.a).toHaveLength(1);
      }
      expect(d.matches.filter((m) => m.b).length).toBe(Math.floor(n / 4));
    }
  });

  it("lists matches before sit-outs", () => {
    const d = drawPartners(bowlerIds(10), emptyHistory(), seededRandom(5));
    expect(d.matches.map((m) => m.b !== null)).toEqual([true, true, false, false]);
  });

  it("is repeatable from its seed and varies between seeds", () => {
    const a = drawPartners(bowlerIds(10), emptyHistory(), seededRandom(42));
    const b = drawPartners(bowlerIds(10), emptyHistory(), seededRandom(42));
    expect(b).toEqual(a);
    const others = Array.from({ length: 10 }, (_, i) => JSON.stringify(drawPartners(bowlerIds(10), emptyHistory(), seededRandom(100 + i))));
    expect(new Set(others).size).toBeGreaterThan(5);
  });

  it("does not repeat a partner while there are new partners to try", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = seededRandom(seed);
      const h = emptyHistory();
      for (let week = 1; week <= 7; week++) record(h, drawPartners(bowlerIds(10), h, rand));
      expect([...h.partnered.values()].every((c) => c === 1)).toBe(true);
    }
  });

  it("shares the sit-outs evenly", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = seededRandom(seed);
      const h = emptyHistory();
      const ids = bowlerIds(10);
      for (let week = 1; week <= 9; week++) record(h, drawPartners(ids, h, rand));
      const rests = ids.map((id) => h.rests.get(id) ?? 0);
      expect(Math.max(...rests) - Math.min(...rests)).toBeLessThanOrEqual(1);
      expect(rests.reduce((a, b) => a + b, 0)).toBe(18);
    }
  });

  it("sends the bowlers who have sat out least to rest", () => {
    const h = emptyHistory();
    for (const id of bowlerIds(10).slice(2)) h.rests.set(id, 3);
    const d = drawPartners(bowlerIds(10), h, seededRandom(9));
    expect([...d.resting].sort()).toEqual(["P01", "P02"]);
  });

  it("builds its history from the other weeks' matchups", () => {
    const fx = fixture({ teams: 4, perTeam: 2 });
    const base = { kind: "team" as const };
    fx.addMatchup(1, "S1", "S2", { A: [] }, "finalized", { ...base, lineupA: ["B11", "B12"], lineupB: ["B21", "B22"] });
    fx.addMatchup(1, "S3", null, { A: [] }, "finalized", { ...base, lineupA: ["B31"], lineupB: [] });
    fx.addMatchup(2, "S4", "S5", { A: [] }, "scheduled", { ...base, lineupA: ["B11", "B21"], lineupB: ["B12", "B22"] });
    const h = partnerHistory(fx.data, 2);
    expect(h.partnered.get(pairKey("B11", "B12"))).toBe(1);
    expect(h.partnered.get(pairKey("B11", "B21"))).toBeUndefined();
    expect(h.faced.get(pairKey("B11", "B21"))).toBe(1);
    expect(h.rests.get("B31")).toBe(1);
    expect(partnerHistory(fx.data).partnered.get(pairKey("B11", "B21"))).toBe(1);
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

const partnersCfg = (patch: (c: RuleConfig) => void = () => {}) =>
  cfgWith((c) => {
    c.bowlersPerTeam = 2;
    c.partners.enabled = true;
    c.handicap.enabled = false;
    c.scoring.basis = "scratch";
    c.standings.pinsBasis = "scratch";
    patch(c);
  });

/** Eight bowlers (two per fixture team) who are re-paired by hand for each match. */
const league = (patch?: (c: RuleConfig) => void) => fixture({ teams: 4, perTeam: 2, weeks: 6, config: partnersCfg(patch) });
const flat = (a: number, b: number, games = 3) => [Array(games).fill(a), Array(games).fill(b)];
let sideSeq = 0;
function addPairs(fx: Fixture, week: number, a: string[], b: string[] | null, sa: number[][], sb: number[][] | undefined, state: "finalized" | "draft" = "finalized") {
  const id = `X${++sideSeq}`;
  return fx.addMatchup(week, `${id}a`, b ? `${id}b` : null, { A: sa, B: sb }, state, { lineupA: a, lineupB: b ?? [] });
}
const standings = (fx: Fixture) => {
  const rows = computeStandings(buildSeasonModel(fx.data), { scope: "bowler" }).rows;
  return Object.fromEntries(rows.map((r) => [r.id, r]));
};

describe("rotating partners: matches", () => {
  it("is won by the pair with the higher combined total, not by games", () => {
    const fx = league();
    // Pair A wins games 1 and 2 narrowly but loses game 3 heavily: normal rules give A the match, partners go by the total.
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], [[200, 200, 100], [200, 200, 100]], [[190, 190, 200], [190, 190, 200]]);
    const r = buildSeasonModel(fx.data).results[0];
    expect(r.winner).toBe("B");
    expect(r.a.points).toBe(0);
    expect(r.b!.points).toBe(2);
    expect(r.a.gamePoints + r.a.seriesPoints + r.a.bonusPoints).toBe(0);
  });

  it("pays the configured points to each partner, with ties shared", () => {
    const fx = league((c) => { c.partners.winPoints = 3; c.partners.tiePoints = 1.5; });
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 200), flat(190, 190));
    addPairs(fx, 1, ["B31", "B32"], ["B41", "B42"], flat(180, 180), flat(180, 180));
    const [win, tie] = buildSeasonModel(fx.data).results;
    expect([win.a.points, win.b!.points]).toEqual([3, 0]);
    expect([tie.winner, tie.a.points, tie.b!.points]).toEqual(["tie", 1.5, 1.5]);
  });

  it("is worth the win points at most", () => {
    expect(maxMatchupPoints(partnersCfg((c) => { c.partners.winPoints = 5; }))).toBe(5);
    expect(maxMatchupPoints(DEFAULT_CONFIG)).toBe(DEFAULT_CONFIG.scoring.gamesPerSession * 1 + 1);
  });

  it("uses handicap-adjusted pins when handicap decides results", () => {
    const fx = league((c) => { c.handicap.enabled = true; c.scoring.basis = "handicap"; c.handicap.baseValue = 220; c.handicap.percentage = 100; });
    for (const id of ["B21", "B22"]) fx.data.roster.find((r) => r.bowlerId === id)!.enteringAverage = 100; // a 120 handicap a game
    // Scratch, A wins 1200 to 900; with handicap, B's 810 + 810 beats A's 780 + 780.
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 200), flat(150, 150));
    const r = buildSeasonModel(fx.data).results[0];
    expect(r.basis).toBe("handicap");
    expect(r.winner).toBe("B");
  });
});

describe("rotating partners: standings", () => {
  it("credits both partners with their pair's result and tracks each bowler's own pins", () => {
    const fx = league((c) => { c.partners.bonusPoints = 0; });
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    const s = standings(fx);
    expect(s.B11).toMatchObject({ points: 2, wins: 1, losses: 0, played: 1, totalPins: 600, gamesBowled: 3, highSeries: 600, highGame: 200, rank: 1 });
    expect(s.B12).toMatchObject({ points: 2, wins: 1, totalPins: 570 });
    expect(s.B21).toMatchObject({ points: 0, wins: 0, losses: 1, played: 1 });
    expect(s.B22.form).toEqual(["L"]);
    expect(Object.keys(s)).toHaveLength(4);
  });

  it("gives the night's highest bowler series a bonus, even when their pair lost, and ties share it", () => {
    const fx = league();
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    addPairs(fx, 1, ["B31", "B32"], ["B41", "B42"], flat(170, 170), flat(175, 160));
    let s = standings(fx);
    expect([s.B11.points, s.B11.bonus]).toEqual([3, 1]);
    expect([s.B12.points, s.B12.bonus]).toEqual([2, 0]);
    expect(s.B31).toMatchObject({ points: 2, bonus: 0 });
    // A bowler on the losing pair bowls the best series of the night.
    const fx2 = league();
    addPairs(fx2, 1, ["B11", "B12"], ["B21", "B22"], flat(150, 150), flat(250, 100));
    s = standings(fx2);
    expect(s.B21).toMatchObject({ bonus: 1, points: 3 });
    expect(s.B11).toMatchObject({ bonus: 0, points: 0 });
    // Two bowlers tie for the top series: both get the point.
    const fx3 = league();
    addPairs(fx3, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 150), flat(200, 150));
    s = standings(fx3);
    expect([s.B11.bonus, s.B21.bonus, s.B12.bonus]).toEqual([1, 1, 0]);
  });

  it("can give the bonus to the pair with the highest combined total instead", () => {
    const fx = league((c) => { c.partners.bonusFor = "pair"; c.partners.bonusPoints = 2; });
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(150, 150), flat(140, 140));
    addPairs(fx, 1, ["B31", "B32"], ["B41", "B42"], flat(190, 190), flat(100, 100));
    const s = standings(fx);
    expect([s.B31.bonus, s.B32.bonus, s.B11.bonus, s.B41.bonus]).toEqual([2, 2, 0, 0]);
    expect(s.B31.points).toBe(4);
  });

  it("judges the bonus on raw pins unless set to use handicap", () => {
    const patch = (basis: "scratch" | "scoring") => (c: RuleConfig) => {
      c.handicap.enabled = true;
      c.scoring.basis = "handicap";
      c.standings.pinsBasis = "handicap";
      c.handicap.baseValue = 220;
      c.handicap.percentage = 100;
      c.partners.bonusPins = basis;
    };
    for (const [basis, winner] of [["scratch", "B11"], ["scoring", "B12"]] as const) {
      const fx = league(patch(basis));
      fx.data.roster.find((r) => r.bowlerId === "B11")!.enteringAverage = 200; // handicap 20
      fx.data.roster.find((r) => r.bowlerId === "B12")!.enteringAverage = 120; // handicap 100
      addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(210, 150), flat(100, 100));
      const s = standings(fx);
      expect(s[winner].bonus).toBe(1);
      expect(Object.values(s).filter((r) => r.bonus > 0)).toHaveLength(1);
    }
  });

  it("holds the bonus back until every match of the night is final", () => {
    const fx = league();
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    addPairs(fx, 1, ["B31", "B32"], ["B41", "B42"], flat(250, 170), flat(100, 100), "draft");
    let s = standings(fx);
    expect(s.B11.bonus).toBe(0);
    expect(s.B31).toMatchObject({ played: 0, points: 0 });
    // Once the last match is final the bowler with the best series gets it, wherever it was bowled.
    for (const m of fx.data.matchups) m.state = "finalized";
    s = standings(fx);
    expect(s.B31.bonus).toBe(1);
    expect(s.B11.bonus).toBe(0);
  });

  it("awards the bonus per night and counts only the nights up to a given week", () => {
    const fx = league();
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    addPairs(fx, 2, ["B11", "B21"], ["B12", "B22"], flat(150, 150), flat(210, 150));
    const model = buildSeasonModel(fx.data);
    const all = Object.fromEntries(computeStandings(model, { scope: "bowler" }).rows.map((r) => [r.id, r]));
    expect([all.B11.bonus, all.B12.bonus]).toEqual([1, 1]);
    const wk1 = Object.fromEntries(computeStandings(model, { scope: "bowler", throughWeek: 1 }).rows.map((r) => [r.id, r]));
    expect([wk1.B11.bonus, wk1.B12?.bonus]).toEqual([1, 0]);
  });

  it("pays sit-outs the bye points and does not count it as playing", () => {
    const fx = league((c) => { c.partners.byePoints = 1; c.partners.bonusPoints = 0; });
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    addPairs(fx, 1, ["B31"], null, [], undefined);
    const s = standings(fx);
    expect(s.B31).toBeUndefined(); // never bowled, so not ranked yet
    const fx2 = league((c) => { c.partners.byePoints = 1; c.partners.bonusPoints = 0; });
    addPairs(fx2, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    addPairs(fx2, 2, ["B11", "B21"], ["B12", "B22"], flat(200, 190), flat(180, 180));
    addPairs(fx2, 1, ["B31"], null, [], undefined);
    addPairs(fx2, 2, ["B31", "B32"], ["B41", "B42"], flat(200, 190), flat(180, 180));
    const s2 = standings(fx2);
    expect(s2.B31).toMatchObject({ points: 3, played: 1 });
  });

  it("gives a no-show nothing, while their blind score still counts for the pair", () => {
    const fx = league((c) => { c.partners.bonusPoints = 0; });
    const m = addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(250, 100), flat(180, 180));
    for (const s of fx.data.scores) if (s.matchupId === m.id && s.bowlerId === "B12") { s.kind = "absent"; s.scratch = null; }
    const r = buildSeasonModel(fx.data).results[0];
    expect(r.a.lineup[1].gamesScored).toBe(3); // blind scores: 150 a game for a 160 average
    expect(r.winner).toBe("A"); // 750 + 450 beats 1080
    const s = standings(fx);
    expect(s.B11).toMatchObject({ points: 2, played: 1 });
    expect(s.B12).toBeUndefined();
  });

  it("ranks by the configured tie-breakers and is the standings view for the league", () => {
    const fx = league((c) => { c.partners.bonusPoints = 0; c.standings.tiebreakers = ["points", "totalPins"]; });
    addPairs(fx, 1, ["B11", "B12"], ["B21", "B22"], flat(200, 190), flat(180, 180));
    addPairs(fx, 1, ["B31", "B32"], ["B41", "B42"], flat(220, 150), flat(100, 100));
    const rows = computeStandings(buildSeasonModel(fx.data), { scope: "bowler" }).rows;
    // Four bowlers are level on 2 points, so total pins decide: 660, 600, 570, 450.
    expect(rows.slice(0, 4).map((r) => r.id)).toEqual(["B31", "B11", "B12", "B32"]);
    expect(standingsScope(partnersCfg())).toBe("bowler");
    expect(standingsScope(cfgWith(() => {}))).toBe("team");
    expect(standingsScope(cfgWith((c) => { c.format = "individual"; c.bowlersPerTeam = 1; }))).toBe("bowler");
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
    // Renaming a bowler renames the pair everywhere.
    fx.data.bowlers.find((b) => b.id === "B12")!.name = "Pat Renamed";
    expect(buildSeasonModel(fx.data).teamById.get(m.sideA)?.name).toBe("Alex & Pat");
  });
});

describe("rotating partners: rules", () => {
  it("leaves every other league exactly as it was", () => {
    const fx = fixture({ teams: 2, config: cfgWith((c) => { c.handicap.enabled = false; c.scoring.basis = "scratch"; }) });
    fx.addMatchup(1, "T1", "T2", { A: [[200, 200, 200], [200, 200, 200], [200, 200, 200]], B: [[190, 190, 190], [190, 190, 190], [190, 190, 190]] });
    const model = buildSeasonModel(fx.data);
    expect(model.pairTeamIds.size).toBe(0);
    expect(model.results[0].a.points).toBe(4);
    expect(computeStandings(model).rows[0]).toMatchObject({ id: "T1", points: 4, bonus: 0 });
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
    const ok = validateConfig(partnersCfg());
    expect(ok.ok).toBe(true);
    const errors = (patch: (c: RuleConfig) => void) => validateConfig(partnersCfg(patch)).issues.filter((i) => i.severity === "error").map((i) => i.path);
    expect(errors((c) => { c.bowlersPerTeam = 3; })).toContain("bowlersPerTeam");
    expect(errors((c) => { c.format = "both"; })).toContain("format");
    expect(errors((c) => { c.playoffs.enabled = true; })).toContain("playoffs.enabled");
    expect(errors((c) => { c.scoring.pointsPerGame = 0; c.scoring.pointsPerSeries = 0; })).toEqual([]);
    expect(validateConfig(partnersCfg((c) => { c.partners.winPoints = 0; c.partners.tiePoints = 0; c.partners.bonusPoints = 0; })).issues.map((i) => i.path)).toContain("partners.winPoints");
  });

  it("offers a starter template with the partners rules switched on", () => {
    const t = STARTER_TEMPLATES.find((x) => x.id === "rotating-partners")!;
    expect(validateConfig(t.config).ok).toBe(true);
    expect(t.config).toMatchObject({ format: "team", bowlersPerTeam: 2, partners: { enabled: true, winPoints: 2, bonusPoints: 1 } });
  });

  it("describes the rules in plain language", () => {
    const text = JSON.stringify(describeRules(partnersCfg((c) => { c.partners.winPoints = 3; })));
    expect(text).toContain("Rotating partners");
    expect(text).toContain("Each partner earns 3 points");
    expect(text).toContain("Highest pin count");
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
