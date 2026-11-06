import { describe, expect, it } from "vitest";
import type { RuleConfig } from "@/domain/config";
import { buildSeasonModel } from "@/domain/engine";
import { buildWeeklySheet } from "@/domain/sheet";
import { seasonData } from "@/server/access";
import { renderSheetPdf, text } from "@/server/sheet-pdf";
import { cfgWith, fixture, type Fixture } from "./helpers";
import { mkStore, mkUser } from "./world";
import { DEFAULT_CONFIG, normalizeConfig } from "@/domain/config";
import { createLeague } from "@/server/services/leagues";
import { finalizeMatchup, saveEntry } from "@/server/services/results";
import { addBowler, addToRoster, drawWeekPartners } from "@/server/services/season";

const meta = { leagueName: "Thursday Night Strikers", seasonName: "2026 Season", logoText: "TNS" };
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
function play(fx: Fixture, weeks: number[], teams: [string, string] = ["T1", "T2"], a = 200, b = 180) {
  for (const w of weeks) fx.addMatchup(w, teams[0], teams[1], { A: flat(a), B: flat(b) });
}
/** The PDF's text, uncompressed so it can be searched, and its page count. */
function render(fx: Fixture, week: number, m = meta) {
  const model = buildSeasonModel(fx.data);
  const bytes = renderSheetPdf(model, buildWeeklySheet(model, week)!, m, { compress: false });
  const raw = Buffer.from(bytes).toString("latin1");
  return { bytes, raw, pages: (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length };
}

describe("weekly sheet PDF", () => {
  it("is a real PDF with the sheet's content", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg() });
    play(fx, [1, 2]);
    fx.addMatchup(3, "T1", "T2", { A: [] }, "scheduled");
    const { bytes, raw, pages } = render(fx, 3);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(Buffer.from(bytes.slice(-6)).toString()).toContain("%%EOF");
    expect(pages).toBe(1);
    for (const s of ["Week 3 sheet", "THURSDAY NIGHT STRIKERS", "LAST WEEK", "Team A vs Team B", "STANDINGS ENTERING WEEK 3", "THIS WEEK", "AVERAGES & HANDICAPS", "Bowler 1.1", "Page 1 of 1"]) expect(raw, s).toContain(s);
  });

  it("is smaller when compressed, and the same document", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg() });
    play(fx, [1]);
    const model = buildSeasonModel(fx.data);
    const sheet = buildWeeklySheet(model, 2)!;
    const small = renderSheetPdf(model, sheet, meta);
    const big = renderSheetPdf(model, sheet, meta, { compress: false });
    expect(small.length).toBeLessThan(big.length);
    expect(Buffer.from(small.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("shows no points or handicaps in a handicap week", () => {
    const fx = fixture({ teams: 2, weeks: 6, config: cfg(1) });
    play(fx, [1]);
    const next = render(fx, 2);
    expect(next.raw).toContain("Handicap week: bowled scratch, no points or winners.");
    expect(next.raw).toContain("Standings start after the handicap weeks.");
    expect(next.raw).not.toMatch(/\(Pts\)/);
    fx.data.matchups.length = 0;
    fx.addMatchup(1, "T1", "T2", { A: [] }, "scheduled");
    const first = render(fx, 1);
    expect(first.raw).toContain("HANDICAP WEEK");
    expect(first.raw).toContain("no handicap this week");
    expect(first.raw).not.toContain("(Hdcp)");
  });

  it("runs onto more pages for a big league, with the header row repeated and nothing cut off", () => {
    const fx = fixture({ teams: 12, perTeam: 4, weeks: 8, config: cfg() });
    for (const [a, b] of [["T1", "T2"], ["T3", "T4"], ["T5", "T6"], ["T7", "T8"], ["T9", "T10"], ["T11", "T12"]] as const) fx.addMatchup(1, a, b, { A: flat(190, 4), B: flat(180, 4) });
    for (const [a, b] of [["T1", "T3"], ["T2", "T4"], ["T5", "T7"], ["T6", "T8"], ["T9", "T11"], ["T10", "T12"]] as const) fx.addMatchup(2, a, b, { A: [] }, "scheduled");
    const { raw, pages } = render(fx, 2);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(raw).toContain(`Page ${pages} of ${pages}`);
    expect((raw.match(/\(Bowler\)/g) ?? []).length).toBeGreaterThan(pages); // the averages table repeats its header on each page it spans
    expect(raw).toContain("Bowler 12.4"); // the last bowler on the last team is not lost
  });

  it("copes with a league that has nothing yet", () => {
    const fx = fixture({ teams: 2, weeks: 4, config: cfg() });
    const { raw, pages } = render(fx, 1);
    expect(pages).toBe(1);
    expect(raw).toContain("No results yet. This is the first night of the season.");
    expect(raw).toContain("No matchups are scheduled for this week yet.");
  });

  it("replaces characters the PDF's standard fonts can't show", () => {
    expect(text("Zoë Müller")).toBe("Zoë Müller"); // Latin-1 is kept
    expect(text("Dvořák")).toBe("Dvorák"); // an accent Latin-1 lacks is dropped, the rest kept
    expect(text("It’s a “test” – ok − fine")).toBe("It's a \"test\" - ok - fine");
    expect(text("Łukasz 王")).toBe("?ukasz ?");
  });
});

