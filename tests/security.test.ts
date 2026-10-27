import { describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import { resolveAccess, matchupIn, requirePerm } from "@/server/access";
import { acceptInvitation, inviteMember, leaveLeague, previewInvitation, revokeInvitation, setMemberRole, setMemberStatus, transferOwnership, updateGeneral, updateVisibility } from "@/server/services/leagues";
import { correctResult, finalizeMatchup, saveEntry } from "@/server/services/results";
import { addTeam, changeTeam, generateSchedule } from "@/server/services/season";
import { applyRuleChange } from "@/server/services/rules";
import { exportBundle, exportCsv } from "@/server/services/data";
import { loginWithLockout } from "@/server/auth";
import { join, mkStore, mkUser, mkWorld, playWeek, weekMatchups } from "./world";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return "none";
};

describe("permissions", () => {
  it("viewers cannot submit scores or edit anything", () => {
    const w = mkWorld();
    const viewer = join(w, "viewer");
    const m = weekMatchups(w, 1)[0];
    expect(code(() => saveEntry(w.store, viewer, w.leagueId, { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores: [] }))).toBe("forbidden");
    expect(code(() => addTeam(w.store, viewer, w.leagueId, { name: "Sneaky" }))).toBe("forbidden");
    expect(code(() => updateGeneral(w.store, viewer, w.leagueId, { name: "Hacked", description: "", logoText: "", accent: "#000000" }))).toBe("forbidden");
    expect(code(() => exportCsv(w.store, viewer, w.leagueId, w.seasonId, "scores"))).toBe("forbidden");
    expect(code(() => exportBundle(w.store, viewer, w.leagueId))).toBe("forbidden");
  });

  it("scorekeepers enter scores but cannot finalize, change rules, or manage members", () => {
    const w = mkWorld();
    const sk = join(w, "scorekeeper");
    playWeek(w, 1, undefined, sk, false); // can enter
    const m = weekMatchups(w, 1).find((x) => x.sideB)!;
    expect(code(() => finalizeMatchup(w.store, sk, w.leagueId, m.id, m.revision))).toBe("forbidden");
    const cfg = structuredClone(w.store.read((db) => db.seasons[0].ruleVersions[0].config));
    cfg.handicap.percentage = 50;
    expect(code(() => applyRuleChange(w.store, sk, w.leagueId, { seasonId: w.seasonId, proposed: cfg, scope: { type: "from_week", week: 2 }, reason: "because" }))).toBe("forbidden");
    expect(code(() => inviteMember(w.store, sk, w.leagueId, { role: "viewer" }))).toBe("forbidden");
    expect(code(() => changeTeam(w.store, sk, w.leagueId, w.seasonId, w.bowlerIds[0][0], w.teamIds[1], 2))).toBe("forbidden");
    expect(code(() => generateSchedule(w.store, sk, w.leagueId, w.seasonId))).toBe("forbidden");
  });

  it("assistants can finalize but cannot correct finalized results or change rules", () => {
    const w = mkWorld();
    const asst = join(w, "assistant");
    playWeek(w, 1, undefined, asst);
    const m = weekMatchups(w, 1).find((x) => x.sideB)!;
    expect(m.state).toBe("finalized");
    expect(code(() => correctResult(w.store, asst, w.leagueId, { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores: [], reason: "oops", confirm: true }))).toBe("forbidden");
  });

  it("only the owner changes visibility; commissioners cannot", () => {
    const w = mkWorld();
    const com = join(w, "commissioner");
    expect(code(() => updateVisibility(w.store, com, w.leagueId, "public"))).toBe("forbidden");
    expect(code(() => updateVisibility(w.store, w.owner, w.leagueId, "public"))).toBe("none");
  });

  it("role assignment is limited by the assigner's own role", () => {
    const w = mkWorld();
    const com = join(w, "commissioner");
    const other = join(w, "commissioner", "com2");
    const bowler = join(w, "bowler");
    expect(code(() => setMemberRole(w.store, com, w.leagueId, bowler.id, "commissioner"))).toBe("forbidden"); // can't mint peers
    expect(code(() => setMemberRole(w.store, com, w.leagueId, other.id, "viewer"))).toBe("forbidden"); // can't demote peers
    expect(code(() => setMemberRole(w.store, com, w.leagueId, bowler.id, "scorekeeper"))).toBe("none");
    expect(code(() => setMemberRole(w.store, com, w.leagueId, w.owner.id, "viewer"))).toBe("forbidden");
    expect(code(() => setMemberRole(w.store, bowler, w.leagueId, bowler.id, "owner"))).toBe("forbidden");
  });

  it("revoked and deactivated members immediately lose access", () => {
    const w = mkWorld();
    const sk = join(w, "scorekeeper");
    const m = weekMatchups(w, 1)[0];
    const entry = { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores: [] as never[] };
    expect(code(() => saveEntry(w.store, sk, w.leagueId, entry))).toBe("none");
    setMemberStatus(w.store, w.owner, w.leagueId, sk.id, "deactivated");
    expect(["not_found", "forbidden"]).toContain(code(() => saveEntry(w.store, sk, w.leagueId, entry)));
    expect(w.store.read((db) => resolveAccess(db, db.leagues[0], sk).via)).toBeNull();
    // history is untouched
    expect(w.store.read((db) => db.memberships.find((x) => x.userId === sk.id)?.status)).toBe("deactivated");
  });

  it("the owner cannot abandon a league; ownership transfer needs the exact name", () => {
    const w = mkWorld({ name: "Friday Strikers" });
    const com = join(w, "commissioner");
    expect(code(() => leaveLeague(w.store, w.owner, w.leagueId))).toBe("conflict");
    expect(code(() => transferOwnership(w.store, w.owner, w.leagueId, com.id, "wrong name"))).toBe("validation");
    transferOwnership(w.store, w.owner, w.leagueId, com.id, "Friday Strikers");
    expect(w.store.read((db) => db.memberships.filter((m) => m.leagueId === w.leagueId).map((m) => [m.userId, m.role]))).toEqual(expect.arrayContaining([[com.id, "owner"], [w.owner.id, "commissioner"]]));
    expect(code(() => transferOwnership(w.store, w.owner, w.leagueId, com.id, "Friday Strikers"))).toBe("forbidden"); // no longer owner
    expect(code(() => leaveLeague(w.store, w.owner, w.leagueId))).toBe("none");
  });
});

