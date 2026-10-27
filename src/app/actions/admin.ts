"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { RuleConfig } from "@/domain/config";
import type { ChangeScope, RulePreview } from "@/domain/rulechange";
import type { Role, Side } from "@/domain/types";
import { leagueBySlug } from "@/server/access";
import { getStore } from "@/server/db";
import { requireActor } from "@/server/session";
import { appUrl, sendMail } from "@/server/mailer";
import { addCommissionerAward, postAnnouncement, removeCommissionerAward, updateAnnouncement } from "@/server/services/content";
import { commitImport, importBundle, previewImport, type ImportKind, type ImportReport } from "@/server/services/data";
import * as L from "@/server/services/leagues";
import { applyRuleChange, previewSeasonRules, updateLeagueDefaults } from "@/server/services/rules";
import * as S from "@/server/services/season";
import { bool, num, run, str, type ActionState } from "./util";

async function lid(slug: string): Promise<string> {
  const l = await getStore().read((db) => leagueBySlug(db, slug), { leagueSlug: slug });
  if (!l) throw Object.assign(new Error("not found"), { digest: "NEXT_NOT_FOUND" });
  return l.id;
}
const done = (slug: string, message: string): ActionState => {
  revalidatePath(`/l/${slug}`, "layout");
  return { ok: true, message };
};
const opt = (fd: FormData, k: string) => (str(fd, k) === "" ? null : str(fd, k));

// ---------- teams / bowlers / roster ----------
export async function addTeamAction(slug: string, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); await S.addTeam(getStore(), a, await lid(slug), { name: str(fd, "name"), shortName: str(fd, "shortName") || undefined, color: str(fd, "color") || undefined, logo: str(fd, "logo") || undefined }); return done(slug, "Team added."); });
}
export async function updateTeamAction(slug: string, teamId: string, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); await S.updateTeam(getStore(), a, await lid(slug), teamId, { name: str(fd, "name"), shortName: str(fd, "shortName"), color: str(fd, "color"), logo: str(fd, "logo"), active: bool(fd, "active") }); return done(slug, "Team updated."); });
}
export async function addBowlerAction(slug: string, seasonId: string | null, _: ActionState, fd: FormData) {
  return run(async () => {
    const a = await requireActor(); const store = getStore(); const id = await lid(slug);
    const bowlerId = await S.addBowler(store, a, id, { name: str(fd, "name"), nickname: str(fd, "nickname") || undefined, avatarUrl: str(fd, "avatarUrl") || undefined });
    if (seasonId) {
      const avg = num(fd, "entering");
      await S.addToRoster(store, a, id, seasonId, { bowlerId, teamId: opt(fd, "team"), enteringAverage: Number.isNaN(avg) ? null : avg, isSub: bool(fd, "isSub"), fromWeek: Number(str(fd, "fromWeek")) || 1 });
    }
    return done(slug, "Bowler added.");
  });
}
export async function rosterAddAction(slug: string, seasonId: string, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); const avg = num(fd, "entering"); await S.addToRoster(getStore(), a, await lid(slug), seasonId, { bowlerId: str(fd, "bowler"), teamId: opt(fd, "team"), enteringAverage: Number.isNaN(avg) ? null : avg, isSub: bool(fd, "isSub"), fromWeek: Number(str(fd, "fromWeek")) || 1 }); return done(slug, "Added to the season roster."); });
}
export async function changeTeamAction(slug: string, seasonId: string, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); await S.changeTeam(getStore(), a, await lid(slug), seasonId, str(fd, "bowler"), opt(fd, "team"), Number(str(fd, "week"))); return done(slug, "Team changed. Earlier results keep the old team."); });
}
export async function setAverageAction(slug: string, seasonId: string, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); const v = num(fd, "entering"); await S.setEnteringAverage(getStore(), a, await lid(slug), seasonId, str(fd, "bowler"), Number.isNaN(v) ? null : v); return done(slug, "Entering average updated."); });
}
export async function bowlerStatusAction(slug: string, bowlerId: string, active: boolean): Promise<ActionState> {
  const a = await requireActor();
  return run(async () => { await S.updateBowler(getStore(), a, await lid(slug), bowlerId, { active }); return done(slug, active ? "Reactivated." : "Deactivated. History is kept."); });
}
export async function subAction(slug: string, seasonId: string, bowlerId: string, isSub: boolean): Promise<ActionState> {
  const a = await requireActor();
  return run(async () => { await S.setSubstitute(getStore(), a, await lid(slug), seasonId, bowlerId, isSub); return done(slug, "Updated."); });
}
export async function removeRosterAction(slug: string, seasonId: string, bowlerId: string): Promise<ActionState> {
  const a = await requireActor();
  const r = await run(async () => { await S.removeFromRoster(getStore(), a, await lid(slug), seasonId, bowlerId); return done(slug, "Removed from the season roster."); });
  return r;
}

