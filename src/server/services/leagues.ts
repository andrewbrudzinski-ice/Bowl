import { z } from "zod";
import { defaultAwardsConfig } from "@/domain/awards";
import { BRAND_ACCENT } from "@/domain/brand";
import { validateConfig, type RuleConfig } from "@/domain/config";
import type { Id, League, ModuleSetting, Role, Season, Team, Week } from "@/domain/types";
import { activeMembership, leagueById, notifyUser, requirePerm, writeAudit, type Actor } from "../access";
import type { DB, Invitation, Membership, Store } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { newId, newToken, now, uniqueSlug } from "../ids";
import { hashToken, normalizeEmail } from "../auth";
import { assignableRoles } from "../permissions";

export const HOMEPAGE_MODULES: { id: string; label: string; description: string }[] = [
  { id: "standings", label: "Standings & playoff picture", description: "Top of the table with record, points and form." },
  { id: "matchups", label: "Upcoming matchups", description: "The next week's pairings." },
  { id: "results", label: "Latest results", description: "Scores from the most recent completed week." },
  { id: "news", label: "League news", description: "Pinned and recent commissioner announcements." },
  { id: "bowler_of_week", label: "Bowler of the Week", description: "Best night relative to average." },
  { id: "leaders", label: "Scoring leaders", description: "Top averages, high game and high series." },
  { id: "records", label: "Season records & highlights", description: "Biggest win, closest matchup, most improved." },
  { id: "insights", label: "Statistical insights", description: "Observations with supporting numbers." },
  { id: "activity", label: "Recent activity", description: "Scores entered, results finalized, announcements." },
];

export const defaultHomepage = (): ModuleSetting[] => HOMEPAGE_MODULES.map((m) => ({ id: m.id, enabled: true }));

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #3b82f6.");
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-01-06.");

export const createLeagueSchema = z.object({
  name: z.string().trim().min(2, "League name needs at least 2 characters.").max(60),
  description: z.string().trim().max(300).default(""),
  logoText: z.string().trim().max(3).default(""),
  accent: hex.default(BRAND_ACCENT),
  visibility: z.enum(["private", "unlisted", "public"]).default("private"),
  season: z.object({
    name: z.string().trim().min(1).max(60),
    year: z.number().int().min(1990).max(2100),
    startDate: dateStr,
    regularWeeks: z.number().int().min(1).max(60),
  }),
  config: z.unknown(),
  teamNames: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
});
export type CreateLeagueInput = z.input<typeof createLeagueSchema>;

export const TEAM_COLORS = ["#38bdf8", "#f97316", "#a78bfa", "#34d399", "#f43f5e", "#facc15", "#2dd4bf", "#fb7185", "#60a5fa", "#c084fc", "#4ade80", "#fbbf24"];

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function makeWeeks(seasonId: Id, startDate: string, regular: number, playoff: number, from = 1): Week[] {
  const weeks: Week[] = [];
  for (let i = from; i <= regular + playoff; i++) {
    weeks.push({
      id: newId("wk"), seasonId, number: i, date: addDays(startDate, (i - 1) * 7), status: "scheduled",
      phase: i > regular ? "playoff" : "regular", label: i > regular ? `Playoffs · Round ${i - regular}` : "",
    });
  }
  return weeks;
}

export function createSeasonRecords(db: DB, actor: Actor, league: League, input: { name: string; year: number; startDate: string; regularWeeks: number; config: RuleConfig; reason: string }): Season {
  const takenSlugs = new Set(db.seasons.filter((s) => s.leagueId === league.id).map((s) => s.slug));
  const slug = uniqueSlug(String(input.year), (s) => takenSlugs.has(s));
  const season: Season = {
    id: newId("se"), leagueId: league.id, slug, name: input.name, year: input.year, startDate: input.startDate,
    regularWeeks: input.regularWeeks, status: "active", championId: null, isDemo: false, createdAt: now(),
    ruleVersions: [{ version: 1, effectiveFromWeek: 1, config: input.config, createdAt: now(), createdBy: actor.id, reason: input.reason }],
  };
  db.seasons.push(season);
  const playoffWeeks = input.config.playoffs.enabled ? input.config.playoffs.weeks : 0;
  db.weeks.push(...makeWeeks(season.id, input.startDate, input.regularWeeks, playoffWeeks));
  return season;
}