describe("league isolation", () => {
  it("users cannot read or edit another league's records by guessing ids", () => {
    const store = mkStore();
    const a = mkWorld({ store });
    const b = mkWorld({ store });
    const mB = weekMatchups(b, 1)[0];
    // owner of A tries to use B's matchup/team/season ids through A's league
    expect(code(() => saveEntry(store, a.owner, a.leagueId, { matchupId: mB.id, expectedRevision: mB.revision, lineupA: [], lineupB: [], scores: [] }))).toBe("not_found");
    expect(code(() => finalizeMatchup(store, a.owner, a.leagueId, mB.id, mB.revision))).toBe("not_found");
    expect(code(() => changeTeam(store, a.owner, a.leagueId, b.seasonId, b.bowlerIds[0][0], b.teamIds[1], 2))).toBe("not_found");
    expect(code(() => changeTeam(store, a.owner, a.leagueId, a.seasonId, b.bowlerIds[0][0], a.teamIds[0], 2))).toBe("not_found");
    expect(code(() => changeTeam(store, a.owner, a.leagueId, a.seasonId, a.bowlerIds[0][0], b.teamIds[0], 2))).toBe("not_found");
    // and directly against B without membership
    expect(code(() => addTeam(store, a.owner, b.leagueId, { name: "Intruder" }))).toBe("not_found");
    expect(store.read((db) => matchupIn(db, a.leagueId, weekMatchups(a, 1)[0].id).season.leagueId)).toBe(a.leagueId);
    expect(code(() => store.read((db) => requirePerm(db, a.owner, b.leagueId, "scores.enter")))).toBe("not_found");
  });

  it("changing one league's rules never touches another league (even with identical data)", () => {
    const store = mkStore();
    const a = mkWorld({ store });
    const b = mkWorld({ store });
    const before = JSON.stringify(store.read((db) => [db.seasons.find((s) => s.id === b.seasonId), db.leagues.find((l) => l.id === b.leagueId)]));
    const cfg = structuredClone(store.read((db) => db.seasons.find((s) => s.id === a.seasonId)!.ruleVersions[0].config));
    cfg.handicap.percentage = 70;
    cfg.handicap.baseValue = 200;
    applyRuleChange(store, a.owner, a.leagueId, { seasonId: a.seasonId, proposed: cfg, scope: { type: "from_week", week: 1 }, reason: "Tuning" });
    expect(JSON.stringify(store.read((db) => [db.seasons.find((s) => s.id === b.seasonId), db.leagues.find((l) => l.id === b.leagueId)]))).toBe(before);
    // and A can't apply a change targeting B's season
    expect(code(() => applyRuleChange(store, a.owner, a.leagueId, { seasonId: b.seasonId, proposed: cfg, scope: { type: "from_week", week: 1 }, reason: "Nope" }))).toBe("not_found");
  });

  it("scores of identical weeks in two leagues stay independent", () => {
    const store = mkStore();
    const a = mkWorld({ store });
    const b = mkWorld({ store });
    playWeek(a, 1);
    const bScores = store.read((db) => db.scores.filter((s) => weekMatchups(b, 1).some((m) => m.id === s.matchupId)).length);
    expect(bScores).toBe(0);
  });
});