// ---------- schedule ----------
export async function generateScheduleAction(slug: string, seasonId: string, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); const from = Number(str(fd, "from")) || undefined; const r = await S.generateSchedule(getStore(), a, await lid(slug), seasonId, { fromWeek: from }); return done(slug, `Schedule created: ${r.created} matchups.${r.warnings.length ? " Note: " + r.warnings.join(" ") : ""}`); });
}
export async function addMatchupAction(slug: string, seasonId: string, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); await S.createMatchup(getStore(), a, await lid(slug), seasonId, { week: Number(str(fd, "week")), sideA: str(fd, "a"), sideB: opt(fd, "b") }); return done(slug, "Matchup added."); });
}
export async function moveMatchupAction(slug: string, matchupId: string, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); await S.moveMatchup(getStore(), a, await lid(slug), matchupId, Number(str(fd, "week"))); return done(slug, "Matchup moved. Players are notified."); });
}
export async function deleteMatchupAction(slug: string, matchupId: string): Promise<ActionState> {
  const a = await requireActor();
  return run(async () => { await S.deleteMatchup(getStore(), a, await lid(slug), matchupId); return done(slug, "Matchup removed."); });
}
export async function updateWeekAction(slug: string, seasonId: string, weekNumber: number, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); await S.updateWeek(getStore(), a, await lid(slug), seasonId, weekNumber, { date: str(fd, "date") || undefined, status: (str(fd, "status") || undefined) as never, label: fd.has("label") ? str(fd, "label") : undefined }); return done(slug, `Week ${weekNumber} updated.`); });
}
export async function playoffBracketAction(slug: string, seasonId: string, force: boolean): Promise<ActionState> {
  const a = await requireActor();
  return run(async () => { const r = await S.generatePlayoffBracket(getStore(), a, await lid(slug), seasonId, { force }); return done(slug, `Bracket created with ${r.created} first-round matchup${r.created === 1 ? "" : "s"}.`); });
}

// ---------- settings ----------
export async function generalAction(slug: string, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); await L.updateGeneral(getStore(), a, await lid(slug), { name: str(fd, "name"), description: str(fd, "description"), logoText: str(fd, "logoText"), accent: str(fd, "accent") }); return done(slug, "Saved."); });
}
export async function visibilityAction(slug: string, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); await L.updateVisibility(getStore(), a, await lid(slug), str(fd, "visibility") as never); return done(slug, "Visibility updated. Previous share links stop working."); });
}
export async function rotateTokenAction(slug: string, _: ActionState, __: FormData) {
  return run(async () => { const a = await requireActor(); await L.rotateShareToken(getStore(), a, await lid(slug)); return done(slug, "New private link generated. The old one no longer works."); });
}
export async function homepageAction(slug: string, modules: { id: string; enabled: boolean }[]): Promise<ActionState> {
  const a = await requireActor();
  return run(async () => { await L.updateHomepage(getStore(), a, await lid(slug), modules); return done(slug, "Homepage saved."); });
}
export async function awardsAction(slug: string, awards: Record<string, { enabled: boolean; params: Record<string, number> }>): Promise<ActionState> {
  const a = await requireActor();
  return run(async () => { await L.updateAwardsConfig(getStore(), a, await lid(slug), awards); return done(slug, "Awards updated."); });
}
export async function commissionerAwardAction(slug: string, seasonId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const a = await requireActor();
    const [kind, rid] = str(fd, "recipient").split(":");
    const wk = str(fd, "week");
    await addCommissionerAward(getStore(), a, await lid(slug), { seasonId, title: str(fd, "title"), recipientKind: kind as "bowler" | "team", recipientId: rid, note: str(fd, "note"), week: wk ? Number(wk) : null });
    return done(slug, "Commissioner award added.");
  });
}
export async function removeCommissionerAwardAction(slug: string, id: string): Promise<ActionState> {
  const a = await requireActor();
  return run(async () => { await removeCommissionerAward(getStore(), a, await lid(slug), id); return done(slug, "Removed."); });
}

