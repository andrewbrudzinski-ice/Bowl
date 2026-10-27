import { describe, expect, it } from "vitest";
import { computeAwards, defaultAwardsConfig } from "@/domain/awards";
import { buildSeasonModel } from "@/domain/engine";
import { generateInsights, matchupRecap } from "@/domain/narrative";
import { buildRecordBook, recordsBrokenInWeek } from "@/domain/records";
import { previewRuleChange, firstEligibleWeek } from "@/domain/rulechange";
import { validateEntry, auditConsistency } from "@/domain/validate";
import { cfgWith, fixture } from "./helpers";

const flat = (score: number, bowlers = 3, games = 3) => Array.from({ length: bowlers }, () => Array(games).fill(score));
const scratchCfg = (patch: (c: ReturnType<typeof cfgWith>) => void = () => {}) =>
  cfgWith((c) => { c.handicap.enabled = false; c.scoring.basis = "scratch"; c.standings.pinsBasis = "scratch"; patch(c); });

describe("awards", () => {
  it("bowler of the week = most pins over own average; ties are shared; commissioner awards are labelled", () => {
    const fx = fixture({ config: scratchCfg(), teams: 2, entering: 150 });
    // everyone averages 150 entering; B11 and B12 both bowl 600 (+150 over), others 450
    fx.addMatchup(1, "T1", "T2", { A: [[200, 200, 200], [200, 200, 200], [150, 150, 150]], B: flat(150) });
    const model = buildSeasonModel(fx.data);
    const aw = computeAwards(model, defaultAwardsConfig(), {
      week: 1,
      commissioner: [{ id: "c1", title: "Spirit Award", recipientKind: "bowler", recipientId: "B21", note: "Great sport", week: 1 }],
    });
    const bow = aw.find((a) => a.id === "bowler_of_week")!;
    expect(bow.winners.map((w) => w.id).sort()).toEqual(["B11", "B12"]);
    expect(bow.winners[0].detail).toContain("+150");
    const c = aw.find((a) => a.source === "commissioner")!;
    expect(c.summary).toMatch(/Commissioner award/);
    expect(c.id).toBe("commissioner:c1");
  });
  it("respects disabled awards", () => {
    const fx = fixture({ config: scratchCfg(), teams: 2 });
    fx.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(150) });
    const cfg = defaultAwardsConfig();
    cfg.high_game.enabled = false;
    const aw = computeAwards(buildSeasonModel(fx.data), cfg, { week: 1 });
    expect(aw.find((a) => a.id === "high_game")).toBeUndefined();
    expect(aw.find((a) => a.id === "high_series")).toBeDefined();
  });
  it("most improved needs a meaningful sample; a single hot game cannot win it", () => {
    const fx = fixture({ config: scratchCfg(), teams: 2, weeks: 4, entering: 150 });
    // B11: steady 150s with one 250 game in week 3 — window 6, minGames 9 → only 9 games by week 3
    fx.addMatchup(1, "T1", "T2", { A: [[150, 150, 150], ...flat(150, 2)], B: flat(150) });
    fx.addMatchup(2, "T1", "T2", { A: [[150, 150, 150], ...flat(150, 2)], B: flat(150) });
    fx.addMatchup(3, "T1", "T2", { A: [[250, 150, 150], ...flat(150, 2)], B: flat(150) });
    const model = buildSeasonModel(fx.data);
    const cfg = defaultAwardsConfig();
    const mi = computeAwards(model, cfg).find((a) => a.id === "most_improved");
    // recent 6 games: 150,150,150,250,150,150 = 166.7 vs baseline 150 → only +16.7 and they'd be flagged with the window.
    expect(mi?.winners[0].detail).toMatch(/last 6 games/);
    // 3 games isn't enough to qualify
    const fx2 = fixture({ config: scratchCfg(), teams: 2, entering: 150 });
    fx2.addMatchup(1, "T1", "T2", { A: [[250, 250, 250], ...flat(150, 2)], B: flat(150) });
    expect(computeAwards(buildSeasonModel(fx2.data), cfg).find((a) => a.id === "most_improved")).toBeUndefined();
  });
});

