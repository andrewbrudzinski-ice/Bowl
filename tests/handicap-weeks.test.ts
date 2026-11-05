import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig, settingWeeksOf, validateConfig, type RuleConfig } from "@/domain/config";
import { describeRules } from "@/domain/describe";
import { matchupRecap } from "@/domain/narrative";
import { buildSeasonModel } from "@/domain/engine";
import { previewRuleChange } from "@/domain/rulechange";
import { computeStandings } from "@/domain/standings";
import { bowlerSeasonStats, winStreaks } from "@/domain/stats";
import { cfgWith, fixture, type Fixture } from "./helpers";

/** Handicap on (base 220 at 100%), with the first `weeks` weeks set aside for setting handicaps. */
const cfg = (weeks: number, patch: (c: RuleConfig) => void = () => {}) =>
  cfgWith((c) => {
    c.handicap.enabled = true;
    c.handicap.baseValue = 220;
    c.handicap.percentage = 100;
    c.scoring.basis = "handicap";
    c.standings.pinsBasis = "handicap";
    c.handicapSetting.weeks = weeks;
    patch(c);
  });

const flat = (score: number, bowlers = 3, games = 3) => Array.from({ length: bowlers }, () => Array(games).fill(score));
/** Two teams, T1 bowling `a` and T2 bowling `b` every game, in each of the given weeks. */
function play(fx: Fixture, weeks: number[], a = 200, b = 180) {
  for (const w of weeks) fx.addMatchup(w, "T1", "T2", { A: flat(a), B: flat(b) });
}
const standings = (fx: Fixture) => Object.fromEntries(computeStandings(buildSeasonModel(fx.data)).rows.map((r) => [r.id, r]));

