import type { Id, League, Role, Season } from "@/domain/types";
import { buildSeasonModel, type SeasonData } from "@/domain/engine";
import type { DB, Membership, Notification, User } from "./db";
import { AppError, forbidden, notFound } from "./errors";
import { newId, now } from "./ids";
import { roleCan, type Permission } from "./permissions";
import type { AuditEntry } from "@/domain/types";

export type Actor = Pick<User, "id" | "name" | "email">;

export interface Access {
  league: League;
  membership: Membership | null;
  role: Role | null;
  via: "member" | "public" | "link" | null;
}

export function activeMembership(db: Readonly<DB>, leagueId: Id, userId: Id | undefined | null): Membership | null {
  if (!userId) return null;
  return db.memberships.find((m) => m.leagueId === leagueId && m.userId === userId && m.status === "active") ?? null;
}

/** Decides how (if at all) this viewer may read the league. Private leagues are members-only. */
export function resolveAccess(db: Readonly<DB>, league: League, actor: Actor | null, shareToken?: string | null): Access {
  const membership = activeMembership(db, league.id, actor?.id);
  if (membership) return { league, membership, role: membership.role, via: "member" };
  if (league.visibility === "public") return { league, membership: null, role: null, via: "public" };
  if (league.visibility === "unlisted" && shareToken && shareToken === league.shareToken) return { league, membership: null, role: null, via: "link" };
  return { league, membership: null, role: null, via: null };
}

export function leagueBySlug(db: Readonly<DB>, slug: string): League | null {
  return db.leagues.find((l) => l.slug === slug && !l.archivedAt) ?? null;
}

export function leagueById(db: Readonly<DB>, id: Id): League {
  const l = db.leagues.find((x) => x.id === id && !x.archivedAt);
  if (!l) throw notFound("League");
  return l;
}

/** Throws unless the actor is an active member of the league holding the permission. */
export function requirePerm(db: Readonly<DB>, actor: Actor | null, leagueId: Id, perm: Permission): { league: League; membership: Membership } {
  if (!actor) throw new AppError("unauthenticated", "Sign in to continue.");
  const league = leagueById(db, leagueId);
  const membership = activeMembership(db, leagueId, actor.id);
  // A non-member learns nothing about a private league: same error as a missing one.
  if (!membership) {
    if (league.visibility === "private") throw notFound("League");
    throw forbidden();
  }
  if (!roleCan(membership.role, perm)) throw forbidden();
  return { league, membership };
}

export function requireMember(db: Readonly<DB>, actor: Actor | null, leagueId: Id): { league: League; membership: Membership } {
  if (!actor) throw new AppError("unauthenticated", "Sign in to continue.");
  const league = leagueById(db, leagueId);
  const membership = activeMembership(db, leagueId, actor.id);
  if (!membership) throw league.visibility === "private" ? notFound("League") : forbidden();
  return { league, membership };
}

// ---- league-scoped entity lookups: every id from the client is verified against the league ----

export function seasonIn(db: Readonly<DB>, leagueId: Id, seasonId: Id): Season {
  const s = db.seasons.find((x) => x.id === seasonId && x.leagueId === leagueId);
  if (!s) throw notFound("Season");
  return s;
}

export function matchupIn(db: Readonly<DB>, leagueId: Id, matchupId: Id) {
  const m = db.matchups.find((x) => x.id === matchupId);
  if (!m) throw notFound("Matchup");
  const season = db.seasons.find((s) => s.id === m.seasonId && s.leagueId === leagueId);
  if (!season) throw notFound("Matchup"); // exists, but in another league
  return { matchup: m, season };
}

export function teamIn(db: Readonly<DB>, leagueId: Id, teamId: Id) {
  const t = db.teams.find((x) => x.id === teamId && x.leagueId === leagueId);
  if (!t) throw notFound("Team");
  return t;
}

export function bowlerIn(db: Readonly<DB>, leagueId: Id, bowlerId: Id) {
  const b = db.bowlers.find((x) => x.id === bowlerId && x.leagueId === leagueId);
  if (!b) throw notFound("Bowler");
  return b;
}