describe("records book", () => {
  it("retains prior holders and handles ties", () => {
    const fx = fixture({ config: scratchCfg(), teams: 2, weeks: 4 });
    fx.addMatchup(1, "T1", "T2", { A: [[200, 150, 150], ...flat(150, 2)], B: flat(150) });
    fx.addMatchup(2, "T1", "T2", { A: [[210, 150, 150], ...flat(150, 2)], B: flat(150) });
    fx.addMatchup(3, "T1", "T2", { A: flat(150), B: [[210, 150, 150], ...flat(150, 2)] });
    const book = buildRecordBook([buildSeasonModel(fx.data)]);
    const hg = book.find((r) => r.key === "ind_scratch_game")!;
    expect(hg.value).toBe(210);
    expect(hg.holders.map((h) => h.holderId).sort()).toEqual(["B11", "B21"]); // tied
    expect(hg.history.map((h) => [h.value, h.status])).toEqual([[200, "former"], [210, "current"], [210, "tied"]]);
    expect(recordsBrokenInWeek(book, fx.data.season.id, 2).some((x) => x.item.key === "ind_scratch_game" && x.kind === "new")).toBe(true);
    expect(recordsBrokenInWeek(book, fx.data.season.id, 3).some((x) => x.item.key === "ind_scratch_game" && x.kind === "tied")).toBe(true);
  });
});

describe("recaps and insights", () => {
  it("states 'won two of three games but lost the series' only when true", () => {
    const fx = fixture({ config: scratchCfg(), teams: 2 });
    // A wins G1,G2 narrowly, B crushes G3 → B wins series
    const m = fx.addMatchup(1, "T1", "T2", { A: [[160, 160, 100], ...flat(160, 2).map((g) => [g[0], g[1], 100])], B: flat(150).map((g) => [g[0], g[1], 200]) });
    const model = buildSeasonModel(fx.data);
    const lines = matchupRecap(model, model.resultById.get(m.id)!).map((l) => l.text).join(" | ");
    expect(lines).toMatch(/Team A won two of three games but lost the overall series, 1740–1980|Team A won two of three games but lost the overall series/);
    // an ordinary win does not produce the claim
    const fx2 = fixture({ config: scratchCfg(), teams: 2 });
    const m2 = fx2.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(150) });
    const model2 = buildSeasonModel(fx2.data);
    const t2 = matchupRecap(model2, model2.resultById.get(m2.id)!).map((l) => l.text).join(" | ");
    expect(t2).not.toMatch(/lost the overall series/);
    expect(t2).toMatch(/swept all three games/);
  });
  it("produces no recap for drafts or incomplete matchups", () => {
    const fx = fixture({ config: scratchCfg(), teams: 2 });
    const m = fx.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(150) }, "draft");
    const model = buildSeasonModel(fx.data);
    expect(matchupRecap(model, model.resultById.get(m.id)!)).toEqual([]);
  });
  it("flags a narrow margin with the stated cutoff and detects handicap flips", () => {
    const fx = fixture({ config: cfgWith(() => {}), teams: 2 });
    for (const r of fx.data.roster) r.enteringAverage = r.teamId === "T1" ? 200 : 140;
    // T1 higher scratch, T2 gets bigger handicap
    const m = fx.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(190) });
    const model = buildSeasonModel(fx.data);
    const text = matchupRecap(model, model.resultById.get(m.id)!).map((l) => l.text).join(" | ");
    expect(text).toMatch(/higher scratch series/);
    expect(text).toMatch(/won on handicap-adjusted pins/);
  });
  it("insight: consecutive series above average and team streaks carry their numbers", () => {
    const fx = fixture({ config: scratchCfg(), teams: 2, weeks: 6, entering: 150 });
    for (let w = 1; w <= 4; w++) fx.addMatchup(w, "T1", "T2", { A: flat(200 + 10 * w), B: flat(150) });
    const model = buildSeasonModel(fx.data);
    const ins = generateInsights(model);
    const streak = ins.find((i) => i.kind === "team_streak");
    expect(streak?.text).toBe("Team A has won 4 consecutive matchups.");
    expect(streak?.support.join()).toContain("W W W W");
    expect(ins.some((i) => i.kind === "above_average_series")).toBe(true);
  });
});

