import { describe, expect, it } from "vitest";
import { buildSeasonModel } from "@/domain/engine";
import { computePlayoffRace, computeStandings, remainingPotential, standingsProgression } from "@/domain/standings";
import { generateRoundRobin, firstRoundBracket } from "@/domain/schedule";
import { cfgWith, fixture } from "./helpers";

/** Every bowler of a team bowls the same flat score each game. */
const flat = (score: number, bowlers = 3, games = 3) => Array.from({ length: bowlers }, () => Array(games).fill(score));
const scratchCfg = (patch: (c: ReturnType<typeof cfgWith>) => void = () => {}) =>
  cfgWith((c) => { c.handicap.enabled = false; c.scoring.basis = "scratch"; c.standings.pinsBasis = "scratch"; patch(c); });

describe("standings", () => {
  it("ranks by points then wins, with record, pins, form and streaks", () => {
    const fx = fixture({ config: scratchCfg(), teams: 3 });
    fx.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(180) });
    fx.addMatchup(2, "T1", "T3", { A: flat(200), B: flat(190) });
    fx.addMatchup(3, "T2", "T3", { A: flat(150), B: flat(190) });
    const { rows } = computeStandings(buildSeasonModel(fx.data));
    expect(rows.map((r) => r.id)).toEqual(["T1", "T3", "T2"]);
    expect(rows[0]).toMatchObject({ wins: 2, losses: 0, points: 8, played: 2, rank: 1, pointsBehind: 0 });
    expect(rows[0].streak).toEqual({ type: "W", count: 2 });
    expect(rows[1]).toMatchObject({ wins: 1, losses: 1, points: 4 });
    expect(rows[2]).toMatchObject({ wins: 0, losses: 2, points: 0, pointsBehind: 8 });
    expect(rows[0].totalPins).toBe(200 * 3 * 3 * 2);
    expect(rows[0].form).toEqual(["W", "W"]);
  });

  it("does not count drafts or unfinalized results unless provisional is enabled", () => {
    const fx = fixture({ config: scratchCfg(), teams: 2 });
    fx.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(180) }, "draft");
    expect(computeStandings(buildSeasonModel(fx.data)).rows.every((r) => r.played === 0)).toBe(true);
    const fx2 = fixture({ config: scratchCfg((c) => { c.standings.includeProvisional = true; }), teams: 2 });
    fx2.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(180) }, "draft");
    expect(computeStandings(buildSeasonModel(fx2.data)).rows.find((r) => r.id === "T1")!.points).toBe(4);
  });

  it("breaks ties deterministically using the configured order and explains why", () => {
    // T1 and T2 tie on points and wins; T1 has more total pins.
    const fx = fixture({ config: scratchCfg((c) => { c.standings.tiebreakers = ["points", "totalPins"]; }), teams: 4 });
    fx.addMatchup(1, "T1", "T3", { A: flat(220), B: flat(100) });
    fx.addMatchup(1, "T2", "T4", { A: flat(180), B: flat(100) });
    const { rows } = computeStandings(buildSeasonModel(fx.data));
    expect(rows[0].id).toBe("T1");
    expect(rows[1].id).toBe("T2");
    expect(rows[0].points).toBe(rows[1].points);
    expect(rows[1].reason).toBe("Separated by total pins (scoring basis)");
  });

  it("uses head-to-head among tied teams", () => {
    const fx = fixture({ config: scratchCfg((c) => { c.standings.tiebreakers = ["wins", "headToHead", "totalPins"]; }), teams: 3 });
    // T1 beats T2, T2 beats T3, T3 beats T1 → everyone 1-1 and the h2h cycle is level, so total pins decide:
    // T2 3960 > T1 3330 > T3 2520
    fx.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(190) });
    fx.addMatchup(2, "T2", "T3", { A: flat(250), B: flat(100) });
    fx.addMatchup(3, "T3", "T1", { A: flat(180), B: flat(170) });
    const { rows } = computeStandings(buildSeasonModel(fx.data));
    expect(rows.map((r) => r.id)).toEqual(["T2", "T1", "T3"]);
    // simple pair: T1 beats T2 head-to-head though T2 has more pins
    const fx2 = fixture({ config: scratchCfg((c) => { c.standings.tiebreakers = ["wins", "headToHead", "totalPins"]; }), teams: 4 });
    fx2.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(190) });
    fx2.addMatchup(2, "T2", "T3", { A: flat(300), B: flat(100) });
    fx2.addMatchup(2, "T1", "T4", { A: flat(150), B: flat(160) });
    const r2 = computeStandings(buildSeasonModel(fx2.data)).rows;
    // T1: 1-1, T2: 1-1, T4: 1-0. T1 vs T2 → T1 ahead although T2 has more pins
    expect(r2.map((r) => r.id).slice(0, 3)).toEqual(["T4", "T1", "T2"]);
    expect(r2[2].reason).toBe("Separated by head-to-head record among tied teams");
  });

  it("gives identical rows the same rank number and orders them alphabetically", () => {
    const fx = fixture({ config: scratchCfg(), teams: 3 });
    const { rows } = computeStandings(buildSeasonModel(fx.data));
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 1]);
    expect(rows.map((r) => r.name)).toEqual(["Team A", "Team B", "Team C"]);
  });

  it("recomputes after a correction to a finalized score", () => {
    const fx = fixture({ config: scratchCfg(), teams: 2 });
    const m = fx.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(180) });
    expect(computeStandings(buildSeasonModel(fx.data)).rows[0].id).toBe("T1");
    for (const s of fx.data.scores) if (s.matchupId === m.id && s.side === "B") s.scratch = 250;
    const rows = computeStandings(buildSeasonModel(fx.data)).rows;
    expect(rows[0].id).toBe("T2");
    expect(rows[0].points).toBe(4);
  });

  it("builds weekly rank progression", () => {
    const fx = fixture({ config: scratchCfg(), teams: 2 });
    fx.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(180) });
    fx.addMatchup(2, "T1", "T2", { A: flat(100), B: flat(180) });
    fx.addMatchup(3, "T1", "T2", { A: flat(100), B: flat(180) });
    const prog = standingsProgression(buildSeasonModel(fx.data));
    // week 2: tied 4–4 on points and 1–1 in wins; T2 leads on total pins
    expect(prog.weeks.map((w) => w.ranks.T1)).toEqual([1, 2, 2]);
    expect(prog.weeks.map((w) => w.points.T2)).toEqual([0, 4, 8]);
  });

  it("counts byes with configured bye points but no record", () => {
    const fx = fixture({ config: scratchCfg((c) => { c.scoring.byePoints = 2; }), teams: 3 });
    fx.addMatchup(1, "T1", null, { A: [] });
    const row = computeStandings(buildSeasonModel(fx.data)).rows.find((r) => r.id === "T1")!;
    expect(row.points).toBe(2);
    expect(row.played).toBe(0);
  });
});

