import { describe, expect, it } from "vitest";
import type { RuleConfig } from "@/domain/config";
import { buildSeasonModel } from "@/domain/engine";
import { buildWeeklySheet, type WeeklySheet } from "@/domain/sheet";
import { cfgWith, fixture, type Fixture } from "./helpers";

/** Handicap on (100% of a 220 base, so a 160 average gets 60), with the first `settingWeeks` weeks set aside for setting handicaps. */
const cfg = (settingWeeks = 0, patch: (c: RuleConfig) => void = () => {}) =>
  cfgWith((c) => {
    c.handicap.enabled = true;
    c.handicap.baseValue = 220;
    c.handicap.percentage = 100;
    c.scoring.basis = "handicap";
    c.standings.pinsBasis = "handicap";
    c.handicapSetting.weeks = settingWeeks;
    patch(c);
  });

const flat = (score: number, bowlers = 3, games = 3) => Array.from({ length: bowlers }, () => Array(games).fill(score));
/** Two teams, T1 bowling `a` and T2 bowling `b` every game, in each of the given weeks. */
function play(fx: Fixture, weeks: number[], a = 200, b = 180) {
  for (const w of weeks) fx.addMatchup(w, "T1", "T2", { A: flat(a), B: flat(b) });
}
const sheet = (fx: Fixture, week: number): WeeklySheet => buildWeeklySheet(buildSeasonModel(fx.data), week)!;
const row = (s: WeeklySheet, id: string) => s.bowlers.find((b) => b.bowlerId === id)!;