describe("validation", () => {
  const setup = () => {
    const fx = fixture({ config: scratchCfg(), teams: 3 });
    const m = fx.addMatchup(1, "T1", "T2", { A: [], B: [] }, "draft");
    return { fx, m, model: buildSeasonModel(fx.data) };
  };
  it("rejects out-of-range, non-integer and duplicate scores; warns about suspicious ones", () => {
    const { m, model } = setup();
    const cfg = model.configForWeek(1);
    const issues = validateEntry(model, m, [
      { bowlerId: "B11", side: "A", game: 1, scratch: 301, kind: "bowled" },
      { bowlerId: "B11", side: "A", game: 2, scratch: 150.5, kind: "bowled" },
      { bowlerId: "B12", side: "A", game: 1, scratch: 40, kind: "bowled" },
      { bowlerId: "B12", side: "A", game: 1, scratch: 40, kind: "bowled" },
    ], cfg, { forFinalize: false });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("out_of_range");
    expect(codes).toContain("not_integer");
    expect(codes).toContain("duplicate_score");
    expect(issues.find((i) => i.code === "suspicious")?.message).toMatch(/pins below/);
  });
  it("blocks finalize when scores are missing but only warns for drafts", () => {
    const { m, model } = setup();
    const cfg = model.configForWeek(1);
    expect(validateEntry(model, m, [], cfg, { forFinalize: false }).filter((i) => i.code === "missing_score").every((i) => i.severity === "warning")).toBe(true);
    expect(validateEntry(model, m, [], cfg, { forFinalize: true }).some((i) => i.code === "missing_score" && i.severity === "error")).toBe(true);
  });
  it("catches wrong-team bowlers, double bookings and duplicate matchups", () => {
    const { fx, m } = setup();
    m.lineupA = ["B11", "B12", "B31"]; // B31 belongs to T3
    fx.addMatchup(1, "T3", "T2", { A: [], B: [] }, "draft"); // T2 already has a matchup in week 1; also B31 not in it
    const model = buildSeasonModel(fx.data);
    const issues = validateEntry(model, m, [], model.configForWeek(1), { forFinalize: false });
    expect(issues.some((i) => i.code === "wrong_team" && i.bowlerId === "B31")).toBe(true);
    expect(issues.some((i) => i.code === "duplicate_matchup")).toBe(true);
  });
  it("audits finalized matchups that are missing scores", () => {
    const fx = fixture({ config: scratchCfg(), teams: 2 });
    fx.addMatchup(1, "T1", "T2", { A: [[200, 200]], B: flat(150) }, "finalized");
    const issues = auditConsistency(buildSeasonModel(fx.data));
    expect(issues.some((i) => i.code === "inconsistent_final" && i.severity === "error")).toBe(true);
  });
});