describe("visibility", () => {
  it("private leagues are members-only; unlisted needs the link token; public is open", () => {
    const store = mkStore();
    const w = mkWorld({ store, visibility: "private" });
    const stranger = mkUser(store);
    const getLeague = () => store.read((db) => db.leagues.find((l) => l.id === w.leagueId)!);
    const via = (actor: typeof stranger | null, token?: string) => store.read((db) => resolveAccess(db, getLeague(), actor, token).via);
    expect(via(stranger)).toBeNull();
    expect(via(null)).toBeNull();
    expect(via(w.owner)).toBe("member");
    updateVisibility(store, w.owner, w.leagueId, "unlisted");
    const token = getLeague().shareToken;
    expect(via(null)).toBeNull();
    expect(via(null, "wrong")).toBeNull();
    expect(via(null, token)).toBe("link");
    updateVisibility(store, w.owner, w.leagueId, "public");
    expect(via(null)).toBe("public");
    // changing visibility rotates the share token so old private links die
    updateVisibility(store, w.owner, w.leagueId, "unlisted");
    expect(getLeague().shareToken).not.toBe(token);
    expect(via(null, token)).toBeNull();
  });

  it("a non-member cannot even confirm that a private league exists", () => {
    const w = mkWorld({ visibility: "private" });
    const stranger = mkUser(w.store);
    expect(code(() => w.store.read((db) => requirePerm(db, stranger, w.leagueId, "scores.enter")))).toBe("not_found");
  });
});

describe("invitations", () => {
  it("are single-use, expiring, revocable and email-bound", () => {
    const w = mkWorld();
    const u1 = mkUser(w.store);
    const u2 = mkUser(w.store);
    const { token, invitationId } = inviteMember(w.store, w.owner, w.leagueId, { role: "viewer" });
    expect(previewInvitation(w.store, token)?.state).toBe("valid");
    acceptInvitation(w.store, u1, token);
    expect(code(() => acceptInvitation(w.store, u2, token))).toBe("validation");
    expect(previewInvitation(w.store, token)?.state).toBe("used");

    const t2 = inviteMember(w.store, w.owner, w.leagueId, { role: "viewer" });
    revokeInvitation(w.store, w.owner, w.leagueId, t2.invitationId);
    expect(code(() => acceptInvitation(w.store, u2, t2.token))).toBe("validation");

    const bound = inviteMember(w.store, w.owner, w.leagueId, { role: "viewer", email: "someone-else@example.com" });
    expect(code(() => acceptInvitation(w.store, u2, bound.token))).toBe("forbidden");

    const t3 = inviteMember(w.store, w.owner, w.leagueId, { role: "viewer" });
    w.store.transaction((db) => { db.invitations.find((i) => i.id === t3.invitationId)!.expiresAt = new Date(Date.now() - 1000).toISOString(); });
    expect(code(() => acceptInvitation(w.store, u2, t3.token))).toBe("validation");
    expect(invitationId).toBeTruthy();
  });

  it("assistants can only invite bowlers and viewers", () => {
    const w = mkWorld();
    const asst = join(w, "assistant");
    expect(code(() => inviteMember(w.store, asst, w.leagueId, { role: "viewer" }))).toBe("none");
    expect(code(() => inviteMember(w.store, asst, w.leagueId, { role: "commissioner" }))).toBe("forbidden");
    expect(code(() => inviteMember(w.store, asst, w.leagueId, { role: "owner" }))).toBe("forbidden");
  });
});

describe("accounts", () => {
  it("locks out repeated bad passwords and never leaks which half was wrong", () => {
    const store = mkStore();
    const u = mkUser(store, "locky");
    for (let i = 0; i < 6; i++) expect(code(() => loginWithLockout(store, u.email, "wrong-password"))).toBe("unauthenticated");
    expect(code(() => loginWithLockout(store, u.email, "correct-horse-battery"))).toBe("rate_limited");
    expect(code(() => loginWithLockout(store, "nobody@example.com", "whatever12"))).toBe("unauthenticated");
  });
});
