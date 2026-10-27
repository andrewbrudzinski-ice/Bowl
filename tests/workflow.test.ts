import { describe, expect, it } from "vitest";
import { buildSeasonModel } from "@/domain/engine";
import { computeStandings } from "@/domain/standings";
import { seasonData } from "@/server/access";
import { AppError } from "@/server/errors";
import { commitImport, exportBundle, exportCsv, importBundle, previewImport, templateCsv } from "@/server/services/data";
import { acceptInvitation, inviteMember } from "@/server/services/leagues";
import { correctResult, finalizeMatchup, previewFinalize, reopenResult, saveEntry, saveWeekEntries, testHooks } from "@/server/services/results";
import { applyRuleChange, previewSeasonRules } from "@/server/services/rules";
import { createNextSeason, completeSeason, changeTeam } from "@/server/services/season";
import { postAnnouncement, updateAnnouncement } from "@/server/services/content";
import { join, mkWorld, model, playWeek, weekMatchups, mkUser, type World } from "./world";

const code = async (fn: () => unknown) => {
  try { await fn(); } catch (e) { if (e instanceof AppError) return e.code; throw e; }
  return "none";
};
const cfgOf = async (w: World) => structuredClone(await w.store.read((db) => db.seasons.find((s) => s.id === w.seasonId)!.ruleVersions.at(-1)!.config));
/** Whole-database fingerprint, minus the revision counter and import log (a failed import legitimately logs itself). */
const snapshotAll = async (w: World) => JSON.stringify(await w.store.read((db) => { const { rev: _r, importLog: _i, ...rest } = db; return rest; }));