describe("rule change preview", () => {
  const build = () => {
    const fx = fixture({ config: cfgWith(() => {}), teams: 2, weeks: 4 });
    for (const r of fx.data.roster) r.enteringAverage = r.teamId === "T1" ? 160 : 200;
    const snap = (ids: string[], avg: number, h: number) => Object.fromEntries(ids.map((i) => [i, { average: avg, handicap: h, note: "" }]));
    fx.addMatchup(1, "T1", "T2", { A: flat(180), B: flat(190) }, "finalized", {
      ruleVersion: 1,
      handicapSnapshot: { ...snap(["B11", "B12", "B13"], 160, 54), ...snap(["B21", "B22", "B23"], 200, 18) },
    });
    fx.addMatchup(2, "T1", "T2", { A: [], B: [] }, "scheduled");
    return fx;
  };
  const proposed = (fx: Awaited<ReturnType<typeof build>>, pct: number) => {
    const c = structuredClone(fx.data.season.ruleVersions[0].config);
    c.handicap.percentage = pct;
    return c;
  };
  it("future-week change leaves finalized results untouched and previews new handicaps", () => {
    const fx = build();
    const p = previewRuleChange(fx.data, proposed(fx, 50), { type: "from_week", week: 2 });
    expect(p.ok).toBe(true);
    expect(p.finalizedAffected).toEqual([]);
    expect(p.requiresStrongConfirmation).toBe(false);
    expect(p.affectedWeeks).toEqual([2, 3, 4]);
    expect(p.handicapChanges.length).toBeGreaterThan(0);
    expect(p.handicapChanges.every((h) => h.week === 2)).toBe(true);
  });
  it("refuses to change weeks that already have finalized results unless done as a historical correction", () => {
    const fx = build();
    expect(firstEligibleWeek(fx.data)).toBe(2);
    const p = previewRuleChange(fx.data, proposed(fx, 50), { type: "from_week", week: 1 });
    expect(p.ok).toBe(false);
    expect(p.blockers.join()).toMatch(/already has finalized results/);
  });
  it("historical correction shows reversed results and demands stronger confirmation", () => {
    const fx = build();
    // week 1 with 90%: A adj 180+54=234 vs B 190+18=208 → A wins. With handicap 0%: B wins on scratch.
    const p = previewRuleChange(fx.data, proposed(fx, 0), { type: "historical" });
    expect(p.ok).toBe(true);
    expect(p.finalizedAffected).toHaveLength(1);
    expect(p.finalizedAffected[0]).toMatchObject({ reversed: true, before: { winner: "A" }, after: { winner: "B" } });
    expect(p.requiresStrongConfirmation).toBe(true);
  });
  it("blocks structural changes once scores exist", () => {
    const fx = build();
    const c = proposed(fx, 90);
    c.scoring.gamesPerSession = 4;
    const p = previewRuleChange(fx.data, c, { type: "from_week", week: 2 });
    expect(p.ok).toBe(false);
    expect(p.blockers.join()).toMatch(/scoring.gamesPerSession cannot change/);
  });
  it("rejects invalid configurations with messages", () => {
    const fx = build();
    const c = proposed(fx, 90);
    c.scoring.minGameScore = 300;
    const p = previewRuleChange(fx.data, c, { type: "from_week", week: 2 });
    expect(p.ok).toBe(false);
    expect(p.blockers[0]).toMatch(/Minimum game score/);
  });
  it("the preview itself never mutates the season data", () => {
    const fx = build();
    const snapshot = JSON.stringify(fx.data);
    previewRuleChange(fx.data, proposed(fx, 0), { type: "historical" });
    expect(JSON.stringify(fx.data)).toBe(snapshot);
  });
});

describe("rivalries", () => {
  it("builds head-to-head from official scored results only, and invents nothing", async () => {
    const { computeRivalries } = await import("@/domain/rivalry");
    const fx = fixture({ config: scratchCfg(), teams: 3, weeks: 4 });
    fx.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(190) });
    fx.addMatchup(2, "T2", "T1", { A: flat(200), B: flat(195) });
    fx.addMatchup(3, "T1", "T2", { A: flat(150), B: flat(160) }, "draft"); // unofficial: excluded
    fx.addMatchup(1, "T3", null, { A: [] });
    const model = buildSeasonModel(fx.data);
    const rivals = computeRivalries([model], "team", "T1", fx.data.season.id);
    expect(rivals).toHaveLength(1);
    const r = rivals[0];
    expect(r.opponentId).toBe("T2");
    expect(r.allTime).toEqual({ w: 1, l: 1, t: 0 });
    expect(r.meetings).toHaveLength(2);
    expect(r.largestWin?.margin).toBe((200 - 190) * 9);
    expect(r.closestFinish?.margin).toBe(5 * 9);
    expect(r.highGame).toBe(600); // team game: three bowlers × 200
    expect(r.highSeries).toBe(1800);
    expect(computeRivalries([model], "team", "T3", fx.data.season.id)).toEqual([]);
  });
});