describe("weekly sheet", () => {
  it("has nothing for a week that doesn't exist", () => {
    expect(buildWeeklySheet(buildSeasonModel(fixture({ teams: 2, weeks: 4, config: cfg() }).data), 9)).toBeNull();
  });

  it("starts the season with this week's matchups, entering averages and handicaps, and no results yet", () => {
    const fx = fixture({ teams: 2, weeks: 4, config: cfg() });
    fx.addMatchup(1, "T1", "T2", { A: [] }, "scheduled", { lineupA: [], lineupB: [] }); // nobody entered yet: the usual lineup is shown
    const s = sheet(fx, 1);
    expect([s.week, s.date, s.phase, s.settingWeek, s.handicapOn, s.partners]).toEqual([1, "2026-01-06", "regular", false, true, false]);
    expect(s.previous).toBeNull();
    expect(s.standings).toBeNull();
    expect(s.matchups).toHaveLength(1);
    const [m] = s.matchups;
    expect([m.kind, m.a.name, m.b!.name]).toEqual(["match", "Team A", "Team B"]);
    expect(m.a.lineup.map((b) => b.bowlerId)).toEqual(["B11", "B12", "B13"]);
    expect(m.a.lineup[0]).toMatchObject({ name: "Bowler 1.1", average: 160, handicap: 60 });
    expect(s.bowlers).toHaveLength(6);
    expect(row(s, "B11")).toMatchObject({ average: 160, handicap: 60, games: 0, highGame: null, highSeries: null, averageChange: null, handicapChange: null });
  });

  it("recaps the last week and shows how averages and handicaps moved going into this one", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg() });
    play(fx, [1]);
    const s = sheet(fx, 2);
    expect(s.previous).toMatchObject({ week: 1, date: "2026-01-06", settingWeek: false, notFinal: 0 });
    expect(s.previous!.results).toHaveLength(1);
    expect(s.previous!.highGame).toEqual([{ name: "Bowler 1.1", score: 200 }, { name: "Bowler 1.2", score: 200 }, { name: "Bowler 1.3", score: 200 }]);
    expect(s.previous!.topSeries[0].score).toBe(600);
    // Three games at 200 replace the entering 160 average: 40 pins up, so the 60-pin handicap falls to 20.
    expect(row(s, "B11")).toMatchObject({ games: 3, highGame: 200, highSeries: 600, average: 200, averageChange: 40, handicap: 20, handicapChange: -40 });
    expect(row(s, "B21")).toMatchObject({ average: 180, averageChange: 20, handicap: 40, handicapChange: -20 });
  });

  it("shows records and ranks next to each side, and the standings, once a week has counted", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg() });
    play(fx, [1], 200, 180);
    fx.addMatchup(2, "T1", "T2", { A: [] }, "scheduled");
    const s = sheet(fx, 2);
    expect(s.standingsFor).toBe("team");
    expect(s.standings!.map((r) => r.id)).toEqual(["T1", "T2"]);
    const [m] = s.matchups;
    expect([m.a.record, m.a.rank, m.b!.record, m.b!.rank]).toEqual(["1-0", 1, "0-1", 2]);
  });

  it("recaps the latest week that has a final result, skipping weeks nobody bowled", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg() });
    play(fx, [1]);
    fx.addMatchup(2, "T1", "T2", { A: [] }, "scheduled"); // scheduled, not bowled
    expect(sheet(fx, 3).previous!.week).toBe(1);
    expect(sheet(fx, 1).previous).toBeNull();
  });

  it("leaves off matchups that are not final yet, and says how many", () => {
    const fx = fixture({ teams: 4, weeks: 6, config: cfg() });
    fx.addMatchup(1, "T1", "T2", { A: flat(200), B: flat(180) });
    fx.addMatchup(1, "T3", "T4", { A: flat(190), B: flat(170) }, "draft");
    const p = sheet(fx, 2).previous!;
    expect(p.results).toHaveLength(1);
    expect(p.notFinal).toBe(1);
  });

  it("keeps handicaps out of a handicap-setting week and doesn't compare handicaps across it", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg(1) });
    fx.addMatchup(1, "T1", "T2", { A: [] }, "scheduled");
    const first = sheet(fx, 1);
    expect([first.settingWeek, first.handicapOn]).toEqual([true, false]);
    expect(first.matchups[0].a.lineup.every((b) => b.handicap === 0)).toBe(true);
    expect(first.bowlers.every((b) => b.handicap === 0 && b.handicapChange === null)).toBe(true);

    fx.data.matchups.length = 0;
    play(fx, [1]);
    const second = sheet(fx, 2); // the first week that counts: handicaps come from the scratch week
    expect(second.previous).toMatchObject({ week: 1, settingWeek: true });
    expect(second.standings).toBeNull(); // nothing has counted yet
    expect(second.handicapOn).toBe(true);
    expect(row(second, "B11")).toMatchObject({ average: 200, averageChange: 40, handicap: 20, handicapChange: null });
  });

  it("starts comparing handicaps again once a counted week has been bowled", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg(1) });
    play(fx, [1, 2], 200, 180);
    const s = sheet(fx, 3);
    expect(s.standings).not.toBeNull();
    expect(row(s, "B11")).toMatchObject({ averageChange: 0, handicap: 20, handicapChange: 0 });
  });

  it("lists the next weeks with their matchups, and flags a postponed week", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg() });
    fx.addMatchup(2, "T1", "T2", { A: [] }, "scheduled");
    fx.addMatchup(3, "T2", "T1", { A: [] }, "scheduled");
    fx.data.weeks.find((w) => w.number === 3)!.status = "postponed";
    const up = sheet(fx, 1).upcoming;
    expect(up.map((u) => [u.week, u.date, u.postponed])).toEqual([[2, "2026-01-13", false], [3, "2026-01-20", true]]);
    expect(up[0].matches).toEqual([{ a: "Team A", b: "Team B", extra: false }]);
    expect(sheet(fx, 6).upcoming).toEqual([]);
  });

  it("lists bowlers by team and name, hides inactive ones, and shows a substitute only after they bowl", () => {
    const fx = fixture({ teams: 2, weeks: 4, config: cfg() });
    fx.bowlers[0].active = false;
    fx.bowlers.push({ ...fx.bowlers[1], id: "SUB1", name: "Sam Sub" });
    fx.data.roster.push({ id: "RSUB1", seasonId: fx.data.season.id, bowlerId: "SUB1", teamId: "T1", enteringAverage: 150, isSub: true, fromWeek: 1, toWeek: null });
    const s = sheet(fx, 1);
    expect(s.bowlers.map((b) => b.bowlerId)).toEqual(["B12", "B13", "B21", "B22", "B23"]);
    expect(s.bowlers.map((b) => b.teamName)).toEqual(["Team A", "Team A", "Team B", "Team B", "Team B"]);
    fx.addMatchup(1, "T1", "T2", { A: [[190, 190, 190], [180, 180, 180], [170, 170, 170], [160, 160, 160]], B: flat(150) }, "finalized", { lineupA: ["B12", "B13", "SUB1", "B11"] });
    expect(sheet(fx, 2).bowlers.find((b) => b.bowlerId === "SUB1")).toMatchObject({ isSub: true, games: 3 });
  });
});
