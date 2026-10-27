import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@/domain/config";
import { averageCutoffWeek, calculateHandicap, resolveAverage, resolveBase } from "@/domain/handicap";
import { roundWith } from "@/domain/math";

const H = DEFAULT_CONFIG.handicap;
const hc = (patch: Partial<typeof H>) => ({ ...H, ...patch });

describe("handicap formula", () => {
  it("matches the worked example: (220−160)×90% = 54", () => {
    const r = calculateHandicap({ average: 160, base: 220 }, H);
    expect(r.handicap).toBe(54);
    expect(r.formula).toBe("(220 − 160) × 90% = 54");
  });
  it("honours a different percentage and base", () => {
    expect(calculateHandicap({ average: 160, base: 200 }, hc({ percentage: 80 })).handicap).toBe(32);
    expect(calculateHandicap({ average: 160, base: 220 }, hc({ percentage: 100 })).handicap).toBe(60);
  });
  it("rounds according to the configured mode", () => {
    // (220-163)*0.9 = 51.3 ; (220-162)*.9 = 52.2 ; (220-161)*0.9=53.1 ; use .5 case: base 220 avg 164 pct 50 → 28
    expect(calculateHandicap({ average: 163, base: 220 }, hc({ percentage: 85, rounding: "nearest" })).handicap).toBe(48); // 48.45
    expect(calculateHandicap({ average: 163, base: 220 }, hc({ percentage: 85, rounding: "ceil" })).handicap).toBe(49);
    expect(calculateHandicap({ average: 163, base: 220 }, hc({ percentage: 85, rounding: "floor" })).handicap).toBe(48);
    expect(roundWith(2.5, "nearest")).toBe(3);
    expect(roundWith(-2.5, "nearest")).toBe(-3);
    expect(roundWith(-2.5, "truncate")).toBe(-2);
    expect(roundWith(-0.2, "nearest")).toBe(0);
    expect(Object.is(roundWith(-0.2, "nearest"), -0)).toBe(false);
  });
  it("avoids binary floating point errors (0.9 × 60)", () => {
    expect(calculateHandicap({ average: 160, base: 220 }, hc({ rounding: "floor" })).handicap).toBe(54);
  });
  it("floors negative handicaps at zero by default (bowler above the base)", () => {
    const r = calculateHandicap({ average: 235, base: 220 }, H);
    expect(r.handicap).toBe(0);
    expect(r.clampedBy).toBe("negative");
  });
  it("allows negative handicaps only when explicitly enabled", () => {
    expect(calculateHandicap({ average: 235, base: 220 }, hc({ allowNegative: true, minHandicap: null })).handicap).toBe(-14); // −13.5 → −14 (half away from zero)
    expect(calculateHandicap({ average: 260, base: 220 }, hc({ allowNegative: true, minHandicap: -20 })).handicap).toBe(-20);
  });
  it("applies minimum and maximum handicap", () => {
    expect(calculateHandicap({ average: 215, base: 220 }, hc({ minHandicap: 10 })).handicap).toBe(10);
    expect(calculateHandicap({ average: 100, base: 220 }, hc({ maxHandicap: 75 })).handicap).toBe(75);
  });
  it("is zero when handicap is disabled or no average exists", () => {
    expect(calculateHandicap({ average: 120, base: 220 }, hc({ enabled: false })).handicap).toBe(0);
    expect(calculateHandicap({ average: null, base: 220 }, H).handicap).toBe(0);
  });
});

describe("average resolution", () => {
  it("uses entering average until enough games are bowled", () => {
    const r = resolveAverage({ enteringAverage: 150, games: [200, 200], isSub: false }, H);
    expect(r.average).toBe(150);
    expect(r.source).toBe("entering");
  });
  it("switches to the season average once established (after N games)", () => {
    const r = resolveAverage({ enteringAverage: 150, games: [180, 190, 200], isSub: false }, H);
    expect(r.average).toBe(190);
  });
  it("floors the average before use by default, and can keep decimals", () => {
    const g = [180, 181, 182, 183];
    expect(resolveAverage({ enteringAverage: 150, games: g, isSub: false }, H).average).toBe(181);
    expect(resolveAverage({ enteringAverage: 150, games: g, isSub: false }, hc({ averageRounding: "none" })).average).toBe(181.5);
    expect(resolveAverage({ enteringAverage: 150, games: g, isSub: false }, hc({ averageRounding: "nearest" })).average).toBe(182);
  });
  it("can always use the entering average", () => {
    const r = resolveAverage({ enteringAverage: 150, games: [200, 210, 220, 230], isSub: false }, hc({ averageSource: "entering" }));
    expect(r.average).toBe(150);
  });
  it("supports rolling and blended averages", () => {
    const games = [200, 200, 200, 200, 200, 200];
    expect(resolveAverage({ enteringAverage: 150, games, isSub: false }, hc({ averageMethod: "rolling", rollingGames: 3 })).average).toBe(200);
    // entering 150 × 9 + 1200 = 2550 / 15 = 170
    expect(resolveAverage({ enteringAverage: 150, games, isSub: false }, hc({ averageMethod: "blended", blendGames: 9 })).average).toBe(170);
  });
  it("brand-new bowlers follow the configured policy", () => {
    expect(resolveAverage({ enteringAverage: null, games: [], isSub: false }, hc({ newBowlerPolicy: "no_handicap" })).average).toBeNull();
    expect(resolveAverage({ enteringAverage: null, games: [], isSub: false }, hc({ newBowlerPolicy: "fixed_average", newBowlerAverage: 140 })).average).toBe(140);
    expect(resolveAverage({ enteringAverage: null, games: [], isSub: false }, H).average).toBeNull(); // first_games_average with no games
    expect(resolveAverage({ enteringAverage: null, games: [170, 180], isSub: false }, H).average).toBe(175); // before establishment, uses games so far
  });
  it("substitutes follow the sub policy", () => {
    expect(resolveAverage({ enteringAverage: 200, games: [], isSub: true }, hc({ subPolicy: "fixed_average", subAverage: 140 })).average).toBe(140);
    expect(resolveAverage({ enteringAverage: 200, games: [], isSub: true }, hc({ subPolicy: "no_handicap" })).average).toBeNull();
  });
});

describe("base resolution and refresh cadence", () => {
  it("fixed, league-average and highest-average bases", () => {
    expect(resolveBase(H, { averages: [150, 170] }).base).toBe(220);
    expect(resolveBase(hc({ baseMode: "league_average" }), { averages: [150, 170, 190] }).base).toBe(170);
    expect(resolveBase(hc({ baseMode: "highest_average" }), { averages: [150, 170, 190] }).base).toBe(190);
    expect(resolveBase(hc({ baseMode: "league_average", baseValue: 205 }), { averages: [] }).base).toBe(205); // no data → fixed fallback
  });
  it("recalculates only every N weeks", () => {
    expect([1, 2, 3, 4, 5].map((w) => averageCutoffWeek(w, 1))).toEqual([0, 1, 2, 3, 4]);
    expect([1, 2, 3, 4, 5, 6, 7].map((w) => averageCutoffWeek(w, 3))).toEqual([0, 0, 0, 3, 3, 3, 6]);
  });
});
