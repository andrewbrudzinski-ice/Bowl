import { describe, expect, it } from "vitest";
import { buildSeasonModel } from "@/domain/engine";
import { cfgWith, fixture } from "./helpers";

const A = [[150, 160, 170], [140, 150, 160], [180, 170, 160]];
const B = [[200, 190, 210], [180, 170, 190], [210, 200, 180]];

function setup(config = cfgWith(() => {}), enterA = 160, enterB = 200) {
  const fx = fixture({ config, teams: 4 });
  for (const r of fx.data.roster) r.enteringAverage = r.teamId === "T1" ? enterA : r.teamId === "T2" ? enterB : 180;
  return fx;
}

describe("matchup evaluation (hand-calculated)", () => {
  it("computes handicap, adjusted games, series, points and winner", () => {
    const fx = setup();
    const m = fx.addMatchup(1, "T1", "T2", { A, B });
    const model = buildSeasonModel(fx.data);
    const r = model.resultById.get(m.id)!;
    expect(r.a.lineup.map((l) => l.handicap)).toEqual([54, 54, 54]); // (220-160)*.9
    expect(r.b!.lineup.map((l) => l.handicap)).toEqual([18, 18, 18]); // (220-200)*.9
    expect(r.a.games.map((g) => g.scratch)).toEqual([470, 480, 490]);
    expect(r.a.games.map((g) => g.adjusted)).toEqual([632, 642, 652]);
    expect(r.b!.games.map((g) => g.adjusted)).toEqual([644, 614, 634]);
    expect(r.a.scratchSeries).toBe(1440);
    expect(r.a.handicapSeries).toBe(486); // 162 × 3
    expect(r.a.adjustedSeries).toBe(1926);
    expect(r.b!.adjustedSeries).toBe(1892);
    expect(r.games.map((g) => g.winner)).toEqual(["B", "A", "A"]);
    expect(r.seriesWinner).toBe("A");
    expect(r.a.points).toBe(3);
    expect(r.b!.points).toBe(1);
    expect(r.winner).toBe("A");
    expect(r.margin).toBe(34);
    expect(r.complete).toBe(true);
  });

  it("same scores under different leagues' rules give different, correct results", () => {
    const hcap = setup();
    const scratch = setup(cfgWith((c) => { c.handicap.enabled = false; c.scoring.basis = "scratch"; }));
    const m1 = hcap.addMatchup(1, "T1", "T2", { A, B });
    const m2 = scratch.addMatchup(1, "T1", "T2", { A, B });
    const r1 = buildSeasonModel(hcap.data).resultById.get(m1.id)!;
    const r2 = buildSeasonModel(scratch.data).resultById.get(m2.id)!;
    expect(r1.winner).toBe("A");
    expect(r2.winner).toBe("B"); // 1730 scratch beats 1440
    expect(r2.a.points).toBe(0);
    expect(r2.b!.points).toBe(4);
    expect(r2.a.lineup[0].handicap).toBe(0);
  });

  it("changing percentage / base / game count / point values changes results independently", () => {
    const a = setup(cfgWith((c) => { c.handicap.percentage = 100; c.handicap.baseValue = 200; }));
    const m = a.addMatchup(1, "T1", "T2", { A, B });
    const r = buildSeasonModel(a.data).resultById.get(m.id)!;
    expect(r.a.lineup[0].handicap).toBe(40); // (200-160)*100%
    expect(r.b!.lineup[0].handicap).toBe(0); // (200-200)
    const pts = setup(cfgWith((c) => { c.scoring.pointsPerGame = 2; c.scoring.pointsPerSeries = 3; }));
    const m2 = pts.addMatchup(1, "T1", "T2", { A, B });
    const r2 = buildSeasonModel(pts.data).resultById.get(m2.id)!;
    expect(r2.a.points).toBe(2 * 2 + 3);
    expect(r2.b!.points).toBe(2);
    const two = setup(cfgWith((c) => { c.scoring.gamesPerSession = 2; }));
    const m3 = two.addMatchup(1, "T1", "T2", { A: A.map((x) => x.slice(0, 2)), B: B.map((x) => x.slice(0, 2)) });
    const r3 = buildSeasonModel(two.data).resultById.get(m3.id)!;
    expect(r3.games).toHaveLength(2);
    expect(r3.a.adjustedSeries).toBe(632 + 642);
    expect(r3.complete).toBe(true);
  });

  it("awards split points on tied games and tied series", () => {
    const fx = setup(cfgWith((c) => { c.handicap.enabled = false; c.scoring.basis = "scratch"; }));
    const same = [[150, 150, 150], [150, 150, 150], [150, 150, 150]];
    const m = fx.addMatchup(1, "T1", "T2", { A: same, B: same });
    const r = buildSeasonModel(fx.data).resultById.get(m.id)!;
    expect(r.games.every((g) => g.winner === "tie")).toBe(true);
    expect(r.seriesWinner).toBe("tie");
    expect(r.a.points).toBe(2); // 3×0.5 + 0.5
    expect(r.b!.points).toBe(2);
    expect(r.winner).toBe("tie");
  });

  it("can decide the matchup by series total instead of points", () => {
    const fx = setup(cfgWith((c) => { c.scoring.matchupWinnerBy = "series"; c.scoring.pointsPerSeries = 0; }));
    const m = fx.addMatchup(1, "T1", "T2", { A, B });
    const r = buildSeasonModel(fx.data).resultById.get(m.id)!;
    expect(r.a.points).toBe(2);
    expect(r.winner).toBe("A");
  });

  it("flags missing games and does not call an incomplete matchup final", () => {
    const fx = setup();
    const m = fx.addMatchup(1, "T1", "T2", { A, B: [[200, 190], [180, 170], [210, 200]] }, "draft");
    const r = buildSeasonModel(fx.data).resultById.get(m.id)!;
    expect(r.complete).toBe(false);
    expect(r.missing).toHaveLength(3);
    expect(r.winner).toBeNull();
    expect(r.official).toBe(false);
    expect(r.counts).toBe(false);
    expect(r.games[2].status).toBe("incomplete");
  });

  it("scores absent bowlers with a blind score, and excludes it from averages", () => {
    const fx = setup();
    const m = fx.addMatchup(1, "T1", "T2", { A: [A[0], A[1]], B });
    // third bowler absent for all games
    for (let g = 1; g <= 3; g++) fx.data.scores.push({ id: `abs${g}`, matchupId: m.id, bowlerId: "B13", side: "A", game: g, scratch: null, kind: "absent", updatedAt: "", updatedBy: "u" });
    const model = buildSeasonModel(fx.data);
    const r = model.resultById.get(m.id)!;
    const line = r.a.lineup[2];
    expect(line.absent).toBe(true);
    expect(line.games[0].scratch).toBe(150); // entering 160 − offset 10
    expect(line.games[0].blind).toBe(true);
    expect(model.officialGames.get("B13")).toBeUndefined();
    expect(r.complete).toBe(true);
  });

  it("forfeit awards maximum points to the opponent", () => {
    const fx = setup();
    const m = fx.addMatchup(1, "T1", "T2", { A: [], B: [] }, "finalized", { forfeitBy: "A" });
    const r = buildSeasonModel(fx.data).resultById.get(m.id)!;
    expect(r.winner).toBe("B");
    expect(r.b!.points).toBe(4);
    expect(r.a.points).toBe(0);
  });

  it("applies bonus points for high game / high series", () => {
    const fx = setup(cfgWith((c) => { c.scoring.bonus = { highGame: 1, highSeries: 2 }; }));
    const m = fx.addMatchup(1, "T1", "T2", { A, B });
    const r = buildSeasonModel(fx.data).resultById.get(m.id)!;
    expect(r.a.bonusPoints + r.b!.bonusPoints).toBe(3);
    expect(r.a.points + r.b!.points).toBe(4 + 3);
  });

  it("evaluates bowler-vs-bowler pairs for the combined format", () => {
    const fx = setup(cfgWith((c) => { c.format = "both"; c.scoring.individual = { pointsPerGame: 1, pointsPerSeries: 2 }; }));
    const m = fx.addMatchup(1, "T1", "T2", { A, B });
    const r = buildSeasonModel(fx.data).resultById.get(m.id)!;
    expect(r.pairs).toHaveLength(3);
    // pair 1 adjusted: A 204/214/224 vs B 218/208/228 → B wins games 1 and 3, A wins game 2; series 642 vs 654 → B
    expect(r.pairs[0].winsA).toBe(1);
    expect(r.pairs[0].winsB).toBe(2);
    expect(r.pairs[0].pointsB).toBe(2 + 2);
    expect(r.pairs[0].pointsA).toBe(1);
  });
});