describe("weekly sheet PDF for rotating partners", () => {
  it("names the pairs, the extra comparison and anyone sitting out", async () => {
    const store = await mkStore();
    const owner = await mkUser(store, "owner");
    const c = normalizeConfig(DEFAULT_CONFIG);
    c.bowlersPerTeam = 2;
    c.scheduleFormat = "manual";
    c.partners.enabled = true;
    c.scoring.pointsPerGame = 2;
    c.scoring.pointsPerSeries = 1;
    const { leagueId, seasonId } = await createLeague(store, owner, { name: "Partners", visibility: "private", season: { name: "2026 Season", year: 2026, startDate: "2026-01-06", regularWeeks: 9 }, config: c });
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) {
      const b = await addBowler(store, owner, leagueId, { name: `Bowler${i + 1} Test` });
      ids.push(b);
      await addToRoster(store, owner, leagueId, seasonId, { bowlerId: b, teamId: null, enteringAverage: 150 });
    }
    await drawWeekPartners(store, owner, leagueId, seasonId, { week: 1, bowlerIds: ids, seed: 3 });
    for (const m of await store.read((db) => db.matchups.filter((x) => x.seasonId === seasonId && x.sideB).map((x) => structuredClone(x)))) {
      const scores = (["A", "B"] as const).flatMap((side) => (side === "A" ? m.lineupA : m.lineupB).flatMap((bowlerId) => [1, 2, 3].map((g) => ({ bowlerId, side, game: g, scratch: 190, kind: "bowled" as const }))));
      const res = await saveEntry(store, owner, leagueId, { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores });
      await finalizeMatchup(store, owner, leagueId, m.id, res.revision);
    }
    await drawWeekPartners(store, owner, leagueId, seasonId, { week: 2, bowlerIds: ids, seed: 4 });
    const model = await store.read((db) => buildSeasonModel(seasonData(db, leagueId, seasonId)));
    const sheet = buildWeeklySheet(model, 2)!;
    const raw = Buffer.from(renderSheetPdf(model, sheet, meta, { compress: false })).toString("latin1");
    expect(sheet.matchups.map((m) => m.kind)).toEqual(["match", "match", "bye"]);
    expect(raw).toContain("Sitting out");
    expect(raw).toMatch(/Bowler\d [&] Bowler\d|\w+ & \w+/);
    expect(raw).toContain("STANDINGS ENTERING WEEK 2");
    expect(raw).toContain("Bowler9 Test");
  });
});