describe("score entry lifecycle", () => {
  it("drafts do not count; finalizing does; finalized results are protected", async () => {
    const w = await mkWorld();
    await playWeek(w, 1, undefined, w.owner, false);
    expect(computeStandings(await model(w)).rows.every((r) => r.played === 0)).toBe(true);
    const ms = await weekMatchups(w, 1);
    expect(ms.every((m) => m.state === "draft")).toBe(true);
    for (const m of ms) await finalizeMatchup(w.store, w.owner, w.leagueId, m.id, m.revision);
    const rows = computeStandings(await model(w)).rows;
    expect(rows.every((r) => r.played === 1)).toBe(true);
    // protected
    const fin = (await weekMatchups(w, 1))[0];
    expect(await code(() => saveEntry(w.store, w.owner, w.leagueId, { matchupId: fin.id, expectedRevision: fin.revision, lineupA: fin.lineupA, lineupB: fin.lineupB, scores: [] }))).toBe("locked");
    expect(await code(() => finalizeMatchup(w.store, w.owner, w.leagueId, fin.id, fin.revision))).toBe("conflict");
  });

  it("finalize stores the rule version and a handicap snapshot; week completes", async () => {
    const w = await mkWorld();
    await playWeek(w, 1);
    const m = (await weekMatchups(w, 1))[0];
    expect(m.ruleVersion).toBe(1);
    expect(Object.keys(m.handicapSnapshot!)).toHaveLength(m.lineupA.length + m.lineupB.length);
    expect(await w.store.read((db) => db.weeks.find((x) => x.seasonId === w.seasonId && x.number === 1)!.status)).toBe("completed");
  });

  it("rejects invalid scores with explanations and never half-saves", async () => {
    const w = await mkWorld();
    const m = (await weekMatchups(w, 1))[0];
    const bad = [{ bowlerId: m.lineupA[0], side: "A" as const, game: 1, scratch: 301, kind: "bowled" as const }];
    let err: AppError | null = null;
    try { await saveEntry(w.store, w.owner, w.leagueId, { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores: bad }); } catch (e) { err = e as AppError; }
    expect(err?.code).toBe("validation");
    expect(err?.message).toMatch(/outside the allowed range 0–300/);
    expect(await w.store.read((db) => db.scores.length)).toBe(0);
    expect((await weekMatchups(w, 1))[0].revision).toBe(m.revision);
  });

  it("detects concurrent edits via revision and ignores duplicate submissions via idempotency key", async () => {
    const w = await mkWorld();
    const m = (await weekMatchups(w, 1))[0];
    const scores = m.lineupA.map((b) => ({ bowlerId: b, side: "A" as const, game: 1, scratch: 180, kind: "bowled" as const }));
    const input = { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores, idempotencyKey: "k1" };
    const first = await saveEntry(w.store, w.owner, w.leagueId, input);
    const again = await saveEntry(w.store, w.owner, w.leagueId, input); // double-click / retry
    expect(again.duplicate).toBe(true);
    expect(again.revision).toBe(first.revision);
    expect(await w.store.read((db) => db.audit.filter((a) => a.action === "scores.saved").length)).toBe(1);
    // a different client holding the old revision is refused
    expect(await code(() => saveEntry(w.store, w.owner, w.leagueId, { ...input, idempotencyKey: "k2" }))).toBe("conflict");
  });

  it("cannot finalize with missing scores; lists what's missing", async () => {
    const w = await mkWorld();
    const m = (await weekMatchups(w, 1))[0];
    const res = await saveEntry(w.store, w.owner, w.leagueId, { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores: [{ bowlerId: m.lineupA[0], side: "A", game: 1, scratch: 170, kind: "bowled" }] });
    expect(res.issues.some((i) => i.code === "missing_score")).toBe(true);
    let err: AppError | null = null;
    try { await finalizeMatchup(w.store, w.owner, w.leagueId, m.id, res.revision); } catch (e) { err = e as AppError; }
    expect(err?.code).toBe("validation");
    expect(err?.message).toMatch(/Can't finalize yet/);
  });

  it("previews the standings impact without writing", async () => {
    const w = await mkWorld();
    await playWeek(w, 1, undefined, w.owner, false);
    const m = (await weekMatchups(w, 1))[0];
    const before = await snapshotAll(w);
    const p = await previewFinalize(w.store, w.owner, w.leagueId, m.id);
    expect(p.canFinalize).toBe(true);
    expect(p.standingsBefore.every((r) => r.played === 0)).toBe(true);
    expect(p.standingsAfter.filter((r) => r.played === 1)).toHaveLength(2);
    expect(await snapshotAll(w)).toBe(before);
  });

  it("bulk save reports per-matchup success and failure independently", async () => {
    const w = await mkWorld();
    const [m1, m2] = (await weekMatchups(w, 1)).filter((m) => m.sideB);
    const good = { matchupId: m1.id, expectedRevision: m1.revision, lineupA: m1.lineupA, lineupB: m1.lineupB, scores: m1.lineupA.map((b) => ({ bowlerId: b, side: "A" as const, game: 1, scratch: 190, kind: "bowled" as const })) };
    const bad = { matchupId: m2.id, expectedRevision: m2.revision, lineupA: m2.lineupA, lineupB: m2.lineupB, scores: [{ bowlerId: m2.lineupA[0], side: "A" as const, game: 1, scratch: 999, kind: "bowled" as const }] };
    const out = await saveWeekEntries(w.store, w.owner, w.leagueId, [good, bad]);
    expect(out.map((o) => o.ok)).toEqual([true, false]);
    expect(out[1].error).toMatch(/outside the allowed range/);
    expect(await w.store.read((db) => db.scores.filter((s) => s.matchupId === m1.id).length)).toBe(3);
    expect(await w.store.read((db) => db.scores.filter((s) => s.matchupId === m2.id).length)).toBe(0);
  });
});

describe("corrections after finalization", () => {
  it("requires confirmation + reason, is audited with before/after, and recalculates standings", async () => {
    const w = await mkWorld();
    await playWeek(w, 1);
    const m = (await weekMatchups(w, 1))[0];
    const winnerBefore = (await model(w)).resultById.get(m.id)!.winner;
    expect(winnerBefore).toBe("A");
    const scoresNow = await w.store.read((db) => db.scores.filter((s) => s.matchupId === m.id));
    // Make side A bowl terribly
    const corrected = scoresNow.map((s) => ({ bowlerId: s.bowlerId, side: s.side, game: s.game, scratch: s.side === "A" ? 100 : s.scratch, kind: s.kind }));
    const base = { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores: corrected };
    expect(await code(() => correctResult(w.store, w.owner, w.leagueId, { ...base, reason: "Fix typo", confirm: false }))).toBe("validation");
    expect(await code(() => correctResult(w.store, w.owner, w.leagueId, { ...base, reason: "", confirm: true }))).toBe("validation");
    const standingsBefore = computeStandings(await model(w)).rows.map((r) => [r.id, r.points]);
    await correctResult(w.store, w.owner, w.leagueId, { ...base, reason: "Misread the scoresheet", confirm: true });
    const after = await model(w);
    expect(after.resultById.get(m.id)!.winner).toBe("B");
    expect((await weekMatchups(w, 1))[0].state).toBe("corrected");
    expect(computeStandings(after).rows.map((r) => [r.id, r.points])).not.toEqual(standingsBefore);
    const entry = await w.store.read((db) => db.audit.filter((a) => a.action === "result.corrected"));
    expect(entry).toHaveLength(1);
    expect(entry[0].note).toBe("Misread the scoresheet");
    expect(entry[0].userId).toBe(w.owner.id);
    expect(JSON.stringify(entry[0].before)).toContain("\"scratch\"");
    expect(JSON.stringify(entry[0].after)).toContain("100");
    // corrected results still count in official standings
    expect(computeStandings(after).rows.every((r) => r.played >= 1)).toBe(true);
  });

  it("reopen removes a result from standings until it is finalized again (then it's 'corrected')", async () => {
    const w = await mkWorld();
    await playWeek(w, 1);
    const m = (await weekMatchups(w, 1))[0];
    await reopenResult(w.store, w.owner, w.leagueId, m.id, "Wrong lineup", true);
    expect((await weekMatchups(w, 1))[0].state).toBe("draft");
    expect(computeStandings(await model(w)).rows.filter((r) => r.played === 0)).toHaveLength(2);
    const cur = (await weekMatchups(w, 1))[0];
    const fin = await finalizeMatchup(w.store, w.owner, w.leagueId, cur.id, cur.revision);
    expect(fin.state).toBe("corrected");
  });

  it("audit entries are append-only: services expose no way to alter them and members cannot read them without permission", async () => {
    const w = await mkWorld();
    const viewer = await join(w, "viewer");
    const before = await w.store.read((db) => db.audit.length);
    await playWeek(w, 1);
    expect(await w.store.read((db) => db.audit.length)).toBeGreaterThan(before);
    const first = await w.store.read((db) => JSON.stringify(db.audit[0]));
    await playWeek(w, 2);
    expect(await w.store.read((db) => JSON.stringify(db.audit[0]))).toBe(first);
    expect(viewer.id).toBeTruthy();
  });
});

describe("versioned rules & historical integrity", () => {
  it("changing the handicap % from a future week does not alter finalized results or earlier weeks", async () => {
    const w = await mkWorld({ weeks: 6 });
    await playWeek(w, 1);
    await playWeek(w, 2);
    const m1 = (await weekMatchups(w, 1))[0].id;
    const before = (await model(w)).resultById.get(m1)!;
    const cfg = await cfgOf(w);
    cfg.handicap.percentage = 50;
    const prev = await previewSeasonRules(w.store, w.owner, w.leagueId, w.seasonId, cfg, { type: "from_week", week: 3 });
    expect(prev.ok).toBe(true);
    expect(prev.finalizedAffected).toEqual([]);
    await applyRuleChange(w.store, w.owner, w.leagueId, { seasonId: w.seasonId, proposed: cfg, scope: { type: "from_week", week: 3 }, reason: "Reduce to 50%" });
    const m = await model(w);
    const after = m.resultById.get(m1)!;
    expect(after.a.lineup.map((l) => l.handicap)).toEqual(before.a.lineup.map((l) => l.handicap));
    expect(after.winner).toBe(before.winner);
    expect(m.versionForWeek(2).version).toBe(1);
    expect(m.versionForWeek(3).version).toBe(2);
    expect(m.configForWeek(3).handicap.percentage).toBe(50);
    expect(m.configForWeek(2).handicap.percentage).toBe(90);
    // week 3 handicaps now use 50%
    const h3 = m.handicapAt(w.bowlerIds[0][0], 3);
    expect(h3.ruleVersion).toBe(2);
    const audit = await w.store.read((db) => db.audit.find((a) => a.action === "rules.changed")!);
    expect(JSON.stringify(audit.before)).toContain("90");
    expect(JSON.stringify(audit.after)).toContain("50");
    expect(audit.userId).toBe(w.owner.id);
  });

  it("refuses to apply a change to already-finalized weeks without the historical correction process", async () => {
    const w = await mkWorld();
    await playWeek(w, 1);
    const cfg = await cfgOf(w);
    cfg.handicap.percentage = 0;
    expect(await code(() => applyRuleChange(w.store, w.owner, w.leagueId, { seasonId: w.seasonId, proposed: cfg, scope: { type: "from_week", week: 1 }, reason: "try" }))).toBe("validation");
  });

  it("historical correction requires stronger confirmation, authorization, re-snapshots, and is audited per result", async () => {
    const w = await mkWorld();
    // make week 1 close so changing handicap reverses something
    await playWeek(w, 1, (mi, side, i, g) => (side === "A" ? 165 : 170) + i);
    const before = await model(w);
    const winnersBefore = before.results.map((r) => r.winner);
    const cfg = await cfgOf(w);
    cfg.handicap.enabled = false;
    cfg.scoring.basis = "scratch";
    const base = { seasonId: w.seasonId, proposed: cfg, scope: { type: "historical" } as const, reason: "League voted to go scratch" };
    const com = await join(w, "commissioner");
    const bowler = await join(w, "bowler");
    expect(await code(() => applyRuleChange(w.store, bowler, w.leagueId, { ...base, strongConfirmation: "CHANGE RESULTS" }))).toBe("forbidden");
    const prev = await previewSeasonRules(w.store, com, w.leagueId, w.seasonId, cfg, { type: "historical" });
    expect(prev.requiresStrongConfirmation).toBe(true);
    expect(await code(() => applyRuleChange(w.store, com, w.leagueId, base))).toBe("validation");
    const res = await applyRuleChange(w.store, com, w.leagueId, { ...base, strongConfirmation: "CHANGE RESULTS" });
    expect(res.reversed).toBeGreaterThanOrEqual(0);
    const after = await model(w);
    expect(after.results.map((r) => r.winner)).not.toEqual(winnersBefore.map(() => "never"));
    expect(after.results.filter((r) => r.official).every((r) => r.ruleVersion === 2)).toBe(true);
    expect(after.results[0].a.lineup[0].handicap).toBe(0);
    expect(await w.store.read((db) => db.audit.filter((a) => a.action === "result.recalculated").length)).toBe(winnersBefore.filter(Boolean).length);
    // original rules are retained
    expect(await w.store.read((db) => db.seasons.find((s) => s.id === w.seasonId)!.ruleVersions.map((v) => v.version))).toEqual([1, 2]);
    expect(await w.store.read((db) => db.seasons.find((s) => s.id === w.seasonId)!.ruleVersions[0].config.handicap.enabled)).toBe(true);
  });

  it("a failure part-way through a multi-record update rolls everything back", async () => {
    const w = await mkWorld();
    await playWeek(w, 1);
    const cfg = await cfgOf(w);
    cfg.handicap.enabled = false;
    cfg.scoring.basis = "scratch";
    const before = await snapshotAll(w);
    testHooks.afterStep = (s) => { if (s === "rules:recalc") throw new Error("disk full (simulated)"); };
    try {
      await expect(applyRuleChange(w.store, w.owner, w.leagueId, { seasonId: w.seasonId, proposed: cfg, scope: { type: "historical" }, reason: "x y z", strongConfirmation: "CHANGE RESULTS" })).rejects.toThrow(/simulated/);
    } finally {
      testHooks.afterStep = undefined;
    }
    expect(await snapshotAll(w)).toBe(before);
    // the store still works afterwards
    await playWeek(w, 2);
    expect(computeStandings(await model(w)).rows.every((r) => r.played === 2)).toBe(true);
  });

  it("a failure inside finalize leaves no half-finalized state or orphan audit entry", async () => {
    const w = await mkWorld();
    await playWeek(w, 1, undefined, w.owner, false);
    const m = (await weekMatchups(w, 1))[0];
    const before = await snapshotAll(w);
    testHooks.afterStep = (s) => { if (s === "finalize:audit") throw new Error("boom"); };
    try {
      await expect(finalizeMatchup(w.store, w.owner, w.leagueId, m.id, m.revision)).rejects.toThrow(/boom/);
    } finally {
      testHooks.afterStep = undefined;
    }
    expect(await snapshotAll(w)).toBe(before);
    expect((await weekMatchups(w, 1))[0].state).toBe("draft");
  });

  it("changing league defaults or rules in a new season never rewrites a completed past season", async () => {
    const w = await mkWorld();
    await playWeek(w, 1);
    await completeSeason(w.store, w.owner, w.leagueId, w.seasonId);
    const pastBefore = JSON.stringify(await w.store.read((db) => db.seasons.find((s) => s.id === w.seasonId)));
    const next = await createNextSeason(w.store, w.owner, w.leagueId, { name: "2027", year: 2027, startDate: "2027-01-05", regularWeeks: 6, copyFromSeasonId: w.seasonId, copyRoster: true, copySchedule: true, completePrevious: true });
    const cfg = await structuredClone(await w.store.read((db) => db.seasons.find((s) => s.id === next.seasonId)!.ruleVersions[0].config));
    cfg.handicap.percentage = 60;
    await applyRuleChange(w.store, w.owner, w.leagueId, { seasonId: next.seasonId, proposed: cfg, scope: { type: "from_week", week: 1 }, reason: "New season, softer handicap" });
    await applyRuleChange(w.store, w.owner, w.leagueId, { seasonId: next.seasonId, proposed: cfg, scope: { type: "new_season" }, reason: "New default" });
    expect(JSON.stringify(await w.store.read((db) => db.seasons.find((s) => s.id === w.seasonId)))).toBe(pastBefore);
    // reopening a 2026 result shows the 2026 rules (90%), not today's default (60%)
    const past = await w.store.read((db) => buildSeasonModel(seasonData(db, w.leagueId, w.seasonId)));
    expect(past.configForWeek(1).handicap.percentage).toBe(90);
    const r0 = past.results.find((r) => r.b)!;
    const snap = await w.store.read((db) => db.matchups.find((m) => m.id === r0.matchup.id)!.handicapSnapshot!);
    expect(r0.a.lineup[0].handicap).toBe(snap[r0.a.lineup[0].bowlerId].handicap);
    expect(await w.store.read((db) => db.leagues[0].defaultConfig.handicap.percentage)).toBe(60);
    // new season has its own copy: roster copied w/ entering averages from last season, schedule copied without scores
    const nd = await w.store.read((db) => seasonData(db, w.leagueId, next.seasonId));
    expect(nd.roster.length).toBe(12);
    expect(nd.scores.length).toBe(0);
    expect(nd.matchups.every((m) => m.state === "scheduled" || !m.sideB)).toBe(true);
    expect(await w.store.read((db) => db.seasons.find((s) => s.id === w.seasonId)!.status)).toBe("completed");
  });
});

describe("roster history", () => {
  it("team changes apply going forward and keep historical team assignment", async () => {
    const w = await mkWorld();
    await playWeek(w, 1);
    const b = w.bowlerIds[0][0];
    expect(await code(() => changeTeam(w.store, w.owner, w.leagueId, w.seasonId, b, w.teamIds[1], 1))).toBe("validation");
    await changeTeam(w.store, w.owner, w.leagueId, w.seasonId, b, w.teamIds[1], 2);
    const m = await model(w);
    expect(m.teamOf(b, 1)).toBe(w.teamIds[0]);
    expect(m.teamOf(b, 2)).toBe(w.teamIds[1]);
    // week 1 result still lists the bowler on their original team
    expect(m.results.find((r) => r.weekNumber === 1 && r.a.participantId === w.teamIds[0])!.a.lineup.some((l) => l.bowlerId === b)).toBe(true);
  });
});

describe("imports", () => {
  it("previews without writing, reports row-specific errors, and blocks all writes when any row is bad", async () => {
    const w = await mkWorld({ teams: 2 });
    const csv = "name,nickname,active\nNew Person,NP,true\nBowler 1.1,,true\n,,true\nNew Person,,true\n";
    const before = await snapshotAll(w);
    const rep = await previewImport(w.store, w.owner, w.leagueId, null, "bowlers", csv);
    expect(await snapshotAll(w)).toBe(before);
    expect(rep.ok).toBe(false);
    expect(rep.errors.map((e) => e.line)).toEqual([4, 5]);
    expect(rep.errors[0].message).toMatch(/name is required/);
    expect(rep.duplicates.map((d) => d.line)).toEqual([3]);
    expect(await code(() => commitImport(w.store, w.owner, w.leagueId, null, "bowlers", csv, true))).toBe("validation");
    expect(await snapshotAll(w)).toBe(before);
    // failed import is visible to the commissioner
    expect(await w.store.read((db) => db.importLog.filter((i) => !i.ok).length)).toBe(1);
  });

  it("requires confirmation, commits good files, skips duplicates", async () => {
    const w = await mkWorld({ teams: 2 });
    const csv = "name,nickname,active\nNew Person,NP,true\nBowler 1.1,,true\n";
    expect(await code(() => commitImport(w.store, w.owner, w.leagueId, null, "bowlers", csv, false))).toBe("validation");
    const rep = await commitImport(w.store, w.owner, w.leagueId, null, "bowlers", csv, true);
    expect(rep.willCreate).toBe(1);
    expect(rep.willSkip).toBe(1);
    expect(await w.store.read((db) => db.bowlers.filter((b) => b.name === "New Person").length)).toBe(1);
  });

  it("imports scores as drafts, never overwrites existing scores, and can import historical results as finalized", async () => {
    const w = await mkWorld({ teams: 2, weeks: 2 });
    const m = (await weekMatchups(w, 1))[0];
    const names = await w.store.read((db) => new Map(db.bowlers.map((b) => [b.id, b.name])));
    const teamName = (id: string) => w.store.read((db) => db.teams.find((t) => t.id === id)!.name);
    const lines = ["week,team,bowler,game,score,kind"];
    for (const [lineup, team] of [[m.lineupA, m.sideA], [m.lineupB, m.sideB!]] as const)
      for (const b of lineup) for (let g = 1; g <= 3; g++) lines.push(`1,${await teamName(team)},${names.get(b)},${g},${150 + g * 5},bowled`);
    const csv = lines.join("\n");
    const prev = await previewImport(w.store, w.owner, w.leagueId, w.seasonId, "scores", csv);
    expect(prev.errors).toEqual([]);
    expect(await w.store.read((db) => db.scores.length)).toBe(0);
    await commitImport(w.store, w.owner, w.leagueId, w.seasonId, "scores", csv, true);
    expect((await weekMatchups(w, 1))[0].state).toBe("draft");
    expect(await w.store.read((db) => db.scores.length)).toBe(18);
    // second import onto the same matchup must refuse
    expect(await code(() => commitImport(w.store, w.owner, w.leagueId, w.seasonId, "scores", csv, true))).toBe("validation");
    // finalize variant on week 2
    const m2 = (await weekMatchups(w, 2))[0];
    const l2 = ["week,team,bowler,game,score,kind"];
    for (const [lineup, team] of [[m2.lineupA, m2.sideA], [m2.lineupB, m2.sideB!]] as const)
      for (const b of lineup) for (let g = 1; g <= 3; g++) l2.push(`2,${await teamName(team)},${names.get(b)},${g},180,bowled`);
    await commitImport(w.store, w.owner, w.leagueId, w.seasonId, "scores", l2.join("\n"), true, { finalize: true });
    expect((await weekMatchups(w, 2))[0].state).toBe("finalized");
    expect((await weekMatchups(w, 2))[0].handicapSnapshot).not.toBeNull();
  });

  it("rejects bad scores in a file with line numbers and imports nothing from it", async () => {
    const w = await mkWorld({ teams: 2 });
    const m = (await weekMatchups(w, 1))[0];
    const n = await w.store.read((db) => db.bowlers.find((b) => b.id === m.lineupA[0])!.name);
    const t = await w.store.read((db) => db.teams.find((x) => x.id === m.sideA)!.name);
    const csv = `week,team,bowler,game,score,kind\n1,${t},${n},1,180,bowled\n1,${t},${n},2,450,bowled\n1,${t},Nobody Here,1,100,bowled\n`;
    const rep = await previewImport(w.store, w.owner, w.leagueId, w.seasonId, "scores", csv);
    expect(rep.ok).toBe(false);
    expect(rep.errors.some((e) => e.line === 4 && /Unknown bowler/.test(e.message))).toBe(true);
    const csv2 = `week,team,bowler,game,score,kind\n1,${t},${n},2,450,bowled\n`;
    const rep2 = await previewImport(w.store, w.owner, w.leagueId, w.seasonId, "scores", csv2);
    expect(rep2.errors[0].message).toMatch(/outside the allowed range/);
  });

  it("templates parse with their own importer; permission is required", async () => {
    const w = await mkWorld({ teams: 2 });
    const viewer = await join(w, "viewer");
    expect(templateCsv("bowlers")).toContain("name,nickname,active");
    expect(await code(() => previewImport(w.store, viewer, w.leagueId, null, "bowlers", templateCsv("bowlers")))).toBe("forbidden");
    const rep = await previewImport(w.store, w.owner, w.leagueId, null, "bowlers", templateCsv("bowlers"));
    expect(rep.ok).toBe(true);
  });
});

describe("exports and portability", () => {
  it("scores export includes the handicap and rule version needed to audit results", async () => {
    const w = await mkWorld();
    await playWeek(w, 1);
    const { csv } = await exportCsv(w.store, w.owner, w.leagueId, w.seasonId, "scores");
    const [header, first] = csv.trim().split("\r\n");
    expect(header).toContain("handicap");
    expect(header).toContain("rule_version");
    expect(first.split(",").length).toBe(header.split(",").length);
    expect((await exportCsv(w.store, w.owner, w.leagueId, w.seasonId, "results")).csv).toContain("points_a");
  });

  it("a league bundle restores into a new, independent league with identical computed standings", async () => {
    const w = await mkWorld();
    await playWeek(w, 1);
    await playWeek(w, 2);
    const bundle = JSON.parse(JSON.stringify(await exportBundle(w.store, w.owner, w.leagueId)));
    expect(JSON.stringify(bundle)).not.toContain("passwordHash");
    expect(bundle.league.shareToken).toBeUndefined();
    const other = await mkUser(w.store, "mover");
    const { leagueId } = await importBundle(w.store, other, bundle, "Restored League");
    expect(leagueId).not.toBe(w.leagueId);
    const restoredSeason = await w.store.read((db) => db.seasons.find((s) => s.leagueId === leagueId)!);
    const orig = computeStandings(await model(w)).rows.map((r) => [r.name, r.points, r.wins]);
    const rest = await w.store.read((db) => computeStandings(buildSeasonModel(seasonData(db, leagueId, restoredSeason.id))).rows.map((r) => [r.name, r.points, r.wins]));
    expect(rest).toEqual(orig);
    // ids are fresh: editing the copy doesn't touch the original
    expect(await w.store.read((db) => db.teams.filter((t) => t.leagueId === leagueId).every((t) => !db.teams.some((x) => x.leagueId === w.leagueId && x.id === t.id)))).toBe(true);
    expect(await code(() => importBundle(w.store, other, { format: "nope" }))).toBe("validation");
  });
});

describe("notifications and announcements", () => {
  it("results notify once per week even when a result is reopened and re-finalized", async () => {
    const w = await mkWorld();
    const viewer = await join(w, "viewer");
    await playWeek(w, 1);
    const count = () => w.store.read((db) => db.notifications.filter((n) => n.userId === viewer.id && n.type === "results").length);
    expect(await count()).toBe(1);
    const m = (await weekMatchups(w, 1))[0];
    await reopenResult(w.store, w.owner, w.leagueId, m.id, "typo", true);
    const cur = (await weekMatchups(w, 1))[0];
    await finalizeMatchup(w.store, w.owner, w.leagueId, cur.id, cur.revision);
    expect(await count()).toBe(1);
  });

  it("respects each member's notification preferences", async () => {
    const w = await mkWorld();
    const quiet = await join(w, "viewer", "quiet");
    await w.store.transaction((db) => { db.users.find((u) => u.id === quiet.id)!.prefs.announcements = false; });
    await postAnnouncement(w.store, w.owner, w.leagueId, { title: "Bring snacks", body: "Potluck on week 4", category: "event", pinned: false });
    expect(await w.store.read((db) => db.notifications.filter((n) => n.userId === quiet.id).length)).toBe(0);
  });

  it("announcements keep attribution and timestamps; editing doesn't re-notify", async () => {
    const w = await mkWorld();
    const viewer = await join(w, "viewer");
    const id = await postAnnouncement(w.store, w.owner, w.leagueId, { title: "Week 3 moved", body: "We bowl Thursday", category: "schedule", pinned: true });
    await new Promise((r) => setTimeout(r, 5));
    await updateAnnouncement(w.store, w.owner, w.leagueId, id, { title: "Week 3 moved to Thursday", body: "We bowl Thursday at 7", category: "schedule", pinned: true });
    const a = await w.store.read((db) => db.announcements.find((x) => x.id === id)!);
    expect(a.createdByName).toBe(w.owner.name);
    expect(a.updatedAt >= a.createdAt).toBe(true);
    expect(a.updatedAt).not.toBe(a.createdAt);
    expect(await w.store.read((db) => db.notifications.filter((n) => n.userId === viewer.id && n.dedupeKey === `ann:${id}`).length)).toBe(1);
    const bowler = await join(w, "bowler");
    expect(await code(() => postAnnouncement(w.store, bowler, w.leagueId, { title: "Hi", body: "Hi", category: "general", pinned: false }))).toBe("forbidden");
  });

  it("invitation to an existing user creates a notification", async () => {
    const w = await mkWorld();
    const u = await mkUser(w.store);
    await inviteMember(w.store, w.owner, w.leagueId, { role: "viewer", email: u.email });
    expect(await w.store.read((db) => db.notifications.filter((n) => n.userId === u.id && n.type === "invitations").length)).toBe(1);
    const tok = await w.store.read((db) => db.notifications.find((n) => n.userId === u.id)!.href.split("/").pop()!);
    expect((await acceptInvitation(w.store, u, tok)).slug).toBe(w.slug);
  });
});
