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

const code = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return "none";
};

describe("permissions", () => {
  it("viewers cannot submit scores or edit anything", async () => {
    const w = await mkWorld();
    const viewer = await join(w, "viewer");
    const m = (await weekMatchups(w, 1))[0];
    expect(await code(() => saveEntry(w.store, viewer, w.leagueId, { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores: [] }))).toBe("forbidden");
    expect(await code(() => addTeam(w.store, viewer, w.leagueId, { name: "Sneaky" }))).toBe("forbidden");
    expect(await code(() => updateGeneral(w.store, viewer, w.leagueId, { name: "Hacked", description: "", logoText: "", accent: "#000000" }))).toBe("forbidden");
    expect(await code(() => exportCsv(w.store, viewer, w.leagueId, w.seasonId, "scores"))).toBe("forbidden");
    expect(await code(() => exportBundle(w.store, viewer, w.leagueId))).toBe("forbidden");
  });

  it("scorekeepers enter scores but cannot finalize, change rules, or manage members", async () => {
    const w = await mkWorld();
    const sk = await join(w, "scorekeeper");
    await playWeek(w, 1, undefined, sk, false); // can enter
    const m = (await weekMatchups(w, 1)).find((x) => x.sideB)!;
    expect(await code(() => finalizeMatchup(w.store, sk, w.leagueId, m.id, m.revision))).toBe("forbidden");
    const cfg = await structuredClone(await w.store.read((db) => db.seasons[0].ruleVersions[0].config));
    cfg.handicap.percentage = 50;
    expect(await code(() => applyRuleChange(w.store, sk, w.leagueId, { seasonId: w.seasonId, proposed: cfg, scope: { type: "from_week", week: 2 }, reason: "because" }))).toBe("forbidden");
    expect(await code(() => inviteMember(w.store, sk, w.leagueId, { role: "viewer" }))).toBe("forbidden");
    expect(await code(() => changeTeam(w.store, sk, w.leagueId, w.seasonId, w.bowlerIds[0][0], w.teamIds[1], 2))).toBe("forbidden");
    expect(await code(() => generateSchedule(w.store, sk, w.leagueId, w.seasonId))).toBe("forbidden");
  });

  it("assistants can finalize but cannot correct finalized results or change rules", async () => {
    const w = await mkWorld();
    const asst = await join(w, "assistant");
    await playWeek(w, 1, undefined, asst);
    const m = (await weekMatchups(w, 1)).find((x) => x.sideB)!;
    expect(m.state).toBe("finalized");
    expect(await code(() => correctResult(w.store, asst, w.leagueId, { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores: [], reason: "oops", confirm: true }))).toBe("forbidden");
  });

  it("only the owner changes visibility; commissioners cannot", async () => {
    const w = await mkWorld();
    const com = await join(w, "commissioner");
    expect(await code(() => updateVisibility(w.store, com, w.leagueId, "public"))).toBe("forbidden");
    expect(await code(() => updateVisibility(w.store, w.owner, w.leagueId, "public"))).toBe("none");
  });

  it("role assignment is limited by the assigner's own role", async () => {
    const w = await mkWorld();
    const com = await join(w, "commissioner");
    const other = await join(w, "commissioner", "com2");
    const bowler = await join(w, "bowler");
    expect(await code(() => setMemberRole(w.store, com, w.leagueId, bowler.id, "commissioner"))).toBe("forbidden"); // can't mint peers
    expect(await code(() => setMemberRole(w.store, com, w.leagueId, other.id, "viewer"))).toBe("forbidden"); // can't demote peers
    expect(await code(() => setMemberRole(w.store, com, w.leagueId, bowler.id, "scorekeeper"))).toBe("none");
    expect(await code(() => setMemberRole(w.store, com, w.leagueId, w.owner.id, "viewer"))).toBe("forbidden");
    expect(await code(() => setMemberRole(w.store, bowler, w.leagueId, bowler.id, "owner"))).toBe("forbidden");
  });

  it("revoked and deactivated members immediately lose access", async () => {
    const w = await mkWorld();
    const sk = await join(w, "scorekeeper");
    const m = (await weekMatchups(w, 1))[0];
    const entry = { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores: [] as never[] };
    expect(await code(() => saveEntry(w.store, sk, w.leagueId, entry))).toBe("none");
    await setMemberStatus(w.store, w.owner, w.leagueId, sk.id, "deactivated");
    expect(["not_found", "forbidden"]).toContain(await code(() => saveEntry(w.store, sk, w.leagueId, entry)));
    expect(await w.store.read((db) => resolveAccess(db, db.leagues[0], sk).via)).toBeNull();
    // history is untouched
    expect(await w.store.read((db) => db.memberships.find((x) => x.userId === sk.id)?.status)).toBe("deactivated");
  });

  it("the owner cannot abandon a league; ownership transfer needs the exact name", async () => {
    const w = await mkWorld({ name: "Friday Strikers" });
    const com = await join(w, "commissioner");
    expect(await code(() => leaveLeague(w.store, w.owner, w.leagueId))).toBe("conflict");
    expect(await code(() => transferOwnership(w.store, w.owner, w.leagueId, com.id, "wrong name"))).toBe("validation");
    await transferOwnership(w.store, w.owner, w.leagueId, com.id, "Friday Strikers");
    expect(await w.store.read((db) => db.memberships.filter((m) => m.leagueId === w.leagueId).map((m) => [m.userId, m.role]))).toEqual(expect.arrayContaining([[com.id, "owner"], [w.owner.id, "commissioner"]]));
    expect(await code(() => transferOwnership(w.store, w.owner, w.leagueId, com.id, "Friday Strikers"))).toBe("forbidden"); // no longer owner
    expect(await code(() => leaveLeague(w.store, w.owner, w.leagueId))).toBe("none");
  });
});