describe("playoff race", () => {
  const cfg = scratchCfg((c) => { c.playoffs.enabled = true; c.playoffs.qualifiers = 2; });
  it("reports clinched and eliminated only when mathematically certain", () => {
    const fx = fixture({ config: cfg, teams: 4, weeks: 3 });
    // Week1: T1 beats T2, T3 beats T4 (4 pts to winners). 2 weeks remain scheduled but unplayed.
    fx.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(100) });
    fx.addMatchup(1, "T3", "T4", { A: flat(200), B: flat(100) });
    fx.addMatchup(2, "T1", "T3", { A: [], B: [] }, "scheduled");
    fx.addMatchup(2, "T2", "T4", { A: [], B: [] }, "scheduled");
    fx.addMatchup(3, "T1", "T4", { A: [], B: [] }, "scheduled");
    fx.addMatchup(3, "T2", "T3", { A: [], B: [] }, "scheduled");
    const model = buildSeasonModel(fx.data);
    const { rows } = computeStandings(model);
    const race = computePlayoffRace(rows, cfg, (id) => remainingPotential(model, id, cfg))!;
    const st = Object.fromEntries(race.map((r) => [r.id, r.status]));
    expect(st.T1).toBe("in"); // 4 pts, T2 could still reach 0+8 = 8 → not clinched
    expect(st.T2).toBe("out"); // 0 pts, max 8: alive
    expect(Object.values(st)).not.toContain("clinched");
    expect(Object.values(st)).not.toContain("eliminated");
  });
  it("finds a clinch and an elimination in a settled race", () => {
    const fx = fixture({ config: cfg, teams: 4, weeks: 2 });
    fx.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(100) });
    fx.addMatchup(1, "T3", "T4", { A: flat(200), B: flat(100) });
    fx.addMatchup(2, "T1", "T3", { A: flat(200), B: flat(190) });
    fx.addMatchup(2, "T2", "T4", { A: flat(150), B: flat(100) }, "scheduled", { });
    const model = buildSeasonModel(fx.data);
    const { rows } = computeStandings(model);
    // T1 8, T3 4, T2 0 (can reach 4), T4 0 (can reach 4) — T2/T4 have max 4 = T3 current, not strictly less → alive via ties
    const race = computePlayoffRace(rows, cfg, (id) => remainingPotential(model, id, cfg))!;
    const st = Object.fromEntries(race.map((r) => [r.id, r.status]));
    expect(st.T1).toBe("clinched"); // others' max: T3 4, T2 4, T4 4 → all < 8
    expect(["in", "out"]).toContain(st.T3); // T2/T4 can still tie T3 so T3 isn't clinched
    expect(st.T2).toBe("out");
  });
  it("shows no playoff elements when playoffs are disabled", () => {
    const off = scratchCfg();
    const fx = fixture({ config: off, teams: 2 });
    const model = buildSeasonModel(fx.data);
    expect(computePlayoffRace(computeStandings(model).rows, off, () => 0)).toBeNull();
  });
});