describe("handicap-setting weeks", () => {
  it("are the first weeks of the season, and only those", () => {
    const model = buildSeasonModel(fixture({ teams: 2, weeks: 6, config: cfg(2) }).data);
    expect([1, 2, 3, 4].map((w) => model.isSettingWeek(w))).toEqual([true, true, false, false]);
    expect(buildSeasonModel(fixture({ teams: 2, weeks: 6, config: cfg(0) }).data).isSettingWeek(1)).toBe(false);
  });

  it("are bowled scratch with no handicap, and the following weeks use handicap as usual", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg(2) });
    play(fx, [1, 2, 3]);
    const model = buildSeasonModel(fx.data);
    const [w1, w2, w3] = model.results;
    expect([w1.basis, w2.basis, w3.basis]).toEqual(["scratch", "scratch", "handicap"]);
    expect(w1.a.lineup.every((l) => l.handicap === 0)).toBe(true);
    expect(w3.a.lineup.every((l) => l.handicap > 0)).toBe(true);
    expect(model.configForWeek(1).handicap.enabled).toBe(false);
    expect(model.configForWeek(3).handicap.enabled).toBe(true);
  });

  it("feed everyone's average and handicap, even though nothing counts", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg(2) });
    play(fx, [1, 2]);
    const model = buildSeasonModel(fx.data);
    // Bowler 1.1 averaged 200 over the setting weeks: a 20-pin handicap against the 220 base from week 3.
    expect(model.handicapAt("B11", 1).breakdown.handicap).toBe(0);
    expect(model.handicapAt("B11", 3).average.average).toBe(200);
    expect(model.handicapAt("B11", 3).breakdown.handicap).toBe(20);
    expect(model.handicapAt("B21", 3).breakdown.handicap).toBe(40);
    const stats = bowlerSeasonStats(model).find((s) => s.bowlerId === "B11")!;
    expect([stats.games, stats.nights, stats.average]).toEqual([6, 2, 200]);
  });

  it("do not count toward points, wins or the standings", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg(2) });
    play(fx, [1, 2]);
    expect(Object.values(standings(fx)).every((r) => r.played === 0 && r.points === 0 && r.wins === 0)).toBe(true);
    play(fx, [3], 170, 190); // the first counted week: T2 wins
    const s = standings(fx);
    expect([s.T1.played, s.T2.played]).toEqual([1, 1]);
    expect([s.T1.wins, s.T2.wins]).toEqual([0, 1]);
    expect(s.T2.points).toBeGreaterThan(0);
    expect(s.T1.form).toEqual(["L"]);
  });

  it("are flagged on their results, so screens can say so", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg(1) });
    play(fx, [1, 2]);
    expect(buildSeasonModel(fx.data).results.map((r) => r.settingWeek)).toEqual([true, false]);
  });

  it("announce no winner in their recaps", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg(1) });
    play(fx, [1, 2]);
    const model = buildSeasonModel(fx.data);
    const [w1, w2] = model.results;
    expect(matchupRecap(model, w1).every((l) => l.kind === "high_game")).toBe(true);
    expect(matchupRecap(model, w2).some((l) => l.kind !== "high_game")).toBe(true); // a counted week still gets its result lines
  });

  it("stay out of win streaks", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg(2) });
    play(fx, [1, 2]);
    play(fx, [3], 230, 180); // with handicaps now applied, T1 still wins week 3
    const streaks = winStreaks(buildSeasonModel(fx.data).results, "team");
    expect(streaks.find((s) => s.id === "T1")).toMatchObject({ length: 1, fromWeek: 3 });
  });

  it("work for rotating partners too: nobody is credited points", () => {
    const fx = fixture({ teams: 4, perTeam: 2, weeks: 6, config: cfg(1, (c) => { c.bowlersPerTeam = 2; c.partners.enabled = true; c.scoring.pointsPerGame = 2; c.scoring.pointsPerSeries = 1; }) });
    const lineup = (ids: string[]) => ids;
    // Week 1 is scored scratch; week 2 has handicaps from week 1's 200 and 180 averages, so the pair needs to clear 20 pins and 40 pins.
    for (const w of [1, 2]) fx.addMatchup(w, `X${w}a`, `X${w}b`, { A: flat(w === 1 ? 200 : 230, 2), B: flat(180, 2) }, "finalized", { lineupA: lineup(["B11", "B12"]), lineupB: lineup(["B21", "B22"]) });
    const rows = Object.fromEntries(computeStandings(buildSeasonModel(fx.data), { scope: "bowler" }).rows.map((r) => [r.id, r]));
    expect(rows.B11).toMatchObject({ played: 1, points: 7 }); // week 2 only
    expect(buildSeasonModel(fx.data).results[0].settingWeek).toBe(true);
  });

  it("follow the rules in force that week if the number of weeks changes", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg(2) });
    fx.data.season.ruleVersions.push({ version: 2, effectiveFromWeek: 2, config: cfg(0), createdAt: "2026-01-02T00:00:00Z", createdBy: "u1", reason: "Fewer setting weeks" });
    const model = buildSeasonModel(fx.data);
    expect([1, 2, 3].map((w) => model.isSettingWeek(w))).toEqual([true, false, false]);
  });

  it("never apply to playoff weeks", () => {
    const fx = fixture({ teams: 2, weeks: 3, config: cfg(12) });
    fx.data.weeks.push({ id: "WP", seasonId: fx.data.season.id, number: 4, date: "2026-02-03", status: "scheduled", phase: "playoff", label: "Final" });
    expect(buildSeasonModel(fx.data).isSettingWeek(4)).toBe(false);
  });

  it("are off for leagues whose rules never mentioned them", () => {
    const old = structuredClone(DEFAULT_CONFIG) as Partial<RuleConfig>;
    delete old.handicapSetting;
    const fx = fixture({ teams: 2 });
    fx.data.season.ruleVersions[0].config = old as RuleConfig;
    play(fx, [1]);
    const model = buildSeasonModel(fx.data);
    expect(model.isSettingWeek(1)).toBe(false);
    expect(settingWeeksOf(old)).toBe(0);
    expect(normalizeConfig(old).handicapSetting).toEqual({ weeks: 0 });
    expect(Object.values(standings(fx)).some((r) => r.played > 0)).toBe(true);
  });

  it("are validated and described in plain language", () => {
    expect(validateConfig(cfg(3)).ok).toBe(true);
    expect(validateConfig({ ...cfg(3), handicapSetting: { weeks: 40 } }).ok).toBe(false);
    expect(validateConfig({ ...cfg(3), handicapSetting: { weeks: 1.5 } }).ok).toBe(false);
    const text = JSON.stringify(describeRules(cfg(3)));
    expect(text).toContain("Handicap-setting weeks");
    expect(text).toContain("The first 3 weeks are bowled scratch");
    expect(JSON.stringify(describeRules(cfg(0)))).not.toContain("Handicap-setting weeks");
  });

  it("show up as a change to standings and handicaps in a rule preview", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg(0) });
    play(fx, [1], 200, 180);
    const preview = previewRuleChange(fx.data, cfg(1), { type: "historical" });
    expect(preview.classification).toMatchObject({ affectsStandings: true, affectsHandicap: true, affectsScoring: true });
    expect(preview.standingsBefore.some((r) => r.played > 0)).toBe(true);
    expect(preview.standingsAfter.every((r) => r.played === 0)).toBe(true);
  });
});