describe("league isolation", () => {
  it("users cannot read or edit another league's records by guessing ids", async () => {
    const store = await mkStore();
    const a = await mkWorld({ store });
    const b = await mkWorld({ store });
    const mB = (await weekMatchups(b, 1))[0];
    // owner of A tries to use B's matchup/team/season ids through A's league
    expect(await code(() => saveEntry(store, a.owner, a.leagueId, { matchupId: mB.id, expectedRevision: mB.revision, lineupA: [], lineupB: [], scores: [] }))).toBe("not_found");
    expect(await code(() => finalizeMatchup(store, a.owner, a.leagueId, mB.id, mB.revision))).toBe("not_found");
    expect(await code(() => changeTeam(store, a.owner, a.leagueId, b.seasonId, b.bowlerIds[0][0], b.teamIds[1], 2))).toBe("not_found");
    expect(await code(() => changeTeam(store, a.owner, a.leagueId, a.seasonId, b.bowlerIds[0][0], a.teamIds[0], 2))).toBe("not_found");
    expect(await code(() => changeTeam(store, a.owner, a.leagueId, a.seasonId, a.bowlerIds[0][0], b.teamIds[0], 2))).toBe("not_found");
    // and directly against B without membership
    expect(await code(() => addTeam(store, a.owner, b.leagueId, { name: "Intruder" }))).toBe("not_found");
    const aFirst = (await weekMatchups(a, 1))[0].id;
    expect(await store.read((db) => matchupIn(db, a.leagueId, aFirst).season.leagueId)).toBe(a.leagueId);
    expect(await code(() => store.read((db) => requirePerm(db, a.owner, b.leagueId, "scores.enter")))).toBe("not_found");
  });

  it("changing one league's rules never touches another league (even with identical data)", async () => {
    const store = await mkStore();
    const a = await mkWorld({ store });
    const b = await mkWorld({ store });
    const before = JSON.stringify(await store.read((db) => [db.seasons.find((s) => s.id === b.seasonId), db.leagues.find((l) => l.id === b.leagueId)]));
    const cfg = await structuredClone(await store.read((db) => db.seasons.find((s) => s.id === a.seasonId)!.ruleVersions[0].config));
    cfg.handicap.percentage = 70;
    cfg.handicap.baseValue = 200;
    await applyRuleChange(store, a.owner, a.leagueId, { seasonId: a.seasonId, proposed: cfg, scope: { type: "from_week", week: 1 }, reason: "Tuning" });
    expect(JSON.stringify(await store.read((db) => [db.seasons.find((s) => s.id === b.seasonId), db.leagues.find((l) => l.id === b.leagueId)]))).toBe(before);
    // and A can't apply a change targeting B's season
    expect(await code(() => applyRuleChange(store, a.owner, a.leagueId, { seasonId: b.seasonId, proposed: cfg, scope: { type: "from_week", week: 1 }, reason: "Nope" }))).toBe("not_found");
  });

  it("scores of identical weeks in two leagues stay independent", async () => {
    const store = await mkStore();
    const a = await mkWorld({ store });
    const b = await mkWorld({ store });
    await playWeek(a, 1);
    const bIds = new Set((await weekMatchups(b, 1)).map((m) => m.id));
    const bScores = await store.read((db) => db.scores.filter((s) => bIds.has(s.matchupId)).length);
    expect(bScores).toBe(0);
  });
});