export function seasonData(db: Readonly<DB>, leagueId: Id, seasonId: Id): SeasonData {
  const season = seasonIn(db, leagueId, seasonId);
  const matchups = db.matchups.filter((m) => m.seasonId === seasonId);
  const ids = new Set(matchups.map((m) => m.id));
  return {
    season,
    teams: db.teams.filter((t) => t.leagueId === leagueId),
    bowlers: db.bowlers.filter((b) => b.leagueId === leagueId),
    roster: db.roster.filter((r) => r.seasonId === seasonId),
    weeks: db.weeks.filter((w) => w.seasonId === seasonId).sort((a, b) => a.number - b.number),
    matchups,
    scores: db.scores.filter((s) => ids.has(s.matchupId)),
  };
}

export function seasonModel(db: Readonly<DB>, leagueId: Id, seasonId: Id) {
  return buildSeasonModel(seasonData(db, leagueId, seasonId));
}

export function leagueSeasons(db: Readonly<DB>, leagueId: Id): Season[] {
  return db.seasons.filter((s) => s.leagueId === leagueId).sort((a, b) => b.year - a.year || b.createdAt.localeCompare(a.createdAt));
}

/** Season shown by default: the active one, else the most recent. */
export function currentSeason(db: Readonly<DB>, leagueId: Id): Season | null {
  const all = leagueSeasons(db, leagueId);
  return all.find((s) => s.status === "active") ?? all[0] ?? null;
}

// ---- audit ----

export function writeAudit(
  db: DB,
  actor: Actor,
  e: { leagueId: Id; seasonId?: Id | null; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; note?: string }
): AuditEntry {
  const entry: AuditEntry = {
    id: newId("au"),
    leagueId: e.leagueId,
    seasonId: e.seasonId ?? null,
    at: now(),
    userId: actor.id,
    userName: actor.name,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    before: e.before === undefined ? null : structuredClone(e.before),
    after: e.after === undefined ? null : structuredClone(e.after),
    note: e.note ?? "",
  };
  db.audit.push(entry);
  return entry;
}

// ---- notifications ----

export function notifyMembers(
  db: DB,
  n: { leagueId: Id; type: Notification["type"]; title: string; body: string; href: string; dedupeKey: string; onlyUserIds?: Id[]; exceptUserId?: Id }
) {
  const members = db.memberships.filter((m) => m.leagueId === n.leagueId && m.status === "active");
  for (const m of members) {
    if (n.exceptUserId && m.userId === n.exceptUserId) continue;
    if (n.onlyUserIds && !n.onlyUserIds.includes(m.userId)) continue;
    const user = db.users.find((u) => u.id === m.userId);
    if (!user || user.disabled || !user.prefs[n.type]) continue;
    // One notification per (user, key): repeated edits never re-notify.
    if (db.notifications.some((x) => x.userId === m.userId && x.dedupeKey === n.dedupeKey)) continue;
    db.notifications.push({
      id: newId("nt"), userId: m.userId, leagueId: n.leagueId, type: n.type, title: n.title, body: n.body,
      href: n.href, dedupeKey: n.dedupeKey, createdAt: now(), readAt: null,
    });
  }
}

/** Direct notification to one user (e.g. an invitee who isn't a member yet). Same per-key dedupe and preference rules. */
export function notifyUser(
  db: DB,
  userId: Id,
  n: { leagueId: Id; type: Notification["type"]; title: string; body: string; href: string; dedupeKey: string }
) {
  const user = db.users.find((u) => u.id === userId);
  if (!user || user.disabled || !user.prefs[n.type]) return;
  if (db.notifications.some((x) => x.userId === userId && x.dedupeKey === n.dedupeKey)) return;
  db.notifications.push({ id: newId("nt"), userId, leagueId: n.leagueId, type: n.type, title: n.title, body: n.body, href: n.href, dedupeKey: n.dedupeKey, createdAt: now(), readAt: null });
}