export function createLeague(store: Store, actor: Actor, raw: CreateLeagueInput): Promise<{ leagueId: Id; slug: string; seasonId: Id }> {
  const parsed = createLeagueSchema.safeParse(raw);
  if (!parsed.success) throw invalid(parsed.error.issues[0].path.join(".") + ": " + parsed.error.issues[0].message);
  const input = parsed.data;
  const check = validateConfig(input.config);
  if (!check.ok || !check.config) throw invalid(check.issues.find((i) => i.severity === "error")?.message ?? "Invalid league rules.", check.issues);
  return store.transaction((db) => {
    const slug = uniqueSlug(input.name, (s) => db.leagues.some((l) => l.slug === s));
    const league: League = {
      id: newId("lg"), slug, name: input.name, description: input.description,
      accent: input.accent, logoText: input.logoText || input.name.slice(0, 2).toUpperCase(),
      visibility: input.visibility, shareToken: newToken().slice(0, 24), createdAt: now(), createdBy: actor.id,
      defaultConfig: check.config!, homepage: defaultHomepage(), awards: defaultAwardsConfig(), isDemo: false, archivedAt: null,
    };
    db.leagues.push(league);
    db.memberships.push({ id: newId("mb"), leagueId: league.id, userId: actor.id, role: "owner", status: "active", bowlerId: null, joinedAt: now() });
    const season = createSeasonRecords(db, actor, league, { ...input.season, config: check.config!, reason: "Initial rules" });
    input.teamNames.forEach((name, i) => {
      const team: Team = {
        id: newId("tm"), leagueId: league.id, name, shortName: name.slice(0, 3).toUpperCase(), color: TEAM_COLORS[i % TEAM_COLORS.length],
        logo: name.slice(0, 1).toUpperCase(), active: true, isDemo: false,
      };
      db.teams.push(team);
    });
    writeAudit(db, actor, { leagueId: league.id, seasonId: season.id, action: "league.created", entityType: "league", entityId: league.id, after: { name: league.name, visibility: league.visibility, config: check.config } });
    return { leagueId: league.id, slug, seasonId: season.id };
  }, { all: ["leagues"] });
}

export function listUserLeagues(store: Store, userId: Id) {
  return store.read((db) =>
    db.memberships
      .filter((m) => m.userId === userId && m.status === "active")
      .map((m) => ({ league: db.leagues.find((l) => l.id === m.leagueId)!, role: m.role }))
      .filter((x) => x.league && !x.league.archivedAt),
    { userIds: [userId] }
  );
}

export function listPublicLeagues(store: Store) {
  return store.read((db) => db.leagues.filter((l) => l.visibility === "public" && !l.archivedAt).map((l) => ({ id: l.id, slug: l.slug, name: l.name, description: l.description, accent: l.accent, logoText: l.logoText })), { publicLeagues: true });
}

// ---------- general settings ----------

export const generalSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300),
  logoText: z.string().trim().max(3),
  accent: hex,
});

export async function updateGeneral(store: Store, actor: Actor, leagueId: Id, raw: z.input<typeof generalSchema>) {
  const input = generalSchema.safeParse(raw);
  if (!input.success) throw invalid(input.error.issues[0].message);
  await store.transaction((db) => {
    const { league } = requirePerm(db, actor, leagueId, "settings.general");
    const before = { name: league.name, description: league.description, logoText: league.logoText, accent: league.accent };
    Object.assign(league, input.data);
    writeAudit(db, actor, { leagueId, action: "league.updated", entityType: "league", entityId: leagueId, before, after: input.data });
  }, { leagueId });
}