describe("handicaps over a season", () => {
  it("uses only finalized prior-week games, never the current or draft week", () => {
    const cfg = cfgWith((c) => { c.handicap.establishAfterGames = 3; });
    const fx = fixture({ config: cfg, teams: 2 });
    fx.addMatchup(1, "T1", "T2", { A: [[200, 200, 200], [200, 200, 200], [200, 200, 200]], B: [[150, 150, 150], [150, 150, 150], [150, 150, 150]] });
    fx.addMatchup(2, "T1", "T2", { A: [[100, 100, 100], [100, 100, 100], [100, 100, 100]], B: [[150, 150, 150], [150, 150, 150], [150, 150, 150]] }, "draft");
    const model = buildSeasonModel(fx.data);
    expect(model.handicapAt("B11", 1).average.average).toBe(160); // entering
    expect(model.handicapAt("B11", 2).average.average).toBe(200); // week 1 average
    expect(model.handicapAt("B11", 2).breakdown.handicap).toBe(18);
    expect(model.handicapAt("B11", 3).average.average).toBe(200); // draft week 2 ignored
  });

  it("locked finalized matchups keep their snapshot when earlier scores are corrected; live mode recomputes", () => {
    const build = (lock: "locked" | "live") => {
      const fx = fixture({ config: cfgWith((c) => { c.handicap.lockMode = lock; }), teams: 2 });
      const same = [[200, 200, 200], [200, 200, 200], [200, 200, 200]];
      fx.addMatchup(1, "T1", "T2", { A: same, B: same });
      const m2 = fx.addMatchup(2, "T1", "T2", { A: same, B: same }, "finalized", {
        ruleVersion: 1,
        handicapSnapshot: Object.fromEntries(fx.data.roster.map((r) => [r.bowlerId, { average: 200, handicap: 18, note: "" }])),
      });
      // correct week 1: lower scores
      for (const s of fx.data.scores) if (s.matchupId !== m2.id) s.scratch = 100;
      return buildSeasonModel(fx.data).resultById.get(m2.id)!.a.lineup[0].handicap;
    };
    expect(build("locked")).toBe(18);
    expect(build("live")).toBe(108); // (220-100)*.9
  });
});