describe("visibility", () => {
  it("private leagues are members-only; unlisted needs the link token; public is open", async () => {
    const store = await mkStore();
    const w = await mkWorld({ store, visibility: "private" });
    const stranger = await mkUser(store);
    const getLeague = () => store.read((db) => db.leagues.find((l) => l.id === w.leagueId)!);
    const via = async (actor: typeof stranger | null, token?: string) => {
      const league = await getLeague();
      return store.read((db) => resolveAccess(db, league, actor, token).via);
    };
    expect(await via(stranger)).toBeNull();
    expect(await via(null)).toBeNull();
    expect(await via(w.owner)).toBe("member");
    await updateVisibility(store, w.owner, w.leagueId, "unlisted");
    const token = (await getLeague()).shareToken;
    expect(await via(null)).toBeNull();
    expect(await via(null, "wrong")).toBeNull();
    expect(await via(null, token)).toBe("link");
    await updateVisibility(store, w.owner, w.leagueId, "public");
    expect(await via(null)).toBe("public");
    // changing visibility rotates the share token so old private links die
    await updateVisibility(store, w.owner, w.leagueId, "unlisted");
    expect((await getLeague()).shareToken).not.toBe(token);
    expect(await via(null, token)).toBeNull();
  });

  it("a non-member cannot even confirm that a private league exists", async () => {
    const w = await mkWorld({ visibility: "private" });
    const stranger = await mkUser(w.store);
    expect(await code(() => w.store.read((db) => requirePerm(db, stranger, w.leagueId, "scores.enter")))).toBe("not_found");
  });
});

describe("invitations", () => {
  it("are single-use, expiring, revocable and email-bound", async () => {
    const w = await mkWorld();
    const u1 = await mkUser(w.store);
    const u2 = await mkUser(w.store);
    const { token, invitationId } = await inviteMember(w.store, w.owner, w.leagueId, { role: "viewer" });
    expect((await previewInvitation(w.store, token))?.state).toBe("valid");
    await acceptInvitation(w.store, u1, token);
    expect(await code(() => acceptInvitation(w.store, u2, token))).toBe("validation");
    expect((await previewInvitation(w.store, token))?.state).toBe("used");

    const t2 = await inviteMember(w.store, w.owner, w.leagueId, { role: "viewer" });
    await revokeInvitation(w.store, w.owner, w.leagueId, t2.invitationId);
    expect(await code(() => acceptInvitation(w.store, u2, t2.token))).toBe("validation");

    const bound = await inviteMember(w.store, w.owner, w.leagueId, { role: "viewer", email: "someone-else@example.com" });
    expect(await code(() => acceptInvitation(w.store, u2, bound.token))).toBe("forbidden");

    const t3 = await inviteMember(w.store, w.owner, w.leagueId, { role: "viewer" });
    await w.store.transaction((db) => { db.invitations.find((i) => i.id === t3.invitationId)!.expiresAt = new Date(Date.now() - 1000).toISOString(); });
    expect(await code(() => acceptInvitation(w.store, u2, t3.token))).toBe("validation");
    expect(invitationId).toBeTruthy();
  });

  it("assistants can only invite bowlers and viewers", async () => {
    const w = await mkWorld();
    const asst = await join(w, "assistant");
    expect(await code(() => inviteMember(w.store, asst, w.leagueId, { role: "viewer" }))).toBe("none");
    expect(await code(() => inviteMember(w.store, asst, w.leagueId, { role: "commissioner" }))).toBe("forbidden");
    expect(await code(() => inviteMember(w.store, asst, w.leagueId, { role: "owner" }))).toBe("forbidden");
  });
});

describe("accounts", () => {
  it("locks out repeated bad passwords and never leaks which half was wrong", async () => {
    const store = await mkStore();
    const u = await mkUser(store, "locky");
    for (let i = 0; i < 6; i++) expect(await code(() => loginWithLockout(store, u.email, "wrong-password"))).toBe("unauthenticated");
    expect(await code(() => loginWithLockout(store, u.email, "correct-horse-battery"))).toBe("rate_limited");
    expect(await code(() => loginWithLockout(store, "nobody@example.com", "whatever12"))).toBe("unauthenticated");
  });
});