export async function updateVisibility(store: Store, actor: Actor, leagueId: Id, visibility: League["visibility"]) {
  if (!["private", "unlisted", "public"].includes(visibility)) throw invalid("Unknown visibility.");
  await store.transaction((db) => {
    const { league } = requirePerm(db, actor, leagueId, "settings.visibility");
    if (league.visibility === visibility) return;
    const before = league.visibility;
    league.visibility = visibility;
    // Changing visibility invalidates previously shared private links.
    league.shareToken = newToken().slice(0, 24);
    writeAudit(db, actor, { leagueId, action: "league.visibility_changed", entityType: "league", entityId: leagueId, before: { visibility: before }, after: { visibility } });
  }, { leagueId });
}

export function rotateShareToken(store: Store, actor: Actor, leagueId: Id): Promise<string> {
  return store.transaction((db) => {
    const { league } = requirePerm(db, actor, leagueId, "settings.visibility");
    league.shareToken = newToken().slice(0, 24);
    writeAudit(db, actor, { leagueId, action: "league.share_link_rotated", entityType: "league", entityId: leagueId });
    return league.shareToken;
  }, { leagueId });
}

export async function updateHomepage(store: Store, actor: Actor, leagueId: Id, modules: ModuleSetting[]) {
  const valid = new Set(HOMEPAGE_MODULES.map((m) => m.id));
  const clean = modules.filter((m) => valid.has(m.id));
  const seen = new Set<string>();
  for (const m of clean) {
    if (seen.has(m.id)) throw invalid("Duplicate homepage module.");
    seen.add(m.id);
  }
  for (const id of valid) if (!seen.has(id)) clean.push({ id, enabled: false });
  await store.transaction((db) => {
    const { league } = requirePerm(db, actor, leagueId, "settings.general");
    const before = league.homepage;
    league.homepage = clean.map((m) => ({ id: m.id, enabled: !!m.enabled }));
    writeAudit(db, actor, { leagueId, action: "league.homepage_changed", entityType: "league", entityId: leagueId, before, after: league.homepage });
  }, { leagueId });
}

export async function updateAwardsConfig(store: Store, actor: Actor, leagueId: Id, awards: League["awards"]) {
  await store.transaction((db) => {
    const { league } = requirePerm(db, actor, leagueId, "awards.manage");
    const before = league.awards;
    const clean: League["awards"] = {};
    for (const [id, v] of Object.entries(awards)) {
      clean[id] = { enabled: !!v.enabled, params: Object.fromEntries(Object.entries(v.params ?? {}).map(([k, n]) => [k, Number(n)]).filter(([, n]) => Number.isFinite(n))) as Record<string, number> };
    }
    league.awards = { ...league.awards, ...clean };
    writeAudit(db, actor, { leagueId, action: "awards.config_changed", entityType: "league", entityId: leagueId, before, after: league.awards });
  }, { leagueId });
}

// ---------- templates & duplication ----------

export async function saveTemplate(store: Store, actor: Actor, leagueId: Id, name: string, description: string, config: unknown) {
  const check = validateConfig(config);
  if (!check.ok || !check.config) throw invalid(check.issues.find((i) => i.severity === "error")!.message);
  if (!name.trim()) throw invalid("Give the template a name.");
  await store.transaction((db) => {
    requirePerm(db, actor, leagueId, "settings.rules");
    db.templates.push({ id: newId("tp"), leagueId, name: name.trim().slice(0, 60), description: description.slice(0, 200), config: check.config!, createdAt: now() });
    writeAudit(db, actor, { leagueId, action: "template.saved", entityType: "template", entityId: name });
  }, { leagueId });
}

