import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isIsoDate } from "@/domain/dates";
import { computeStandings } from "@/domain/standings";
import { createNextSeason, shiftSeasonDates, updateWeek } from "@/server/services/season";
import { cfgWith } from "./helpers";
import { join, mkWorld, model, playWeek, type World } from "./world";

const weeksOf = (w: World, seasonId = w.seasonId) => w.store.read((db) => db.weeks.filter((x) => x.seasonId === seasonId).sort((a, b) => a.number - b.number).map((x) => ({ number: x.number, date: x.date, phase: x.phase })));
const startOf = (w: World, seasonId = w.seasonId) => w.store.read((db) => db.seasons.find((s) => s.id === seasonId)!.startDate);
const shift = (w: World, firstNight: string, actor = w.owner) => shiftSeasonDates(w.store, actor, w.leagueId, w.seasonId, { firstNight });

describe("date helpers", () => {
  it("accept real dates in a sensible range only", () => {
    for (const ok of ["2026-01-06", "2024-02-29", "2000-01-01", "2100-12-31"]) expect(isIsoDate(ok), ok).toBe(true);
    for (const bad of ["2026-02-31", "2025-02-29", "2026-13-01", "2026-1-6", "tomorrow", "", "0026-01-06", "2101-01-01", "1999-12-31", "2026-01-06T00:00"]) expect(isIsoDate(bad), bad).toBe(false);
  });

  it("count whole days, across month ends, leap days and daylight-saving changes", () => {
    expect(daysBetween("2026-01-06", "2026-01-13")).toBe(7);
    expect(daysBetween("2026-01-13", "2026-01-06")).toBe(-7);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("moving the whole schedule", () => {
  it("puts week 1 on the new date and keeps every week a week apart", async () => {
    const w = await mkWorld({ teams: 2, perTeam: 2, weeks: 6 });
    const r = await shift(w, "2025-11-06"); // 2026-01-06 → two months earlier
    const weeks = await weeksOf(w);
    expect(weeks.map((x) => x.date)).toEqual(["2025-11-06", "2025-11-13", "2025-11-20", "2025-11-27", "2025-12-04", "2025-12-11"]);
    expect(await startOf(w)).toBe("2025-11-06");
    expect(r).toEqual({ days: -61, weeks: 6, firstDate: "2025-11-06", lastDate: "2025-12-11" });
  });

  it("can move the schedule later, too", async () => {
    const w = await mkWorld({ teams: 2, perTeam: 2, weeks: 4 });
    const r = await shift(w, "2026-02-03");
    expect((await weeksOf(w)).map((x) => x.date)).toEqual(["2026-02-03", "2026-02-10", "2026-02-17", "2026-02-24"]);
    expect(r.days).toBe(28);
    expect(await startOf(w)).toBe("2026-02-03");
  });

  it("keeps the gaps of weeks that were moved by hand, and moves playoff weeks too", async () => {
    const w = await mkWorld({ teams: 4, perTeam: 2, weeks: 4, config: cfgWith((c) => { c.playoffs.enabled = true; c.playoffs.weeks = 2; c.playoffs.qualifiers = 4; }) });
    await updateWeek(w.store, w.owner, w.leagueId, w.seasonId, 3, { date: "2026-01-27" }); // a week was pushed back a week
    const before = await weeksOf(w);
    expect(before.map((x) => x.phase)).toEqual(["regular", "regular", "regular", "regular", "playoff", "playoff"]);
    await shift(w, "2026-01-13");
    const after = await weeksOf(w);
    expect(after.map((x) => daysBetween(before[0].date, x.date) - daysBetween(before[0].date, before[x.number - 1].date))).toEqual(Array(6).fill(7));
    expect(after[2].date).toBe("2026-02-03"); // week 3 is still one week later than it would have been
    expect(after.map((x) => x.phase)).toEqual(before.map((x) => x.phase));
  });

  it("changes dates and nothing else: results and standings stay exactly as they were", async () => {
    const w = await mkWorld({ teams: 4, perTeam: 3, weeks: 6 });
    await playWeek(w, 1);
    const [standingsBefore, matchupsBefore] = [computeStandings(await model(w)).rows, await w.store.read((db) => structuredClone(db.matchups.filter((m) => m.seasonId === w.seasonId)))];
    const scoresBefore = await w.store.read((db) => db.scores.length);
    await shift(w, "2026-03-03");
    expect(computeStandings(await model(w)).rows).toEqual(standingsBefore);
    expect(await w.store.read((db) => structuredClone(db.matchups.filter((m) => m.seasonId === w.seasonId)))).toEqual(matchupsBefore);
    expect(await w.store.read((db) => db.scores.length)).toBe(scoresBefore);
  });

  it("leaves other seasons alone", async () => {
    const w = await mkWorld({ teams: 2, perTeam: 2, weeks: 3 });
    const next = await createNextSeason(w.store, w.owner, w.leagueId, { name: "2027 Season", year: 2027, startDate: "2027-01-05", regularWeeks: 3, copyFromSeasonId: w.seasonId, copyRoster: true, copySchedule: false, completePrevious: false });
    await shift(w, "2025-12-02");
    expect((await weeksOf(w, next.seasonId)).map((x) => x.date)).toEqual(["2027-01-05", "2027-01-12", "2027-01-19"]);
    expect(await startOf(w, next.seasonId)).toBe("2027-01-05");
    expect(await startOf(w)).toBe("2025-12-02");
  });

  it("can be undone by moving it back", async () => {
    const w = await mkWorld({ teams: 2, perTeam: 2, weeks: 5 });
    const original = await weeksOf(w);
    await shift(w, "2026-06-02");
    await shift(w, original[0].date);
    expect(await weeksOf(w)).toEqual(original);
    expect(await startOf(w)).toBe(original[0].date);
  });

  it("writes one audit entry with the old and new dates, and sends members one notice", async () => {
    const w = await mkWorld({ teams: 2, perTeam: 2, weeks: 3 });
    const viewer = await join(w, "viewer");
    await shift(w, "2026-01-20");
    const audit = await w.store.read((db) => db.audit.filter((a) => a.leagueId === w.leagueId && a.action === "season.dates_shifted"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ userId: w.owner.id, entityType: "season", seasonId: w.seasonId });
    expect((audit[0].before as { weeks: { date: string }[] }).weeks.map((x) => x.date)).toEqual(["2026-01-06", "2026-01-13", "2026-01-20"]);
    expect((audit[0].after as { weeks: { date: string }[]; startDate: string }).weeks.map((x) => x.date)).toEqual(["2026-01-20", "2026-01-27", "2026-02-03"]);
    expect(audit[0].note).toBe("Moved every week 14 days later");
    const notes = await w.store.read((db) => db.notifications.filter((n) => n.type === "schedule" && n.title === "Schedule moved"));
    expect(notes.map((n) => n.userId)).toEqual([viewer.id]); // the person who moved it is not told
    expect(notes[0].body).toContain("Week 1 is now 2026-01-20");
    expect(notes[0].href).toBe(`/l/${w.slug}/schedule`);
  });

  it("is limited to people who manage the schedule", async () => {
    const w = await mkWorld({ teams: 2, perTeam: 2, weeks: 3 });
    for (const role of ["scorekeeper", "bowler", "viewer"] as const) {
      const who = await join(w, role);
      await expect(shift(w, "2026-02-03", who), role).rejects.toMatchObject({ code: "forbidden" });
    }
    const assistant = await join(w, "assistant");
    await expect(shift(w, "2026-02-03", assistant)).resolves.toMatchObject({ days: 28 });
    expect(await startOf(w)).toBe("2026-02-03");
  });

  it("refuses a date that isn't real, is far out of range, or is where week 1 already is", async () => {
    const w = await mkWorld({ teams: 2, perTeam: 2, weeks: 3 });
    for (const bad of ["2026-02-31", "tomorrow", "", "0026-01-06", "2300-01-06"]) await expect(shift(w, bad), bad).rejects.toMatchObject({ code: "validation" });
    await expect(shift(w, "2026-01-06")).rejects.toMatchObject({ code: "validation", message: expect.stringContaining("already on that date") });
    expect((await weeksOf(w)).map((x) => x.date)).toEqual(["2026-01-06", "2026-01-13", "2026-01-20"]);
    expect(await w.store.read((db) => db.audit.filter((a) => a.action === "season.dates_shifted").length)).toBe(0);
  });

  it("is invisible to people outside a private league", async () => {
    const w = await mkWorld({ teams: 2, perTeam: 2, weeks: 3 });
    const outsider = await (await import("./world")).mkUser(w.store, "outsider");
    await expect(shift(w, "2026-02-03", outsider)).rejects.toMatchObject({ code: "not_found" });
  });
});