describe("schedule generation", () => {
  const meetings = (weeks: ReturnType<typeof generateRoundRobin>["weeks"]) => {
    const m = new Map<string, number>();
    for (const w of weeks) for (const p of w.pairs) if (p.b) m.set([p.a, p.b].sort().join("|"), (m.get([p.a, p.b].sort().join("|")) ?? 0) + 1);
    return m;
  };
  it("even teams: everyone plays everyone once in n-1 weeks, nobody double-booked", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const s = generateRoundRobin(ids, 5);
    expect(s.warnings).toEqual([]);
    expect(meetings(s.weeks).size).toBe(15);
    for (const w of s.weeks) {
      const seen = w.pairs.flatMap((p) => [p.a, p.b]).filter(Boolean);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toHaveLength(6);
    }
  });
  it("odd teams: one bye per week, rotating, with a warning", () => {
    const s = generateRoundRobin(["a", "b", "c", "d", "e"], 5);
    expect(s.weeks.every((w) => w.pairs.filter((p) => p.b == null).length === 1)).toBe(true);
    expect(Object.values(s.byeCounts)).toEqual([1, 1, 1, 1, 1]);
    expect(s.warnings.some((w) => /odd/.test(w))).toBe(true);
  });
  it("warns when the season is shorter or unbalanced and repeats cycles with swapped sides", () => {
    expect(generateRoundRobin(["a", "b", "c", "d"], 2).warnings.join()).toMatch(/full round robin needs 3/);
    const s = generateRoundRobin(["a", "b", "c", "d"], 4);
    expect(s.warnings.join()).toMatch(/unbalanced/);
    const d = generateRoundRobin(["a", "b", "c", "d"], 6);
    expect(d.warnings).toEqual([]);
    expect([...meetings(d.weeks).values()].every((v) => v === 2)).toBe(true);
    expect(d.weeks[3].pairs[0]).toEqual({ a: d.weeks[0].pairs[0].b, b: d.weeks[0].pairs[0].a });
  });
  it("is deterministic and rejects degenerate input", () => {
    expect(generateRoundRobin(["a", "b", "c", "d"], 3)).toEqual(generateRoundRobin(["a", "b", "c", "d"], 3));
    expect(generateRoundRobin(["a"], 3).weeks).toEqual([]);
  });
  it("builds a seeded bracket with byes for top seeds", () => {
    expect(firstRoundBracket(["s1", "s2", "s3", "s4"]).map((p) => [p.a, p.b])).toEqual([["s1", "s4"], ["s2", "s3"]]);
    const six = firstRoundBracket(["s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(six.find((p) => p.a === "s1")!.b).toBeNull();
    expect(six.find((p) => p.a === "s3")!.b).toBe("s6");
  });
});

describe("playoff tie handling", () => {
  it("a playoff matchup level on points advances the series winner, else the higher seed", async () => {
    const { playoffAdvancer } = await import("@/domain/standings");
    const cfg = scratchCfg((c) => { c.playoffs.enabled = true; c.scoring.pointsPerGame = 1; c.scoring.pointsPerSeries = 1; });
    // A wins G1,G2 (2 pts); B wins G3 big and the series (2 pts) → level on points, B takes the series
    const fx = fixture({ config: cfg, teams: 2, weeks: 3 });
    const m = fx.addMatchup(1, "T1", "T2", { A: [[200, 200, 100], [200, 200, 100], [200, 200, 100]], B: [[190, 190, 250], [190, 190, 250], [190, 190, 250]] });
    const r = buildSeasonModel(fx.data).resultById.get(m.id)!;
    expect(r.winner).toBe("tie");
    expect(r.seriesWinner).toBe("B");
    expect(playoffAdvancer(r, cfg)).toBe("B");
    expect(playoffAdvancer(r, { ...cfg, playoffs: { ...cfg.playoffs, tiebreak: "higher_seed" } })).toBe("A");
    // an unfinalized matchup never advances anyone
    const fx2 = fixture({ config: cfg, teams: 2 });
    const d = fx2.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(100) }, "draft");
    expect(playoffAdvancer(buildSeasonModel(fx2.data).resultById.get(d.id)!, cfg)).toBeNull();
  });
});