/** Duplicates a league's *setup* (rules, teams, homepage) — never scores, schedules or results. */
export function duplicateLeagueSetup(store: Store, actor: Actor, sourceLeagueId: Id, input: { name: string; year: number; startDate: string }) {
  return store.transaction((db) => {
    const { league: src } = requirePerm(db, actor, sourceLeagueId, "settings.rules");
    const season = db.seasons.filter((s) => s.leagueId === src.id).sort((a, b) => b.year - a.year)[0];
    const cfg = season ? season.ruleVersions[season.ruleVersions.length - 1].config : src.defaultConfig;
    const slug = uniqueSlug(input.name, (s) => db.leagues.some((l) => l.slug === s));
    const league: League = { ...structuredClone(src), id: newId("lg"), slug, name: input.name, createdAt: now(), createdBy: actor.id, shareToken: newToken().slice(0, 24), isDemo: false, defaultConfig: structuredClone(cfg) };
    db.leagues.push(league);
    db.memberships.push({ id: newId("mb"), leagueId: league.id, userId: actor.id, role: "owner", status: "active", bowlerId: null, joinedAt: now() });
    const s = createSeasonRecords(db, actor, league, { name: `${input.year} Season`, year: input.year, startDate: input.startDate, regularWeeks: season?.regularWeeks ?? 10, config: structuredClone(cfg), reason: `Copied setup from ${src.name}` });
    for (const t of db.teams.filter((t) => t.leagueId === src.id && t.active)) db.teams.push({ ...t, id: newId("tm"), leagueId: league.id, isDemo: false });
    writeAudit(db, actor, { leagueId: league.id, seasonId: s.id, action: "league.duplicated", entityType: "league", entityId: league.id, after: { from: src.id } });
    return { leagueId: league.id, slug };
  }, { all: ["leagues"], leagueId: sourceLeagueId });
}

// ---------- members & invitations ----------

export function listMembers(store: Store, actor: Actor, leagueId: Id) {
  return store.read((db) => {
    requirePerm(db, actor, leagueId, "league.view_admin");
    return db.memberships
      .filter((m) => m.leagueId === leagueId)
      .map((m) => {
        const u = db.users.find((x) => x.id === m.userId)!;
        return { ...m, name: u.name, email: u.email };
      });
  }, { leagueId });
}

export function listInvitations(store: Store, actor: Actor, leagueId: Id) {
  return store.read((db) => {
    requirePerm(db, actor, leagueId, "members.invite_basic");
    return db.invitations
      .filter((i) => i.leagueId === leagueId)
      .map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt, revokedAt: i.revokedAt, acceptedAt: i.acceptedAt }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, { leagueId });
}

export function inviteMember(store: Store, actor: Actor, leagueId: Id, input: { email?: string | null; role: Role; ttlDays?: number }): Promise<{ token: string; invitationId: Id }> {
  return store.transaction((db) => {
    const { membership } = requirePerm(db, actor, leagueId, "members.invite_basic");
    if (!assignableRoles(membership.role).includes(input.role)) throw forbidden(`You can't invite someone as ${input.role}.`);
    const email = input.email ? normalizeEmail(input.email) : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid("Enter a valid email address or leave it blank for a shareable link.");
    const ttl = Math.min(Math.max(input.ttlDays ?? 7, 1), 60);
    const token = newToken();
    const inv: Invitation = {
      id: newId("iv"), leagueId, email, role: input.role, tokenHash: hashToken(token), createdBy: actor.id, createdAt: now(),
      expiresAt: new Date(Date.now() + ttl * 864e5).toISOString(), revokedAt: null, acceptedBy: null, acceptedAt: null,
    };
    db.invitations.push(inv);
    const league = leagueById(db, leagueId);
    if (email) {
      const invitee = db.users.find((u) => u.email === email);
      if (invitee) notifyUser(db, invitee.id, { leagueId, type: "invitations", title: `Invitation to ${league.name}`, body: `${actor.name} invited you as ${input.role}.`, href: `/invite/${token}`, dedupeKey: `invite:${inv.id}` });
    }
    writeAudit(db, actor, { leagueId, action: "member.invited", entityType: "invitation", entityId: inv.id, after: { email, role: input.role, expiresAt: inv.expiresAt } });
    return { token, invitationId: inv.id };
  }, { leagueId, emails: input.email ? [normalizeEmail(input.email)] : undefined });
}

export async function revokeInvitation(store: Store, actor: Actor, leagueId: Id, invitationId: Id) {
  await store.transaction((db) => {
    requirePerm(db, actor, leagueId, "members.invite_basic");
    const inv = db.invitations.find((i) => i.id === invitationId && i.leagueId === leagueId);
    if (!inv) throw notFound("Invitation");
    if (inv.acceptedAt) throw conflict("That invitation was already used.");
    inv.revokedAt = now();
    writeAudit(db, actor, { leagueId, action: "member.invitation_revoked", entityType: "invitation", entityId: inv.id });
  }, { leagueId });
}