export async function previewRulesAction(slug: string, seasonId: string, proposed: RuleConfig, scope: ChangeScope): Promise<{ ok: boolean; error?: string; preview?: RulePreview }> {
  const a = await requireActor();
  let preview: RulePreview | undefined;
  const r = await run(async () => { preview = await previewSeasonRules(getStore(), a, await lid(slug), seasonId, proposed, scope); });
  return r?.ok === false ? { ok: false, error: r.error } : { ok: true, preview };
}
export async function applyRulesAction(slug: string, seasonId: string, proposed: RuleConfig, scope: ChangeScope, reason: string, strong: string): Promise<ActionState> {
  const a = await requireActor();
  return run(async () => {
    const r = await applyRuleChange(getStore(), a, await lid(slug), { seasonId, proposed, scope, reason, strongConfirmation: strong });
    return done(slug, scope.type === "new_season" ? "Saved as the default for future seasons. Existing seasons are untouched." : `Rules updated (version ${r.version}).${r.reversed ? ` ${r.reversed} result(s) changed winner.` : ""}`);
  });
}
export async function leagueDefaultsAction(slug: string, proposed: RuleConfig, reason: string): Promise<ActionState> {
  const a = await requireActor();
  return run(async () => { await updateLeagueDefaults(getStore(), a, await lid(slug), proposed, reason); return done(slug, "Defaults saved for future seasons."); });
}
export async function saveTemplateAction(slug: string, proposed: RuleConfig, name: string): Promise<ActionState> {
  const a = await requireActor();
  return run(async () => { await L.saveTemplate(getStore(), a, await lid(slug), name, "", proposed); return done(slug, "Template saved."); });
}

// ---------- members ----------
export async function inviteAction(slug: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const a = await requireActor(); const store = getStore(); const id = await lid(slug);
    const email = str(fd, "email") || null;
    const { token } = await L.inviteMember(store, a, id, { email, role: str(fd, "role") as Role, ttlDays: Number(str(fd, "ttl")) || 7 });
    const link = appUrl(`/invite/${token}`);
    if (email) await sendMail({ to: email, subject: `You're invited to ${slug}`, text: `${a.name} invited you to join a bowling league:\n\n${link}` });
    revalidatePath(`/l/${slug}`, "layout");
    return { ok: true, message: `Invitation created. Share this link (shown once): ${link}` };
  });
}
export async function revokeInviteAction(slug: string, invitationId: string): Promise<ActionState> {
  const a = await requireActor();
  return run(async () => { await L.revokeInvitation(getStore(), a, await lid(slug), invitationId); return done(slug, "Invitation revoked."); });
}
export async function setRoleAction(slug: string, userId: string, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); await L.setMemberRole(getStore(), a, await lid(slug), userId, str(fd, "role") as Role); return done(slug, "Role updated."); });
}
export async function memberStatusAction(slug: string, userId: string, status: "deactivated" | "removed" | "active"): Promise<ActionState> {
  const a = await requireActor();
  return run(async () => { await L.setMemberStatus(getStore(), a, await lid(slug), userId, status); return done(slug, status === "active" ? "Access restored." : "Access revoked. Their scores and history are kept."); });
}
export async function linkBowlerAction(slug: string, userId: string, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); await L.linkMemberToBowler(getStore(), a, await lid(slug), userId, opt(fd, "bowler")); return done(slug, "Linked."); });
}
export async function transferAction(slug: string, _: ActionState, fd: FormData) {
  return run(async () => { const a = await requireActor(); await L.transferOwnership(getStore(), a, await lid(slug), str(fd, "to"), str(fd, "confirm")); return done(slug, "Ownership transferred. You're now a commissioner."); });
}
export async function leaveAction(slug: string) {
  const a = await requireActor();
  const r = await run(async () => { await L.leaveLeague(getStore(), a, await lid(slug)); });
  if (r?.error) redirect(`/l/${slug}/admin/members?error=${encodeURIComponent(r.error)}`);
  redirect("/");
}
export async function archiveLeagueAction(slug: string, _: ActionState, fd: FormData) {
  const a = await requireActor();
  const r = await run(async () => { await L.archiveLeague(getStore(), a, await lid(slug), str(fd, "confirm")); });
  if (r?.error) return r;
  redirect("/");
}