export function previewInvitation(store: Store, token: string) {
  const h = hashToken(token);
  return store.read((db) => {
    const inv = db.invitations.find((i) => i.tokenHash === h);
    if (!inv) return null;
    const league = db.leagues.find((l) => l.id === inv.leagueId && !l.archivedAt);
    if (!league) return null;
    const state = inv.revokedAt ? "revoked" : inv.acceptedAt ? "used" : inv.expiresAt < now() ? "expired" : "valid";
    return { leagueName: league.name, role: inv.role, state, email: inv.email };
  }, { tokenHash: h });
}

export function acceptInvitation(store: Store, actor: Actor, token: string): Promise<{ slug: string }> {
  const h = hashToken(token);
  return store.transaction((db) => {
    const inv = db.invitations.find((i) => i.tokenHash === h);
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt < now()) throw invalid("This invitation is invalid, expired or was already used.");
    if (inv.email && inv.email !== normalizeEmail(actor.email)) throw forbidden("This invitation was sent to a different email address.");
    const league = leagueById(db, inv.leagueId);
    const existing = db.memberships.find((m) => m.leagueId === inv.leagueId && m.userId === actor.id);
    if (existing && existing.status === "active") throw conflict("You're already a member of this league.");
    if (existing) {
      existing.status = "active";
      existing.role = inv.role;
    } else {
      db.memberships.push({ id: newId("mb"), leagueId: inv.leagueId, userId: actor.id, role: inv.role, status: "active", bowlerId: null, joinedAt: now() });
    }
    inv.acceptedBy = actor.id;
    inv.acceptedAt = now();
    writeAudit(db, actor, { leagueId: inv.leagueId, action: "member.joined", entityType: "membership", entityId: actor.id, after: { role: inv.role } });
    return { slug: league.slug };
  }, { tokenHash: h, userIds: [actor.id] });
}

function countActiveOwners(db: DB, leagueId: Id) {
  return db.memberships.filter((m) => m.leagueId === leagueId && m.status === "active" && m.role === "owner").length;
}

export async function setMemberRole(store: Store, actor: Actor, leagueId: Id, userId: Id, role: Role) {
  await store.transaction((db) => {
    const { membership: me } = requirePerm(db, actor, leagueId, "members.manage");
    const target = db.memberships.find((m) => m.leagueId === leagueId && m.userId === userId && m.status === "active");
    if (!target) throw notFound("Member");
    if (target.role === "owner") throw forbidden("The owner's role can only change through ownership transfer.");
    if (target.userId === actor.id) throw forbidden("You can't change your own role.");
    if (!assignableRoles(me.role).includes(role)) throw forbidden(`You can't assign the ${role} role.`);
    if (!assignableRoles(me.role).includes(target.role)) throw forbidden("You can't change a member with an equal or higher role.");
    const before = target.role;
    target.role = role;
    writeAudit(db, actor, { leagueId, action: "member.role_changed", entityType: "membership", entityId: userId, before: { role: before }, after: { role } });
  }, { leagueId });
}

/** Deactivating revokes access immediately but keeps the membership (and any linked bowler history). */
export async function setMemberStatus(store: Store, actor: Actor, leagueId: Id, userId: Id, status: "deactivated" | "removed" | "active") {
  await store.transaction((db) => {
    const { membership: me } = requirePerm(db, actor, leagueId, "members.manage");
    const target = db.memberships.find((m) => m.leagueId === leagueId && m.userId === userId);
    if (!target) throw notFound("Member");
    if (target.role === "owner") throw forbidden("The owner can't be removed. Transfer ownership first.");
    if (target.userId === actor.id) throw forbidden("Use “Leave league” to remove yourself.");
    if (!assignableRoles(me.role).includes(target.role)) throw forbidden("You can't remove a member with an equal or higher role.");
    const before = target.status;
    target.status = status;
    writeAudit(db, actor, { leagueId, action: `member.${status === "active" ? "reactivated" : status}`, entityType: "membership", entityId: userId, before: { status: before }, after: { status } });
  }, { leagueId });
}