// ---------- news ----------
export async function postNewsAction(slug: string, editId: string | null, _: ActionState, fd: FormData) {
  return run(async () => {
    const a = await requireActor();
    const input = { title: str(fd, "title"), body: str(fd, "body"), category: str(fd, "category") as never, pinned: bool(fd, "pinned") };
    if (editId) await updateAnnouncement(getStore(), a, await lid(slug), editId, input);
    else await postAnnouncement(getStore(), a, await lid(slug), input);
    return done(slug, editId ? "Announcement updated." : "Announcement posted and members notified.");
  });
}

// ---------- seasons ----------
export async function createSeasonAction(slug: string, _: ActionState, fd: FormData) {
  const a = await requireActor();
  let to = "";
  const r = await run(async () => {
    const res = await S.createNextSeason(getStore(), a, await lid(slug), { name: str(fd, "name"), year: Number(str(fd, "year")), startDate: str(fd, "startDate"), regularWeeks: Number(str(fd, "weeks")), copyFromSeasonId: opt(fd, "from"), copyRoster: bool(fd, "copyRoster"), copySchedule: bool(fd, "copySchedule"), completePrevious: bool(fd, "completePrevious") });
    to = `/l/${slug}/admin/seasons?created=${res.slug}`;
  });
  if (r?.ok === false) return r;
  redirect(to);
}
export async function completeSeasonAction(slug: string, seasonId: string): Promise<ActionState> {
  const a = await requireActor();
  return run(async () => { await S.completeSeason(getStore(), a, await lid(slug), seasonId); return done(slug, "Season marked complete and archived."); });
}

// ---------- import ----------
export async function previewImportAction(slug: string, seasonId: string | null, kind: ImportKind, text: string, finalize: boolean): Promise<{ ok: boolean; error?: string; report?: ImportReport }> {
  const a = await requireActor();
  let report: ImportReport | undefined;
  const r = await run(async () => { report = await previewImport(getStore(), a, await lid(slug), seasonId, kind, text, { finalize }); });
  return r?.ok === false ? { ok: false, error: r.error } : { ok: true, report };
}
export async function commitImportAction(slug: string, seasonId: string | null, kind: ImportKind, text: string, finalize: boolean): Promise<{ ok: boolean; error?: string; report?: ImportReport; errors?: { line: number; message: string }[] }> {
  const a = await requireActor();
  let report: ImportReport | undefined;
  let errors: { line: number; message: string }[] | undefined;
  const store = getStore();
  try {
    report = await commitImport(store, a, await lid(slug), seasonId, kind, text, true, { finalize });
    revalidatePath(`/l/${slug}`, "layout");
    return { ok: true, report };
  } catch (e) {
    const err = e as { message?: string; details?: { errors?: { line: number; message: string }[] }; code?: string };
    if (err.code === "validation") { errors = err.details?.errors; return { ok: false, error: err.message, errors }; }
    throw e;
  }
}
export async function importBundleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const a = await requireActor();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an export file (.json)." };
  if (file.size > 25 * 1024 * 1024) return { ok: false, error: "That file is too large (25 MB limit)." };
  let slug = "";
  const r = await run(async () => {
    let raw: unknown;
    try { raw = JSON.parse(await file.text()); } catch { return { ok: false, error: "That file isn't valid JSON." } as ActionState; }
    slug = (await importBundle(getStore(), a, raw, str(fd, "name") || undefined)).slug;
  });
  if (r?.ok === false) return r;
  if (slug) redirect(`/l/${slug}/admin`);
  return r;
}
export type { Side };