export async function leaveLeague(store: Store, actor: Actor, leagueId: Id) {
  await store.transaction((db) => {
    const m = activeMembership(db, leagueId, actor.id);
    if (!m) throw notFound("Membership");
    if (m.role === "owner" && countActiveOwners(db, leagueId) <= 1) throw conflict("You own this league. Transfer ownership to another member before leaving.");
    m.status = "removed";
    writeAudit(db, actor, { leagueId, action: "member.left", entityType: "membership", entityId: actor.id });
  }, { leagueId });
}

export async function linkMemberToBowler(store: Store, actor: Actor, leagueId: Id, userId: Id, bowlerId: Id | null) {
  await store.transaction((db) => {
    requirePerm(db, actor, leagueId, "members.manage");
    const m = db.memberships.find((x) => x.leagueId === leagueId && x.userId === userId && x.status === "active");
    if (!m) throw notFound("Member");
    if (bowlerId && !db.bowlers.some((b) => b.id === bowlerId && b.leagueId === leagueId)) throw notFound("Bowler");
    const before = m.bowlerId;
    m.bowlerId = bowlerId;
    const b = bowlerId ? db.bowlers.find((x) => x.id === bowlerId)! : null;
    if (b) b.userId = userId;
    writeAudit(db, actor, { leagueId, action: "member.linked_bowler", entityType: "membership", entityId: userId, before: { bowlerId: before }, after: { bowlerId } });
  }, { leagueId });
}

export async function transferOwnership(store: Store, actor: Actor, leagueId: Id, toUserId: Id, confirmName: string) {
  await store.transaction((db) => {
    const { league, membership } = requirePerm(db, actor, leagueId, "ownership.transfer");
    if (confirmName.trim() !== league.name) throw invalid("Type the league's exact name to confirm the transfer.");
    const target = db.memberships.find((m) => m.leagueId === leagueId && m.userId === toUserId && m.status === "active");
    if (!target || target.userId === actor.id) throw invalid("Choose another active member to become the owner.");
    target.role = "owner";
    membership.role = "commissioner";
    writeAudit(db, actor, { leagueId, action: "league.ownership_transferred", entityType: "league", entityId: leagueId, before: { owner: actor.id }, after: { owner: toUserId } });
  }, { leagueId });
}

export async function archiveLeague(store: Store, actor: Actor, leagueId: Id, confirmName: string) {
  await store.transaction((db) => {
    const { league } = requirePerm(db, actor, leagueId, "league.delete");
    if (confirmName.trim() !== league.name) throw invalid("Type the league's exact name to confirm.");
    league.archivedAt = now();
    writeAudit(db, actor, { leagueId, action: "league.archived", entityType: "league", entityId: leagueId });
  }, { leagueId });
}

/** Operator recovery path (CLI). Restores an owner when every administrator account is gone. */
export async function recoverOwner(store: Store, slug: string, email: string, by = "operator-cli") {
  await store.transaction((db) => {
    const league = db.leagues.find((l) => l.slug === slug);
    if (!league) throw notFound("League");
    const user = db.users.find((u) => u.email === normalizeEmail(email));
    if (!user) throw notFound("User");
    let m = db.memberships.find((x) => x.leagueId === league.id && x.userId === user.id);
    if (!m) {
      m = { id: newId("mb"), leagueId: league.id, userId: user.id, role: "owner", status: "active", bowlerId: null, joinedAt: now() } as Membership;
      db.memberships.push(m);
    }
    m.role = "owner";
    m.status = "active";
    db.audit.push({ id: newId("au"), leagueId: league.id, seasonId: null, at: now(), userId: user.id, userName: `${by} (for ${user.name})`, action: "league.owner_recovered", entityType: "membership", entityId: user.id, before: null, after: { role: "owner" }, note: "Operator-initiated recovery" });
  }, { leagueSlug: slug, emails: [normalizeEmail(email)] });
}

